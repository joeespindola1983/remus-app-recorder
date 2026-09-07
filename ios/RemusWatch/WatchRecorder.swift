import CoreLocation
import CoreMotion
import Foundation
import HealthKit
import WatchConnectivity
import WatchKit

@MainActor
final class WatchRecorder: NSObject, ObservableObject {
    static let shared = WatchRecorder()

    enum State: Equatable {
        case idle
        case requestingPermissions
        case recording
        case stopping
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var startedAt: Date?
    @Published private(set) var elapsedSamples = 0
    @Published private(set) var measuredHertz = 0.0
    @Published private(set) var heartRate: Double?
    @Published private(set) var activeEnergyKilocalories: Double?
    @Published private(set) var distanceMeters: Double?
    @Published private(set) var gpsAccuracyMeters: Double?
    @Published private(set) var batteryLevel: Double?
    @Published private(set) var queuedWrites = 0
    @Published private(set) var status = "Ready"
    @Published private(set) var transferStatus = "No recording waiting"
    @Published private(set) var permissionStatus = "Health permissions not requested"

    private let healthStore = HKHealthStore()
    nonisolated(unsafe) private let motionManager = CMMotionManager()
    private let altimeter = CMAltimeter()
    private let locationManager = CLLocationManager()
    private let writer = WatchDatabaseWriter()
    private let motionQueue: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "com.espindola.remus.watch-motion"
        queue.qualityOfService = .userInitiated
        queue.maxConcurrentOperationCount = 1
        return queue
    }()

    private var workoutSession: HKWorkoutSession?
    private var workoutBuilder: HKLiveWorkoutBuilder?
    private var sessionStartUptime: TimeInterval?
    private var lastLocationTimestamp: Date?
    private var lastDeviceSampleUptime: TimeInterval?
    private var didFinalize = false
    private var pendingStartAfterLocationAuthorization = false
    private var frame: CMAttitudeReferenceFrame = .xArbitraryCorrectedZVertical
    private var databaseStarted = false
    private var companionWorkoutConfiguration: HKWorkoutConfiguration?
    private var motionStartAttempt = 0
    private var motionWatchdog: Task<Void, Never>?

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.activityType = .fitness
        writer.onError = { [weak self] error in
            Task { @MainActor in self?.fail(error.localizedDescription) }
        }
        activateConnectivity()
        refreshBattery()
    }

    var isRecording: Bool { state == .recording }

    func start() {
        companionWorkoutConfiguration = nil
        startRequest()
    }

    func startFromCompanion(_ configuration: HKWorkoutConfiguration) {
        guard state == .idle || isFailed else {
            publishRecordingState(isRecording ? "recording" : "busy")
            return
        }
        companionWorkoutConfiguration = configuration
        transferStatus = "Start requested by iPhone"
        startRequest()
    }

    private func startRequest() {
        guard state == .idle || isFailed else { return }
        state = .requestingPermissions
        status = "Requesting Health access"
        requestHealthAuthorization()
    }

    func stop() {
        guard isRecording else { return }
        state = .stopping
        status = "Finishing workout"
        stopSensors()
        let end = Date()
        workoutSession?.end()
        guard let builder = workoutBuilder else {
            finalizeRecording(at: end, failureMessage: nil)
            return
        }
        let recorder = self
        builder.endCollection(withEnd: end) { _, collectionError in
            builder.finishWorkout { _, finishError in
                Task { @MainActor in
                    recorder.finalizeRecording(
                        at: end,
                        failureMessage: collectionError?.localizedDescription ?? finishError?.localizedDescription
                    )
                }
            }
        }
    }

    private var isFailed: Bool {
        if case .failed = state { return true }
        return false
    }

    private func requestHealthAuthorization() {
        guard HKHealthStore.isHealthDataAvailable(),
              let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate),
              let energyType = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) else {
            failBeforeRecording("HealthKit is unavailable on this Apple Watch.")
            return
        }

        let shareTypes: Set<HKSampleType> = [HKObjectType.workoutType()]
        var readTypes: Set<HKObjectType> = [heartRateType, energyType]
        if #available(watchOS 11.0, *),
           let rowingDistanceType = HKObjectType.quantityType(forIdentifier: .distanceRowing) {
            readTypes.insert(rowingDistanceType)
        }
        healthStore.requestAuthorization(toShare: shareTypes, read: readTypes) { [weak self] success, error in
            Task { @MainActor in
                guard let self else { return }
                guard success else {
                    self.failBeforeRecording(error?.localizedDescription ?? "Health authorization was not granted.")
                    return
                }
                self.permissionStatus = "Health access requested · heart rate, energy, distance and workouts"
                self.prepareLocationAuthorization()
            }
        }
    }

    private func prepareLocationAuthorization() {
        switch locationManager.authorizationStatus {
        case .notDetermined:
            pendingStartAfterLocationAuthorization = true
            status = "Requesting location access"
            locationManager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            permissionStatus += " · GPS allowed"
            beginRecordingAfterAuthorizationSettles()
        case .denied, .restricted:
            permissionStatus += " · GPS unavailable"
            beginRecordingAfterAuthorizationSettles()
        @unknown default:
            beginRecordingAfterAuthorizationSettles()
        }
    }

    private func beginRecordingAfterAuthorizationSettles() {
        status = "Preparing sensors"
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard let self, self.state == .requestingPermissions else { return }
            self.beginRecording()
        }
    }

    private func beginRecording() {
        guard state == .requestingPermissions else { return }
        let startDate = Date()
        let startUptime = ProcessInfo.processInfo.systemUptime
        frame = preferredReferenceFrame()
        let device = WKInterfaceDevice.current()
        device.isBatteryMonitoringEnabled = true
        refreshBattery()

        let manifest = WatchManifest(
            id: UUID(),
            startedAt: startDate,
            endedAt: nil,
            status: .recording,
            failureMessage: nil,
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
            watchModel: device.model,
            systemVersion: device.systemVersion,
            wristLocation: device.wristLocation == .left ? "left" : "right",
            crownOrientation: device.crownOrientation == .left ? "left" : "right",
            motionFrequencyHertz: 50,
            motionReferenceFrame: referenceFrameName(frame),
            motionSampleCount: 0,
            locationSampleCount: 0,
            altimeterSampleCount: 0,
            healthSampleCount: 0,
            deviceSampleCount: 0,
            databaseFilename: "watch-telemetry.sqlite"
        )

        do {
            _ = try writer.start(manifest: manifest)
            databaseStarted = true
            try startWorkout(at: startDate)
        } catch {
            failBeforeRecording(error.localizedDescription)
            return
        }

        didFinalize = false
        startedAt = startDate
        sessionStartUptime = startUptime
        lastLocationTimestamp = nil
        lastDeviceSampleUptime = nil
        elapsedSamples = 0
        measuredHertz = 0
        motionStartAttempt = 0
        heartRate = nil
        activeEnergyKilocalories = nil
        distanceMeters = nil
        state = .recording
        status = "Recording locally · 50 Hz"
        publishRecordingState("recording")
        startMotion()
        startLocationIfAuthorized()
        startAltimeter()
        recordDevice(at: startUptime)
    }

    private func startWorkout(at date: Date) throws {
        let configuration = companionWorkoutConfiguration ?? HKWorkoutConfiguration()
        if companionWorkoutConfiguration == nil {
            configuration.activityType = .rowing
            configuration.locationType = .outdoor
        }
        companionWorkoutConfiguration = nil
        let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
        let builder = session.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)
        session.delegate = self
        builder.delegate = self
        workoutSession = session
        workoutBuilder = builder
        session.startActivity(with: date)
        builder.beginCollection(withStart: date) { [weak self] success, error in
            guard !success, let error else { return }
            Task { @MainActor in self?.fail(error.localizedDescription) }
        }
    }

    private func startMotion() {
        guard motionManager.isDeviceMotionAvailable,
              let startedAt,
              let sessionStartUptime else {
            fail("Device Motion is unavailable on this Apple Watch.")
            return
        }
        motionStartAttempt += 1
        let interval = 1.0 / 50.0
        motionManager.deviceMotionUpdateInterval = interval
        motionManager.accelerometerUpdateInterval = interval
        motionManager.gyroUpdateInterval = interval
        motionManager.magnetometerUpdateInterval = interval
        if motionManager.isAccelerometerAvailable { motionManager.startAccelerometerUpdates() }
        if motionManager.isGyroAvailable { motionManager.startGyroUpdates() }
        if motionManager.isMagnetometerAvailable { motionManager.startMagnetometerUpdates() }

        var count = 0
        var firstTimestamp: TimeInterval?
        motionManager.startDeviceMotionUpdates(using: frame, to: motionQueue) { [weak self] motion, error in
            guard let self else { return }
            guard let motion else {
                if let error { Task { @MainActor in self.handleMotionError(error) } }
                return
            }
            let elapsed = max(0, motion.timestamp - sessionStartUptime)
            let sample = self.motionSample(from: motion)
            guard self.writer.appendMotion(sample, wallTime: startedAt.addingTimeInterval(elapsed), elapsed: elapsed) else {
                Task { @MainActor in self.fail(WatchDatabaseWriter.WriterError.queueFull.localizedDescription) }
                return
            }
            count += 1
            if firstTimestamp == nil { firstTimestamp = motion.timestamp }
            guard count.isMultiple(of: 25), let firstTimestamp else { return }
            let rate = motion.timestamp > firstTimestamp ? Double(count - 1) / (motion.timestamp - firstTimestamp) : 0
            Task { @MainActor in
                guard self.isRecording else { return }
                self.elapsedSamples = count
                self.measuredHertz = rate
                self.queuedWrites = self.writer.queuedWriteCount
                self.status = "Recording locally · \(rate.formatted(.number.precision(.fractionLength(1)))) Hz"
                if self.lastDeviceSampleUptime.map({ motion.timestamp - $0 >= 60 }) ?? true {
                    self.recordDevice(at: motion.timestamp)
                }
            }
        }
        scheduleMotionWatchdog(for: motionStartAttempt)
    }

    private func handleMotionError(_ error: Error) {
        guard isRecording else { return }
        if elapsedSamples == 0 {
            if frame == .xTrueNorthZVertical {
                status = "Falling back to magnetic north"
                frame = .xMagneticNorthZVertical
                restartMotion()
                return
            } else if frame == .xMagneticNorthZVertical {
                status = "Falling back to corrected motion"
                frame = .xArbitraryCorrectedZVertical
                restartMotion()
                return
            } else if frame == .xArbitraryCorrectedZVertical {
                status = "Falling back to arbitrary reference"
                frame = .xArbitraryZVertical
                restartMotion()
                return
            }
        }
        fail(error.localizedDescription)
    }

    private func restartMotion() {
        motionWatchdog?.cancel()
        motionManager.stopDeviceMotionUpdates()
        writer.updateReferenceFrame(referenceFrameName(frame))
        startMotion()
    }

    private func scheduleMotionWatchdog(for attempt: Int) {
        motionWatchdog?.cancel()
        motionWatchdog = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled,
                  let self,
                  self.isRecording,
                  self.elapsedSamples == 0,
                  self.motionStartAttempt == attempt else { return }

            if attempt == 1 {
                self.status = "Restarting motion sensors"
                self.motionManager.stopDeviceMotionUpdates()
                self.motionManager.stopAccelerometerUpdates()
                self.motionManager.stopGyroUpdates()
                self.motionManager.stopMagnetometerUpdates()
                self.frame = .xArbitraryZVertical
                self.writer.updateReferenceFrame(self.referenceFrameName(self.frame))
                self.startMotion()
            } else {
                self.fail("Motion sensors did not deliver samples after permission was granted. Please reopen the app and try again.")
            }
        }
    }

    private nonisolated func motionSample(from motion: CMDeviceMotion) -> WatchMotionSample {
        let rawAcceleration = motionManager.accelerometerData.map { SIMD3($0.acceleration.x, $0.acceleration.y, $0.acceleration.z) }
        let rawRotation = motionManager.gyroData.map { SIMD3($0.rotationRate.x, $0.rotationRate.y, $0.rotationRate.z) }
        let rawMagnetic = motionManager.magnetometerData.map { SIMD3($0.magneticField.x, $0.magneticField.y, $0.magneticField.z) }
        let magnetic = motion.magneticField.field
        let quaternion = motion.attitude.quaternion
        return WatchMotionSample(
            sensorUptime: motion.timestamp,
            rawAcceleration: rawAcceleration,
            rawRotation: rawRotation,
            rawMagneticField: rawMagnetic,
            userAcceleration: SIMD3(motion.userAcceleration.x, motion.userAcceleration.y, motion.userAcceleration.z),
            gravity: SIMD3(motion.gravity.x, motion.gravity.y, motion.gravity.z),
            rotationRate: SIMD3(motion.rotationRate.x, motion.rotationRate.y, motion.rotationRate.z),
            calibratedMagneticField: SIMD3(magnetic.x, magnetic.y, magnetic.z),
            magneticAccuracy: Int(motion.magneticField.accuracy.rawValue),
            roll: motion.attitude.roll,
            pitch: motion.attitude.pitch,
            yaw: motion.attitude.yaw,
            quaternion: SIMD4(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
        )
    }

    private func startLocationIfAuthorized() {
        guard locationManager.authorizationStatus == .authorizedAlways || locationManager.authorizationStatus == .authorizedWhenInUse else { return }
        locationManager.startUpdatingLocation()
    }

    private func startAltimeter() {
        guard CMAltimeter.isRelativeAltitudeAvailable() else { return }
        altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
            guard let self, let data else { return }
            Task { @MainActor in
                guard self.isRecording,
                      let elapsed = self.elapsedForAltimeterTimestamp(data.timestamp),
                      let startedAt = self.startedAt else { return }
                _ = self.writer.appendAltimeter(
                    relativeAltitude: data.relativeAltitude.doubleValue,
                    pressure: data.pressure.doubleValue,
                    wallTime: startedAt.addingTimeInterval(elapsed),
                    elapsed: elapsed
                )
            }
        }
    }

    private func recordHealth(types: Set<HKSampleType>, builder: HKLiveWorkoutBuilder) {
        guard isRecording else { return }
        let now = Date()
        guard let elapsed = elapsed(for: now) else { return }
        for type in types {
            guard let quantityType = type as? HKQuantityType,
                  let statistics = builder.statistics(for: quantityType) else { continue }
            if quantityType.identifier == HKQuantityTypeIdentifier.heartRate.rawValue {
                let unit = HKUnit.count().unitDivided(by: .minute())
                guard let value = statistics.mostRecentQuantity()?.doubleValue(for: unit) else { continue }
                heartRate = value
                _ = writer.appendHealth(kind: "heart_rate", value: value, unit: "count/min", wallTime: now, elapsed: elapsed)
            } else if quantityType.identifier == HKQuantityTypeIdentifier.activeEnergyBurned.rawValue {
                let unit = HKUnit.kilocalorie()
                guard let value = statistics.sumQuantity()?.doubleValue(for: unit) else { continue }
                activeEnergyKilocalories = value
                _ = writer.appendHealth(kind: "active_energy", value: value, unit: "kcal", wallTime: now, elapsed: elapsed)
            } else if #available(watchOS 11.0, *),
                      quantityType.identifier == HKQuantityTypeIdentifier.distanceRowing.rawValue {
                let unit = HKUnit.meter()
                guard let value = statistics.sumQuantity()?.doubleValue(for: unit) else { continue }
                distanceMeters = value
                _ = writer.appendHealth(kind: "rowing_distance", value: value, unit: "m", wallTime: now, elapsed: elapsed)
            }
        }
    }

    private func recordDevice(at uptime: TimeInterval) {
        guard isRecording || state == .requestingPermissions,
              let elapsed = elapsed(atUptime: uptime),
              let startedAt else { return }
        lastDeviceSampleUptime = uptime
        refreshBattery()
        let device = WKInterfaceDevice.current()
        _ = writer.appendDevice(
            batteryLevel: device.batteryLevel >= 0 ? Double(device.batteryLevel) : nil,
            batteryState: String(describing: device.batteryState),
            wallTime: startedAt.addingTimeInterval(elapsed),
            elapsed: elapsed
        )
    }

    private func refreshBattery() {
        let value = WKInterfaceDevice.current().batteryLevel
        batteryLevel = value >= 0 ? Double(value) : nil
    }

    private func stopSensors() {
        motionWatchdog?.cancel()
        motionWatchdog = nil
        motionManager.stopDeviceMotionUpdates()
        motionManager.stopAccelerometerUpdates()
        motionManager.stopGyroUpdates()
        motionManager.stopMagnetometerUpdates()
        altimeter.stopRelativeAltitudeUpdates()
        locationManager.stopUpdatingLocation()
    }

    private func finalizeRecording(at date: Date, failureMessage: String?) {
        guard !didFinalize else { return }
        didFinalize = true
        guard let recording = writer.stop(at: date, failureMessage: failureMessage) else {
            state = .failed("Could not finalize the Watch recording.")
            return
        }
        databaseStarted = false
        workoutSession = nil
        workoutBuilder = nil
        sessionStartUptime = nil
        queuedWrites = 0
        status = failureMessage == nil ? "Recording saved" : "Recording saved with an interruption"
        publishRecordingState(failureMessage == nil ? "saved" : "failed", error: failureMessage)

        Task {
            do {
                let archive = try await Task.detached(priority: .userInitiated) {
                    try ZipArchiveService.createArchive(for: recording)
                }.value
                enqueueTransfer(archive: archive, manifest: recording.manifest)
                state = .idle
            } catch {
                state = .failed("Recording saved, but ZIP creation failed: \(error.localizedDescription)")
            }
        }
    }

    private func enqueueTransfer(archive: URL, manifest: WatchManifest) {
        guard WCSession.isSupported() else {
            transferStatus = "Saved locally · Watch Connectivity unavailable"
            return
        }
        let session = WCSession.default
        guard session.activationState == .activated else {
            transferStatus = "Saved locally · waiting for connection activation"
            return
        }
        session.transferFile(archive, metadata: [
            "sessionID": manifest.id.uuidString,
            "startedAt": manifest.startedAt.timeIntervalSince1970,
            "endedAt": (manifest.endedAt ?? Date()).timeIntervalSince1970,
            "motionSampleCount": manifest.motionSampleCount
        ])
        transferStatus = "Queued for transfer to iPhone"
    }

    private func recoverLocalArchives() {
        guard state != .recording && state != .stopping else {
            transferStatus = "Finish the current workout before recovery"
            return
        }
        transferStatus = "Preparing local recordings for transfer"

        Task {
            do {
                let recordings = try await Task.detached(priority: .utility) {
                    try Self.completedLocalRecordings()
                }.value
                var queued = 0
                for recording in recordings {
                    let archive = try await Task.detached(priority: .utility) {
                        try ZipArchiveService.createArchive(for: recording)
                    }.value
                    enqueueTransfer(archive: archive, manifest: recording.manifest)
                    queued += 1
                }
                transferStatus = queued == 0 ? "No completed recordings found" : "Queued \(queued) recording(s) for transfer"
                publishRecordingState("recoveryQueued", archiveCount: queued)
            } catch {
                transferStatus = "Recovery failed: \(error.localizedDescription)"
                publishRecordingState("recoveryFailed", error: error.localizedDescription)
            }
        }
    }

    private nonisolated static func completedLocalRecordings() throws -> [WatchRecordingSession] {
        let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let root = documents.appendingPathComponent("RemusWatchSessions", isDirectory: true)
        guard FileManager.default.fileExists(atPath: root.path) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let folders = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])
        return folders.compactMap { folder in
            guard (try? folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true,
                  let data = try? Data(contentsOf: folder.appendingPathComponent("watch-manifest.json")),
                  let manifest = try? decoder.decode(WatchManifest.self, from: data),
                  manifest.status != .recording,
                  FileManager.default.fileExists(atPath: folder.appendingPathComponent(manifest.databaseFilename).path)
            else { return nil }
            return WatchRecordingSession(manifest: manifest, folderURL: folder)
        }.sorted { $0.manifest.startedAt > $1.manifest.startedAt }
    }

    private func activateConnectivity() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    private func publishRecordingState(_ recordingState: String, error: String? = nil, archiveCount: Int? = nil) {
        guard WCSession.isSupported() else { return }
        var payload: [String: Any] = [
            "recordingState": recordingState,
            "updatedAt": Date().timeIntervalSince1970
        ]
        if let error { payload["error"] = error }
        if let archiveCount { payload["archiveCount"] = archiveCount }
        let session = WCSession.default
        try? session.updateApplicationContext(payload)
        if session.activationState == .activated, session.isReachable {
            session.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        }
    }

    private func preferredReferenceFrame() -> CMAttitudeReferenceFrame {
        let available = CMMotionManager.availableAttitudeReferenceFrames()
        if available.contains(.xMagneticNorthZVertical) { return .xMagneticNorthZVertical }
        if available.contains(.xArbitraryCorrectedZVertical) { return .xArbitraryCorrectedZVertical }
        return .xArbitraryZVertical
    }

    private func referenceFrameName(_ value: CMAttitudeReferenceFrame) -> String {
        if value == .xTrueNorthZVertical { return "xTrueNorthZVertical" }
        if value == .xMagneticNorthZVertical { return "xMagneticNorthZVertical" }
        if value == .xArbitraryCorrectedZVertical { return "xArbitraryCorrectedZVertical" }
        return "xArbitraryZVertical"
    }

    private func elapsed(atUptime uptime: TimeInterval) -> TimeInterval? {
        sessionStartUptime.map { max(0, uptime - $0) }
    }

    private func elapsed(for date: Date) -> TimeInterval? {
        let receiveDate = Date()
        let receiveUptime = ProcessInfo.processInfo.systemUptime
        let age = max(0, receiveDate.timeIntervalSince(date))
        return elapsed(atUptime: receiveUptime - age)
    }

    private func elapsedForAltimeterTimestamp(_ timestamp: TimeInterval) -> TimeInterval? {
        let currentUptime = ProcessInfo.processInfo.systemUptime
        if abs(timestamp - currentUptime) < 24 * 60 * 60 {
            return elapsed(atUptime: timestamp)
        }

        // Some watchOS releases deliver CMAltitudeData timestamps using
        // Date.timeIntervalSinceReferenceDate instead of system uptime.
        return elapsed(for: Date(timeIntervalSinceReferenceDate: timestamp))
    }

    private func failBeforeRecording(_ message: String) {
        stopSensors()
        if databaseStarted {
            _ = writer.stop(at: Date(), failureMessage: message)
            databaseStarted = false
        }
        state = .failed(message)
        status = "Could not start"
    }

    private func fail(_ message: String) {
        guard isRecording else {
            failBeforeRecording(message)
            return
        }
        state = .stopping
        stopSensors()
        workoutSession?.end()
        finalizeRecording(at: Date(), failureMessage: message)
    }
}

extension WatchRecorder: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            guard pendingStartAfterLocationAuthorization else { return }
            pendingStartAfterLocationAuthorization = false
            if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
                permissionStatus += " · GPS unavailable"
            } else {
                permissionStatus += " · GPS allowed"
            }
            beginRecordingAfterAuthorizationSettles()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            guard isRecording, let startedAt else { return }
            for location in locations.sorted(by: { $0.timestamp < $1.timestamp }) where location.horizontalAccuracy >= 0 {
                if let lastLocationTimestamp, location.timestamp.timeIntervalSince(lastLocationTimestamp) < 0.05 { continue }
                lastLocationTimestamp = location.timestamp
                guard let elapsed = elapsed(for: location.timestamp) else { continue }
                gpsAccuracyMeters = location.horizontalAccuracy
                let sample = WatchLocationSample(
                    sourceTime: location.timestamp,
                    latitude: location.coordinate.latitude,
                    longitude: location.coordinate.longitude,
                    altitude: location.verticalAccuracy >= 0 ? location.altitude : nil,
                    horizontalAccuracy: location.horizontalAccuracy,
                    verticalAccuracy: location.verticalAccuracy >= 0 ? location.verticalAccuracy : nil,
                    speed: location.speed >= 0 ? location.speed : nil,
                    speedAccuracy: location.speedAccuracy >= 0 ? location.speedAccuracy : nil,
                    course: location.course >= 0 ? location.course : nil,
                    courseAccuracy: location.courseAccuracy >= 0 ? location.courseAccuracy : nil
                )
                _ = writer.appendLocation(sample, wallTime: startedAt.addingTimeInterval(elapsed), elapsed: elapsed)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in status = "Recording · Watch GPS temporarily unavailable" }
    }
}

extension WatchRecorder: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {}

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in fail(error.localizedDescription) }
    }
}

extension WatchRecorder: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        Task { @MainActor in recordHealth(types: collectedTypes, builder: workoutBuilder) }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}

extension WatchRecorder: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in
            if let error { transferStatus = "Watch connection error: \(error.localizedDescription)" }
            else if activationState == .activated { transferStatus = "Ready to transfer after recording" }
        }
    }

    nonisolated func session(_ session: WCSession, didFinish fileTransfer: WCSessionFileTransfer, error: Error?) {
        Task { @MainActor in
            transferStatus = error == nil ? "Transferred to iPhone" : "Transfer pending: \(error!.localizedDescription)"
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        let command = message["command"] as? String
        Task { @MainActor in
            if command == "stopWorkout", isRecording {
                publishRecordingState("stopping")
                stop()
            } else if command == "recoverWatchArchives" {
                recoverLocalArchives()
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        let command = userInfo["command"] as? String
        Task { @MainActor in
            if command == "stopWorkout", isRecording {
                publishRecordingState("stopping")
                stop()
            } else if command == "recoverWatchArchives" {
                recoverLocalArchives()
            }
        }
    }
}
