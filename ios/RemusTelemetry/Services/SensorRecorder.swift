import CoreLocation
import CoreMotion
import Foundation
import HealthKit
import UIKit
import WatchConnectivity

@MainActor
final class SensorRecorder: NSObject, ObservableObject {
    enum State: Equatable {
        case idle
        case requestingLocationPermission
        case requestingPreciseLocation
        case acquiringGPS
        case recording
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var startedAt: Date?
    @Published private(set) var sampleCount = 0
    @Published private(set) var currentSpeedKilometersPerHour = 0.0
    @Published private(set) var distanceMeters = 0.0
    @Published private(set) var courseDegrees: Double?
    @Published private(set) var headingDegrees: Double?
    @Published private(set) var coordinate: CLLocationCoordinate2D?
    @Published private(set) var horizontalAccuracyMeters: Double?
    @Published private(set) var accelerationG = 0.0
    @Published private(set) var rotationRate = 0.0
    @Published private(set) var rotationVector: Vector3?
    @Published private(set) var relativeAltitudeMeters: Double?
    @Published private(set) var pressureKilopascals: Double?
    @Published private(set) var weather: WeatherSnapshot?
    @Published private(set) var weatherStatus = "Waiting for GPS"
    @Published private(set) var lastSessionURL: URL?
    @Published private(set) var sensorStatus = "Not recording"
    @Published private(set) var queuedWrites = 0
    @Published private(set) var measuredMotionHertz = 0.0
    @Published private(set) var locationPermissionStatus = "Not requested"
    @Published private(set) var shouldOfferSettings = false
    @Published private(set) var locationAccuracyStatus = "Unknown accuracy"
    @Published private(set) var measuredGPSHertz = 0.0
    @Published private(set) var liveStrokeRate: [String: Any]?
    @Published private(set) var watchWorkoutStatus = "Watch workout not requested"

    private let locationManager = CLLocationManager()
    private let motionCaptureService = MotionCaptureService()
    private var motionReferenceFrame = MotionCaptureService.preferredReferenceFrame()
    private let altimeter = CMAltimeter()
    private let databaseWriter = SessionDatabaseWriter()
    private let weatherService = WeatherService()
    private let healthStore = HKHealthStore()
    private let liveSpmEstimator = RemusLiveSpmBridge()

    private var latestLocation: CLLocation?
    private var latestHeading: CLHeading?
    private var latestAltimeter: AltimeterSample?
    private var previousDistanceLocation: CLLocation?
    private var lastWeatherFetch: Date?
    private var weatherRequestInFlight = false
    private var lastDeviceSampleUptime: TimeInterval?
    private var startAfterAuthorization = false
    private var attemptedTemporaryFullAccuracy = false
    private var firstGPSTimestamp: Date?
    private var capturedGPSCount = 0
    private var sessionStartUptime: TimeInterval?
    private var lastRecordedLocationSourceTime: Date?

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.activityType = .fitness
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
        locationManager.headingFilter = kCLHeadingFilterNone
        locationManager.headingOrientation = .portrait
        databaseWriter.onError = { [weak self] error in
            self?.fail(error.localizedDescription)
        }
    }

    var isRecording: Bool { state == .recording }

    private var pendingMetadata: SessionMetadata?

    func start(metadata: SessionMetadata? = nil) {
        guard !isRecording, !isRequestingLocationPermission else { return }
        self.pendingMetadata = metadata
        attemptedTemporaryFullAccuracy = false

        switch locationManager.authorizationStatus {
        case .notDetermined:
            startAfterAuthorization = true
            state = .requestingLocationPermission
            locationPermissionStatus = "Waiting for your choice"
            locationManager.requestWhenInUseAuthorization()
            return
        case .authorizedWhenInUse, .authorizedAlways:
            shouldOfferSettings = false
            prepareAccuracyAndBeginRecording()
        case .denied:
            state = .failed("Location permission was denied. Open Settings and allow location access for Remus Sensors.")
            locationPermissionStatus = "Denied"
            shouldOfferSettings = true
        case .restricted:
            state = .failed("Location access is restricted by Screen Time or device management.")
            locationPermissionStatus = "Restricted"
            shouldOfferSettings = false
        @unknown default:
            state = .failed("Unknown location authorization status.")
        }
    }

    func startImmediately(metadata: SessionMetadata) throws -> URL {
        self.pendingMetadata = metadata
        let now = metadata.startedAt
        let startUptime = ProcessInfo.processInfo.systemUptime
        let folder = try databaseWriter.start(metadata: metadata)
        lastSessionURL = folder
        resetLiveValues()
        startedAt = now
        sessionStartUptime = startUptime
        state = .recording
        UIDevice.current.isBatteryMonitoringEnabled = true
        UIApplication.shared.isIdleTimerDisabled = true

        if locationManager.authorizationStatus == .notDetermined {
            locationManager.requestWhenInUseAuthorization()
        }
        locationManager.startUpdatingLocation()
        if CLLocationManager.headingAvailable() {
            locationManager.startUpdatingHeading()
        }
        startMotion()
        startAltimeter()
        startWorkoutOnWatch()
        return folder
    }

    func refreshAuthorizationStatus() {
        updateAuthorizationStatus(locationManager.authorizationStatus)
        updateAccuracyStatus()
    }

    func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    var isRequestingLocationPermission: Bool {
        state == .requestingLocationPermission || state == .requestingPreciseLocation
    }

    var isAcquiringGPS: Bool { state == .acquiringGPS }

    private func prepareAccuracyAndBeginRecording() {
        updateAccuracyStatus()
        guard locationManager.accuracyAuthorization == .reducedAccuracy,
              !attemptedTemporaryFullAccuracy else {
            beginGPSAcquisition()
            return
        }

        attemptedTemporaryFullAccuracy = true
        state = .requestingPreciseLocation
        locationAccuracyStatus = "Requesting precise location"
        locationManager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: "RowingTelemetry") { [weak self] error in
            guard let self else { return }
            Task { @MainActor in
                self.updateAccuracyStatus()
                if let error {
                    self.sensorStatus = "Precise GPS request declined: \(error.localizedDescription)"
                }
                self.beginGPSAcquisition()
            }
        }
    }

    private func beginGPSAcquisition() {
        state = .acquiringGPS
        sensorStatus = "Acquiring fresh GPS fix · target ≤10 m"
        UIApplication.shared.isIdleTimerDisabled = true
        locationManager.startUpdatingLocation()
    }

    func cancelGPSAcquisition() {
        guard isAcquiringGPS else { return }
        locationManager.stopUpdatingLocation()
        UIApplication.shared.isIdleTimerDisabled = false
        sensorStatus = "GPS acquisition cancelled"
        state = .idle
    }

    private func beginRecording() {
        guard !isRecording else { return }
        let now = Date()
        let startUptime = ProcessInfo.processInfo.systemUptime
        let metadata = pendingMetadata ?? SessionMetadata(
            sessionID: UUID(),
            startedAt: now,
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
            deviceModel: UIDevice.current.model,
            systemVersion: UIDevice.current.systemVersion,
            motionFrequencyHertz: 100,
            notes: "100 Hz inertial telemetry with independent GPS, heading, altimeter, device and weather streams. Motion reference frame: \(MotionCaptureService.name(of: motionReferenceFrame)).",
            placement: "unknown"
        )

        do {
            lastSessionURL = try databaseWriter.start(metadata: metadata)
        } catch {
            locationManager.stopUpdatingLocation()
            UIApplication.shared.isIdleTimerDisabled = false
            state = .failed("Could not create session file: \(error.localizedDescription)")
            return
        }

        resetLiveValues()
        startedAt = now
        sessionStartUptime = startUptime
        state = .recording
        UIDevice.current.isBatteryMonitoringEnabled = true
        UIApplication.shared.isIdleTimerDisabled = true

        if CLLocationManager.headingAvailable() {
            locationManager.startUpdatingHeading()
        }
        startMotion()
        startAltimeter()
        startWorkoutOnWatch()
    }

    private func updateAuthorizationStatus(_ status: CLAuthorizationStatus) {
        switch status {
        case .notDetermined:
            locationPermissionStatus = "Not requested"
            shouldOfferSettings = false
        case .authorizedWhenInUse:
            locationPermissionStatus = "Allowed while using the app"
            shouldOfferSettings = false
            if case .failed = state { state = .idle }
        case .authorizedAlways:
            locationPermissionStatus = "Always allowed"
            shouldOfferSettings = false
            if case .failed = state { state = .idle }
        case .denied:
            locationPermissionStatus = "Denied"
            shouldOfferSettings = true
        case .restricted:
            locationPermissionStatus = "Restricted"
            shouldOfferSettings = false
        @unknown default:
            locationPermissionStatus = "Unknown"
        }
        updateAccuracyStatus()
    }

    private func updateAccuracyStatus() {
        switch locationManager.accuracyAuthorization {
        case .fullAccuracy:
            locationAccuracyStatus = "Precise GPS"
        case .reducedAccuracy:
            locationAccuracyStatus = "Reduced GPS accuracy"
        @unknown default:
            locationAccuracyStatus = "Unknown GPS accuracy"
        }
    }

    func stop(failureMessage: String? = nil) {
        guard isRecording else { return }
        stopWorkoutOnWatch()
        locationManager.stopUpdatingLocation()
        locationManager.stopUpdatingHeading()
        motionCaptureService.stop()
        altimeter.stopRelativeAltitudeUpdates()
        UIApplication.shared.isIdleTimerDisabled = false
        lastSessionURL = databaseWriter.stop(at: Date(), failureMessage: failureMessage)
        sessionStartUptime = nil
        sensorStatus = failureMessage == nil ? "Recording completed" : "Recording interrupted"
        queuedWrites = 0
        state = .idle
    }

    private func startWorkoutOnWatch() {
        watchWorkoutStatus = "Waking Apple Watch…"
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .rowing
        configuration.locationType = .outdoor

        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await healthStore.startWatchApp(toHandle: configuration)
                guard isRecording else { return }
                watchWorkoutStatus = "Start request delivered to Apple Watch"
            } catch {
                watchWorkoutStatus = "Watch did not start: \(error.localizedDescription)"
            }
        }
    }

    private func stopWorkoutOnWatch() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else {
            watchWorkoutStatus = "Phone stopped · Watch not active"
            return
        }
        
        let payload = ["command": "stopWorkout"]
        
        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { [weak self] error in
                Task { @MainActor in
                    self?.watchWorkoutStatus = "Phone stopped · Watch stop failed: \(error.localizedDescription)"
                }
            }
        }
        
        session.transferUserInfo(payload)
        watchWorkoutStatus = "Stopping Apple Watch workout…"
    }

    private func resetLiveValues() {
        sampleCount = 0
        currentSpeedKilometersPerHour = 0
        distanceMeters = 0
        courseDegrees = nil
        headingDegrees = nil
        coordinate = nil
        horizontalAccuracyMeters = nil
        accelerationG = 0
        rotationRate = 0
        relativeAltitudeMeters = nil
        pressureKilopascals = nil
        weather = nil
        weatherStatus = "Waiting for GPS"
        latestLocation = nil
        latestHeading = nil
        latestAltimeter = nil
        previousDistanceLocation = nil
        lastWeatherFetch = nil
        weatherRequestInFlight = false
        lastDeviceSampleUptime = nil
        queuedWrites = 0
        sensorStatus = "Preparing sensors"
        measuredMotionHertz = 0
        measuredGPSHertz = 0
        liveStrokeRate = nil
        liveSpmEstimator.reset()
        firstGPSTimestamp = nil
        capturedGPSCount = 0
        lastRecordedLocationSourceTime = nil
    }

    private func startMotion() {
        guard let startedAt, let sessionStartUptime else { return }
        sensorStatus = "IMU active · 100 Hz target"
        motionCaptureService.start(
            writer: databaseWriter,
            sessionStartDate: startedAt,
            sessionStartUptime: sessionStartUptime,
            referenceFrame: motionReferenceFrame,
            onUpdate: { [weak self] update in
                guard let self else { return }
                Task { @MainActor in
                    guard self.isRecording else { return }
                    self.sampleCount = update.sampleCount
                    self.queuedWrites = update.queuedWrites
                    self.accelerationG = update.accelerationG
                    self.rotationRate = update.rotationRate
                    self.rotationVector = update.rotationVector
                    self.measuredMotionHertz = update.measuredHertz
                    if let estimate = self.liveSpmEstimator.pushTimestamp(
                        update.sensorUptime,
                        x: update.userAcceleration.x * 9.80665,
                        y: update.userAcceleration.y * 9.80665,
                        z: update.userAcceleration.z * 9.80665
                    ) as? [String: Any] {
                        self.liveStrokeRate = estimate
                    }
                    self.sensorStatus = "IMU active · \(update.measuredHertz.formatted(.number.precision(.fractionLength(1)))) Hz measured"

                    if self.lastDeviceSampleUptime.map({ update.sensorUptime - $0 >= 60 }) ?? true {
                        self.lastDeviceSampleUptime = update.sensorUptime
                        let elapsed = max(0, update.sensorUptime - sessionStartUptime)
                        let wallTime = startedAt.addingTimeInterval(elapsed)
                        _ = self.databaseWriter.appendDevice(Self.deviceSample(), recordedAt: wallTime, elapsedSeconds: elapsed)
                    }
                }
            },
            onError: { [weak self] error in
                guard let self else { return }
                Task { @MainActor in self.handleMotionError(error) }
            }
        )
    }

    private func handleMotionError(_ error: Error) {
        let current = motionReferenceFrame
        let nextFrame: CMAttitudeReferenceFrame?

        if current == .xTrueNorthZVertical {
            nextFrame = .xMagneticNorthZVertical
        } else if current == .xMagneticNorthZVertical {
            nextFrame = .xArbitraryCorrectedZVertical
        } else if current == .xArbitraryCorrectedZVertical {
            nextFrame = .xArbitraryZVertical
        } else {
            nextFrame = nil
        }

        if let next = nextFrame {
            motionReferenceFrame = next
            motionCaptureService.stop()
            startMotion()
        } else {
            fail(error.localizedDescription)
        }
    }

    private func startAltimeter() {
        guard CMAltimeter.isRelativeAltitudeAvailable() else { return }
        altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
            guard let self, let data else { return }
            Task { @MainActor in
                let sample = AltimeterSample(
                    relativeAltitudeMeters: data.relativeAltitude.doubleValue,
                    pressureKilopascals: data.pressure.doubleValue
                )
                self.latestAltimeter = sample
                self.relativeAltitudeMeters = sample.relativeAltitudeMeters
                self.pressureKilopascals = sample.pressureKilopascals
                if let elapsed = self.monotonicElapsed(at: data.timestamp), let startedAt = self.startedAt {
                    let wallTime = startedAt.addingTimeInterval(elapsed)
                    if !self.databaseWriter.appendAltimeter(sample, recordedAt: wallTime, elapsedSeconds: elapsed) {
                        self.fail(SessionDatabaseWriter.WriterError.queueFull.localizedDescription)
                    }
                }
            }
        }
    }

    private func fetchWeatherIfNeeded(at location: CLLocation) {
        guard !weatherRequestInFlight else { return }
        if let lastWeatherFetch, Date().timeIntervalSince(lastWeatherFetch) < 15 * 60 { return }
        weatherRequestInFlight = true
        weatherStatus = "Updating weather…"

        Task {
            defer { weatherRequestInFlight = false }
            do {
                let snapshot = try await weatherService.current(at: location.coordinate)
                guard isRecording else { return }
                weather = snapshot
                weatherStatus = "Updated"
                lastWeatherFetch = Date()
                guard let elapsed = monotonicElapsed() else { return }
                if !databaseWriter.appendWeather(snapshot, elapsedSeconds: elapsed) {
                    fail(SessionDatabaseWriter.WriterError.queueFull.localizedDescription)
                }
            } catch {
                weatherStatus = "Weather unavailable"
            }
        }
    }

    private func fail(_ message: String) {
        if isAcquiringGPS {
            locationManager.stopUpdatingLocation()
            UIApplication.shared.isIdleTimerDisabled = false
            state = .failed(message)
            return
        }
        guard isRecording else { return }
        stop(failureMessage: message)
        state = .failed(message)
    }

    private func monotonicElapsed(at uptime: TimeInterval = ProcessInfo.processInfo.systemUptime) -> TimeInterval? {
        guard let sessionStartUptime else { return nil }
        return max(0, uptime - sessionStartUptime)
    }

    private func monotonicElapsed(forSourceDate sourceDate: Date) -> TimeInterval? {
        let receiveDate = Date()
        let receiveUptime = ProcessInfo.processInfo.systemUptime
        let deliveryAge = max(0, receiveDate.timeIntervalSince(sourceDate))
        return monotonicElapsed(at: receiveUptime - deliveryAge)
    }

    private func recordLocation(_ location: CLLocation) {
        guard isRecording, let elapsed = monotonicElapsed(forSourceDate: location.timestamp) else { return }
        if let lastRecordedLocationSourceTime,
           location.timestamp.timeIntervalSince(lastRecordedLocationSourceTime) < 0.05 {
            return
        }
        lastRecordedLocationSourceTime = location.timestamp
        let deliveryDelay = Date().timeIntervalSince(location.timestamp)
        let isFresh = abs(deliveryDelay) <= 5

        if isFresh {
            capturedGPSCount += 1
            if firstGPSTimestamp == nil { firstGPSTimestamp = location.timestamp }
            if let firstGPSTimestamp, location.timestamp > firstGPSTimestamp {
                measuredGPSHertz = Double(capturedGPSCount - 1) / location.timestamp.timeIntervalSince(firstGPSTimestamp)
            }
        }

        let isGoodForLiveMetrics = isFresh && location.horizontalAccuracy <= 20
        if isGoodForLiveMetrics,
           let previous = previousDistanceLocation,
           location.timestamp > previous.timestamp {
            let increment = location.distance(from: previous)
            let segmentTime = location.timestamp.timeIntervalSince(previous.timestamp)
            if increment < max(100, segmentTime * 15) { distanceMeters += increment }
        }
        if isGoodForLiveMetrics { previousDistanceLocation = location }

        latestLocation = location
        coordinate = location.coordinate
        horizontalAccuracyMeters = location.horizontalAccuracy
        if isFresh {
            currentSpeedKilometersPerHour = location.speed >= 0 ? SensorMath.kilometersPerHour(metersPerSecond: location.speed) : 0
            courseDegrees = location.course >= 0 ? location.course : nil
        }

        let sample = Self.locationSample(location)
        guard let startedAt else { return }
        let wallTime = startedAt.addingTimeInterval(elapsed)
        if !databaseWriter.appendLocation(sample, recordedAt: wallTime, elapsedSeconds: elapsed) {
            fail(SessionDatabaseWriter.WriterError.queueFull.localizedDescription)
            return
        }
        fetchWeatherIfNeeded(at: location)
    }

    private static func locationSample(_ location: CLLocation) -> LocationSample {
        LocationSample(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            altitudeMeters: location.verticalAccuracy >= 0 ? location.altitude : nil,
            ellipsoidalAltitudeMeters: location.verticalAccuracy >= 0 ? location.ellipsoidalAltitude : nil,
            horizontalAccuracyMeters: location.horizontalAccuracy,
            verticalAccuracyMeters: location.verticalAccuracy >= 0 ? location.verticalAccuracy : nil,
            speedMetersPerSecond: location.speed >= 0 ? location.speed : nil,
            speedAccuracyMetersPerSecond: location.speedAccuracy >= 0 ? location.speedAccuracy : nil,
            courseDegrees: location.course >= 0 ? location.course : nil,
            courseAccuracyDegrees: location.courseAccuracy >= 0 ? location.courseAccuracy : nil,
            isSimulatedBySoftware: location.sourceInformation?.isSimulatedBySoftware,
            isProducedByAccessory: location.sourceInformation?.isProducedByAccessory,
            sourceTimestamp: location.timestamp
        )
    }

    private static func headingSample(_ heading: CLHeading) -> HeadingSample {
        HeadingSample(
            trueDegrees: heading.trueHeading >= 0 ? heading.trueHeading : nil,
            magneticDegrees: heading.magneticHeading,
            accuracyDegrees: heading.headingAccuracy,
            magneticFieldMicrotesla: Vector3(x: heading.x, y: heading.y, z: heading.z)
        )
    }

    private static func deviceSample() -> DeviceSample {
        let device = UIDevice.current
        return DeviceSample(
            batteryLevel: device.batteryLevel >= 0 ? Double(device.batteryLevel) : nil,
            batteryState: String(describing: device.batteryState)
        )
    }
}

extension SensorRecorder: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            let status = manager.authorizationStatus
            updateAuthorizationStatus(status)
            if isRecording && (status == .authorizedWhenInUse || status == .authorizedAlways) {
                manager.startUpdatingLocation()
                if CLLocationManager.headingAvailable() {
                    manager.startUpdatingHeading()
                }
            }
            switch status {
            case .authorizedWhenInUse where startAfterAuthorization,
                 .authorizedAlways where startAfterAuthorization:
                startAfterAuthorization = false
                prepareAccuracyAndBeginRecording()
            case .denied:
                shouldOfferSettings = true
                startAfterAuthorization = false
                if isRecording || isAcquiringGPS {
                    fail("Location permission was revoked while recording.")
                } else {
                    state = .failed("Location permission was denied. Open Settings and allow location access for Remus Sensors.")
                }
            case .restricted:
                shouldOfferSettings = false
                startAfterAuthorization = false
                if isRecording || isAcquiringGPS { fail("Location access became restricted while recording.") }
                else { state = .failed("Location access is restricted by Screen Time or device management.") }
            default:
                break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            let validLocations = locations
                .filter { $0.horizontalAccuracy >= 0 }
                .sorted { $0.timestamp < $1.timestamp }
            guard !validLocations.isEmpty else { return }

            if isAcquiringGPS {
                if let latest = validLocations.last {
                    horizontalAccuracyMeters = latest.horizontalAccuracy
                    coordinate = latest.coordinate
                    sensorStatus = "Acquiring GPS · ±\(latest.horizontalAccuracy.formatted(.number.precision(.fractionLength(1)))) m"
                }
                let now = Date()
                guard let initialFix = validLocations.last(where: {
                    abs(now.timeIntervalSince($0.timestamp)) <= 2 && $0.horizontalAccuracy <= 10
                }) else { return }

                beginRecording()
                guard isRecording else { return }
                recordLocation(initialFix)
                for location in validLocations where location.timestamp > initialFix.timestamp {
                    recordLocation(location)
                }
                return
            }

            if isRecording {
                for location in validLocations { recordLocation(location) }
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard newHeading.headingAccuracy >= 0 else { return }
        Task { @MainActor in
            latestHeading = newHeading
            headingDegrees = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
            if let elapsed = monotonicElapsed(forSourceDate: newHeading.timestamp), isRecording,
               let startedAt,
               !databaseWriter.appendHeading(
                Self.headingSample(newHeading),
                recordedAt: startedAt.addingTimeInterval(elapsed),
                elapsedSeconds: elapsed
               ) {
                fail(SessionDatabaseWriter.WriterError.queueFull.localizedDescription)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            guard let locationError = error as? CLError else {
                fail("Location error: \(error.localizedDescription)")
                return
            }
            switch locationError.code {
            case .locationUnknown:
                sensorStatus = "Waiting for a GPS fix"
            case .denied:
                shouldOfferSettings = true
                fail("GPS access was denied or Location Services are disabled. Check Settings → Privacy & Security → Location Services → Remus Sensors.")
            case .network:
                fail("GPS assistance network unavailable (Core Location error \(locationError.code.rawValue)).")
            default:
                fail("Core Location error \(locationError.code.rawValue): \(locationError.localizedDescription)")
            }
        }
    }
}

private final class MotionCaptureService {
    struct Update {
        let sampleCount: Int
        let measuredHertz: Double
        let accelerationG: Double
        let rotationRate: Double
        let rotationVector: Vector3
        let userAcceleration: Vector3
        let queuedWrites: Int
        let sensorUptime: TimeInterval
    }

    private let manager = CMMotionManager()
    private let queue: OperationQueue = {
        let queue = OperationQueue()
        queue.name = "com.espindola.remus.motion-capture"
        queue.qualityOfService = .userInitiated
        queue.maxConcurrentOperationCount = 1
        return queue
    }()

    static func preferredReferenceFrame() -> CMAttitudeReferenceFrame {
        let available = CMMotionManager.availableAttitudeReferenceFrames()
        if available.contains(.xMagneticNorthZVertical) { return .xMagneticNorthZVertical }
        if available.contains(.xArbitraryCorrectedZVertical) { return .xArbitraryCorrectedZVertical }
        return .xArbitraryZVertical
    }

    static func name(of frame: CMAttitudeReferenceFrame) -> String {
        switch frame {
        case .xTrueNorthZVertical: return "xTrueNorthZVertical"
        case .xMagneticNorthZVertical: return "xMagneticNorthZVertical"
        case .xArbitraryCorrectedZVertical: return "xArbitraryCorrectedZVertical"
        default: return "xArbitraryZVertical"
        }
    }

    func start(
        writer: SessionDatabaseWriter,
        sessionStartDate: Date,
        sessionStartUptime: TimeInterval,
        referenceFrame: CMAttitudeReferenceFrame,
        onUpdate: @escaping (Update) -> Void,
        onError: @escaping (Error) -> Void
    ) {
        guard manager.isDeviceMotionAvailable else {
            onError(NSError(domain: "RemusMotion", code: 1, userInfo: [NSLocalizedDescriptionKey: "Core Motion is unavailable on this device."]))
            return
        }

        let interval = 1.0 / 100.0
        manager.accelerometerUpdateInterval = interval
        manager.gyroUpdateInterval = interval
        manager.magnetometerUpdateInterval = interval
        manager.deviceMotionUpdateInterval = interval
        if manager.isAccelerometerAvailable { manager.startAccelerometerUpdates() }
        if manager.isGyroAvailable { manager.startGyroUpdates() }
        if manager.isMagnetometerAvailable { manager.startMagnetometerUpdates() }

        var sampleCount = 0
        var firstTimestamp: TimeInterval?
        manager.startDeviceMotionUpdates(using: referenceFrame, to: queue) { [weak self] motion, error in
            guard let self else { return }
            guard let motion else {
                if let error { onError(error) }
                return
            }

            let sample = self.makeSample(from: motion)
            let elapsed = max(0, motion.timestamp - sessionStartUptime)
            let wallTime = sessionStartDate.addingTimeInterval(elapsed)
            guard writer.appendMotion(sample, recordedAt: wallTime, elapsedSeconds: elapsed) else {
                onError(SessionDatabaseWriter.WriterError.queueFull)
                self.stop()
                return
            }

            sampleCount += 1
            if firstTimestamp == nil { firstTimestamp = motion.timestamp }
            guard sampleCount.isMultiple(of: 4), let firstTimestamp, motion.timestamp > firstTimestamp else { return }
            onUpdate(Update(
                sampleCount: sampleCount,
                measuredHertz: Double(sampleCount - 1) / (motion.timestamp - firstTimestamp),
                accelerationG: sample.userAccelerationG.magnitude,
                rotationRate: sample.rotationRateRadiansPerSecond.magnitude,
                rotationVector: sample.rotationRateRadiansPerSecond,
                userAcceleration: sample.userAccelerationG,
                queuedWrites: writer.queuedWriteCount,
                sensorUptime: motion.timestamp
            ))
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
        manager.stopAccelerometerUpdates()
        manager.stopGyroUpdates()
        manager.stopMagnetometerUpdates()
    }

    private func makeSample(from motion: CMDeviceMotion) -> MotionSample {
        let rawAcceleration = manager.accelerometerData?.acceleration
        let rawRotation = manager.gyroData?.rotationRate
        let rawMagnetic = manager.magnetometerData?.magneticField
        let calibratedMagnetic = motion.magneticField.field
        let attitude = motion.attitude
        return MotionSample(
            sensorTimestampSeconds: motion.timestamp,
            rawAccelerationG: rawAcceleration.map { Vector3(x: $0.x, y: $0.y, z: $0.z) },
            rawRotationRateRadiansPerSecond: rawRotation.map { Vector3(x: $0.x, y: $0.y, z: $0.z) },
            rawMagneticFieldMicrotesla: rawMagnetic.map { Vector3(x: $0.x, y: $0.y, z: $0.z) },
            userAccelerationG: Vector3(x: motion.userAcceleration.x, y: motion.userAcceleration.y, z: motion.userAcceleration.z),
            gravityG: Vector3(x: motion.gravity.x, y: motion.gravity.y, z: motion.gravity.z),
            rotationRateRadiansPerSecond: Vector3(x: motion.rotationRate.x, y: motion.rotationRate.y, z: motion.rotationRate.z),
            calibratedMagneticFieldMicrotesla: Vector3(x: calibratedMagnetic.x, y: calibratedMagnetic.y, z: calibratedMagnetic.z),
            magneticFieldCalibrationAccuracy: Int(motion.magneticField.accuracy.rawValue),
            attitude: AttitudeSample(
                rollRadians: attitude.roll,
                pitchRadians: attitude.pitch,
                yawRadians: attitude.yaw,
                quaternionX: attitude.quaternion.x,
                quaternionY: attitude.quaternion.y,
                quaternionZ: attitude.quaternion.z,
                quaternionW: attitude.quaternion.w
            )
        )
    }
}
