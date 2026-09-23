import Foundation
import React
import Combine
import CoreLocation
import AudioToolbox
import AVFoundation
import WatchConnectivity
import CoreBluetooth

@objc(RemusTelemetryModule)
class RemusTelemetryModule: RCTEventEmitter {
    private var recorder: SensorRecorder?
    private var activeSessionFolder: URL?
    private var activeSessionID: UUID?
    private var lastStoppedFolder: URL?
    private var lastStoppedSessionID: UUID?
    private var cancellables = Set<AnyCancellable>()
    private var permissionLocationManager: CLLocationManager?
    private var hornAudioPlayer: AVAudioPlayer?

    // REMUS Hardware BLE
    private var centralManager: CBCentralManager?
    private var remusPeripheral: CBPeripheral?
    private var remusCharacteristic: CBCharacteristic?
    private let remusServiceUUID = CBUUID(string: "4fafc201-1fb5-459e-8fcc-c5c9c331914b")
    private let remusCharUUID = CBUUID(string: "beb5483e-36e1-4688-b7f5-ea07361b26a8")

    override init() {
        super.init()
        DispatchQueue.main.async { [weak self] in
            self?.setupWatchTelemetryHandlers()
        }
    }

    @MainActor
    private func setupWatchTelemetryHandlers() {
        WatchImportService.shared.onHeartRateReceived = nil
        WatchImportService.shared.onWatchActiveChanged = nil
        WatchImportService.shared.onRecordingStateReceived = { [weak self] payload in
            guard let self, self.acceptsWatchPayload(payload) else { return }
            let state = payload["recordingState"] as? String ?? "unknown"
            let active = state == "recording"
            self.sendEvent(withName: "onTelemetryUpdate", body: [
                "watchActive": active,
                "watchRecordingState": state
            ])
        }
        WatchImportService.shared.onWatchTelemetryReceived = { [weak self] payload in
            guard let self = self else { return }
            guard self.acceptsWatchPayload(payload) else {
                NSLog("[RemusTelemetryModule] Ignoring Watch payload from a different phone session")
                return
            }
            let num = { (key: String) -> Double? in
                if let n = payload[key] as? NSNumber { return n.doubleValue }
                if let d = payload[key] as? Double { return d }
                if let i = payload[key] as? Int { return Double(i) }
                if let s = payload[key] as? String { return Double(s) }
                return nil
            }
            if let hr = num("heartRate") ?? num("heartRateBpm"), hr > 0 {
                self.sendEvent(withName: "onTelemetryUpdate", body: [
                    "heartRateBpm": hr,
                    "watchActive": true
                ])
            }
            if let folder = self.activeSessionFolder ?? self.lastStoppedFolder {
                self.appendWatchTelemetryCsv(payload: payload, folder: folder)
            } else {
                NSLog("[RemusTelemetryModule] Received watch telemetry but no active/stopped session folder available")
            }
        }
    }

    private func acceptsWatchPayload(_ payload: [String: Any]) -> Bool {
        guard let text = payload["phoneSessionID"] as? String,
              let payloadID = UUID(uuidString: text) else {
            // Legacy Watch builds did not carry correlation. Accept them only while
            // a phone recording is active, never into an arbitrary stopped session.
            return activeSessionID != nil
        }
        return payloadID == activeSessionID || payloadID == lastStoppedSessionID
    }

    @objc
    func requestPermissions(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            let manager = self.permissionLocationManager ?? CLLocationManager()
            self.permissionLocationManager = manager
            let status = manager.authorizationStatus
            if status == .notDetermined {
                manager.requestWhenInUseAuthorization()
                resolve(["status": "requested", "authorized": false])
            } else {
                let authorized = (status == .authorizedWhenInUse || status == .authorizedAlways)
                resolve(["status": authorized ? "authorized" : "denied", "authorized": authorized])
            }
        }
    }

    @objc
    func checkPermissions(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            let status = CLLocationManager().authorizationStatus
            let authorized = (status == .authorizedWhenInUse || status == .authorizedAlways)
            let statusStr: String
            switch status {
            case .notDetermined: statusStr = "notDetermined"
            case .restricted: statusStr = "restricted"
            case .denied: statusStr = "denied"
            case .authorizedAlways: statusStr = "authorizedAlways"
            case .authorizedWhenInUse: statusStr = "authorizedWhenInUse"
            @unknown default: statusStr = "unknown"
            }
            resolve(["status": statusStr, "authorized": authorized])
        }
    }

    private func sessionRoot() throws -> URL {
        try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("RemusSessions", isDirectory: true)
    }

    @objc func getRecordingContext(_ recordingId: String, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        do {
            let folder = try RecordingContextStore.resolve(root: sessionRoot(), id: recordingId)
            let data = try JSONSerialization.data(withJSONObject: RecordingContextStore.read(folder))
            resolve(String(decoding: data, as: UTF8.self))
        } catch { reject("CONTEXT_ERROR", error.localizedDescription, error) }
    }

    @objc func saveRecordingContext(_ recordingId: String, json: String, finalize: Bool, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        do {
            let folder = try RecordingContextStore.resolve(root: sessionRoot(), id: recordingId)
            let context = try RecordingContextStore.save(folder, json: json, finalize: finalize)
            resolve(String(decoding: try JSONSerialization.data(withJSONObject: context), as: UTF8.self))
        } catch { reject("CONTEXT_ERROR", error.localizedDescription, error) }
    }

    @objc func getRecordingState(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            var state: [String: Any] = ["isRecording": self.recorder != nil]
            if let id = self.activeSessionID, self.recorder != nil {
                state["sessionId"] = id.uuidString
                if let folder = self.activeSessionFolder, let m = try? RecordingContextStore.manifest(folder),
                   let date = m["startedAt"] as? String, let started = RecordingContextStore.parseDate(date) {
                    state["elapsedSeconds"] = max(0, Date().timeIntervalSince(started))
                }
            }
            resolve(state)
        }
    }
    
    @objc
    func playBeep(_ isLoud: Bool, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        if isLoud {
            let fallbackPath = "/Users/home/Downloads/bbc_motor-horn_07037284.mp3"
            let soundURL = Bundle.main.url(forResource: "motor_horn", withExtension: "mp3") ??
                           (FileManager.default.fileExists(atPath: fallbackPath) ? URL(fileURLWithPath: fallbackPath) : nil)

            if let url = soundURL {
                do {
                    try AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
                    try AVAudioSession.sharedInstance().setActive(true)
                    hornAudioPlayer = try AVAudioPlayer(contentsOf: url)
                    hornAudioPlayer?.prepareToPlay()
                    hornAudioPlayer?.play()
                    resolve(nil)
                    return
                } catch {
                    print("RemusTelemetryModule: Error playing horn mp3: \(error)")
                }
            }
            AudioServicesPlaySystemSound(1054)
        } else {
            AudioServicesPlaySystemSound(1052)
        }
        resolve(nil)
    }

    override func supportedEvents() -> [String]! {
        return ["onTelemetryUpdate", "onRemusDeviceTelemetry", "onRemusDeviceConnectionState", "onWatchTransferProgress"]
    }

    @objc
    func startRecording(_ params: NSDictionary,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        
        DispatchQueue.main.async {
            guard self.recorder == nil else { reject("ALREADY_RECORDING", "A recording is already in progress", nil); return }
            let recorder = SensorRecorder()
            self.recorder = recorder

            Task { @MainActor () -> Void in
                self.setupWatchTelemetryHandlers()
                WatchImportService.shared.onWatchTransferProgress = { [weak self] pct, progress, status, sessionID, error in
                    var body: [String: Any] = [
                        "percentage": pct,
                        "progress": progress,
                        "status": status
                    ]
                    if let sessionID = sessionID { body["sessionID"] = sessionID }
                    if let error = error { body["error"] = error }
                    self?.sendEvent(withName: "onWatchTransferProgress", body: body)
                }
            }
            
            // Subscribe to sensor telemetry updates to send to React Native
            recorder.$currentSpeedKilometersPerHour
                .sink { [weak self] speed in
                    guard let self = self, let rec = self.recorder else { return }
                    self.sendEvent(withName: "onTelemetryUpdate", body: [
                        "speedKmh": speed.map { $0 as Any } ?? NSNull(),
                        "speedOrigin": rec.speedOrigin.rawValue,
                        "courseOrigin": rec.courseOrigin.rawValue,
                        "distanceMeters": rec.distanceMeters,
                        "courseDegrees": rec.courseDegrees.map { $0 as Any } ?? NSNull(),
                        "headingDegrees": rec.headingDegrees.map { $0 as Any } ?? NSNull(),
                        "accelerationG": rec.accelerationG,
                        "gpsAccuracyMeters": rec.horizontalAccuracyMeters.map { $0 as Any } ?? NSNull(),
                        "gpsRateHz": rec.measuredGPSHertz,
                        "imuSamples": rec.sampleCount
                    ])
                }
                .store(in: &self.cancellables)

            recorder.$horizontalAccuracyMeters
                .sink { [weak self] accuracy in
                    guard let self = self, let rec = self.recorder else { return }
                    self.sendEvent(withName: "onTelemetryUpdate", body: [
                        "speedKmh": rec.currentSpeedKilometersPerHour.map { $0 as Any } ?? NSNull(),
                        "speedOrigin": rec.speedOrigin.rawValue,
                        "courseOrigin": rec.courseOrigin.rawValue,
                        "distanceMeters": rec.distanceMeters,
                        "courseDegrees": rec.courseDegrees.map { $0 as Any } ?? NSNull(),
                        "headingDegrees": rec.headingDegrees.map { $0 as Any } ?? NSNull(),
                        "accelerationG": rec.accelerationG,
                        "gpsAccuracyMeters": accuracy.map { $0 as Any } ?? NSNull(),
                        "gpsRateHz": rec.measuredGPSHertz,
                        "imuSamples": rec.sampleCount
                    ])
                }
                .store(in: &self.cancellables)

            recorder.$rotationVector.sink { [weak self] vector in
                self?.sendEvent(withName: "onTelemetryUpdate", body: [
                    "rotationXRad": vector.map { $0.x as Any } ?? NSNull(),
                    "rotationYRad": vector.map { $0.y as Any } ?? NSNull(),
                    "rotationZRad": vector.map { $0.z as Any } ?? NSNull()
                ])
            }.store(in: &self.cancellables)

            // SensorRecorder already fetches and writes Open-Meteo snapshots.
            // Forward them to the shared React Native recorder UI as well.
            recorder.$weather
                .sink { [weak self] snapshot in
                    guard let self, let snapshot else { return }
                    self.sendEvent(withName: "onTelemetryUpdate", body: [
                        "weatherStatus": "Updated",
                        "weatherTemperatureC": snapshot.temperatureCelsius.map { $0 as Any } ?? NSNull(),
                        "weatherHumidityPercent": snapshot.relativeHumidityPercent.map { $0 as Any } ?? NSNull(),
                        "weatherWindKmh": snapshot.windSpeedKilometersPerHour.map { $0 as Any } ?? NSNull()
                    ])
                }
                .store(in: &self.cancellables)

            recorder.$liveStrokeRate
                .compactMap { $0 }
                .sink { [weak self] estimate in
                    self?.sendEvent(withName: "onTelemetryUpdate", body: estimate)
                }
                .store(in: &self.cancellables)

            recorder.$weatherStatus
                .sink { [weak self] status in
                    self?.sendEvent(withName: "onTelemetryUpdate", body: ["weatherStatus": status])
                }
                .store(in: &self.cancellables)

            let sessionIdStr = (params["sessionId"] as? String) ?? UUID().uuidString
            let sessionUUID = UUID(uuidString: sessionIdStr) ?? UUID()
            let notes = (params["notes"] as? String) ?? ""
            let motionFreq = (params["motionFrequencyHertz"] as? Double) ?? 100.0
            let placement = (params["placement"] as? String) ?? "unknown"

            let metadata = SessionMetadata(
                sessionID: sessionUUID,
                startedAt: Date(),
                appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
                deviceModel: UIDevice.current.model,
                systemVersion: UIDevice.current.systemVersion,
                motionFrequencyHertz: motionFreq,
                notes: notes,
                placement: placement,
                schemaVersion: "1.0.0",
                producer: "remus-app-recorder",
                producerPlatform: "ios",
                orientationUnits: "radians"
            )

            do {
                let folder = try recorder.startImmediately(metadata: metadata)
                _ = try RecordingContextStore.read(folder, capture: true)
                self.lastStoppedFolder = nil
                self.lastStoppedSessionID = nil
                self.activeSessionFolder = folder
                self.activeSessionID = sessionUUID
                WatchImportService.setExplicitTargetFolder(folder)
                if WCSession.isSupported() {
                    let session = WCSession.default
                    if session.isPaired {
                        let watchCsvURL = folder.appendingPathComponent("watch.csv")
                        let header = "timestamp_iso,elapsed_s,heart_rate_bpm,user_ax_g,user_ay_g,user_az_g,gravity_x_g,gravity_y_g,gravity_z_g,rotation_x_rads,rotation_y_rads,rotation_z_rads,roll_rad,pitch_rad,yaw_rad,latitude,longitude,speed_mps,accuracy_m,active_energy_kcal,battery_pct\n"
                        try? header.write(to: watchCsvURL, atomically: true, encoding: .utf8)
                    }
                }
                resolve([
                    "sessionId": sessionUUID.uuidString,
                    "folderUri": folder.path
                ])
            } catch {
                recorder.stop()
                self.recorder = nil
                self.cancellables.removeAll()
                reject("START_ERROR", "Failed to start telemetry recording: \(error.localizedDescription)", error)
            }
        }
    }

    @objc
    func stopRecording(_ resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            guard let recorder = self.recorder else {
                reject("NOT_RECORDING", "No active session recording", nil)
                return
            }
            
            recorder.stop()
            self.cancellables.removeAll()
            self.sendEvent(withName: "onTelemetryUpdate", body: ["watchActive": false])
            
            let folderURL = recorder.lastSessionURL
            self.lastStoppedFolder = folderURL
            self.lastStoppedSessionID = self.activeSessionID
            self.recorder = nil
            self.activeSessionFolder = nil
            self.activeSessionID = nil

            // Attach any Watch recordings that arrived during this session directly to this session
            if let folder = folderURL {
                WatchImportService.setExplicitTargetFolder(folder)
                WatchImportService.attachPendingImports(targetFolder: folder)
            } else {
                WatchImportService.attachPendingImports()
            }
            
            guard let folder = folderURL else {
                reject("STOP_ERROR", "Failed to retrieve session folder", nil)
                return
            }

            let manifestURL = folder.appendingPathComponent("manifest.json")
            do {
                let data = try Data(contentsOf: manifestURL)
                let json = try JSONSerialization.jsonObject(with: data)
                resolve(json)
            } catch {
                reject("MANIFEST_ERROR", "Could not read manifest.json", error)
            }
        }
    }

    @objc
    func listSessions(_ resolve: @escaping RCTPromiseResolveBlock,
                      rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            // Process any pending Watch imports so badges and file lists are accurate
            WatchImportService.attachPendingImports()

            let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let root = documents.appendingPathComponent("RemusSessions", isDirectory: true)
            guard FileManager.default.fileExists(atPath: root.path) else {
                resolve([])
                return
            }

            let entries = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])
            let decoder = JSONDecoder.telemetryDecoder
            let isoFormatter = ISO8601DateFormatter()
            var sessions: [[String: Any]] = []

            for folder in entries {
                let manifestURL = folder.appendingPathComponent("manifest.json")
                guard FileManager.default.fileExists(atPath: manifestURL.path),
                      let data = try? Data(contentsOf: manifestURL),
                      let manifest = try? decoder.decode(RecordingManifest.self, from: data) else {
                    continue
                }

                var folderSize: Int64 = 0
                if let enumerator = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.fileSizeKey], options: [.skipsHiddenFiles]) {
                    for case let fileURL as URL in enumerator {
                        if let size = try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize {
                            folderSize += Int64(size)
                        }
                    }
                }

                let duration = (manifest.endedAt ?? Date()).timeIntervalSince(manifest.startedAt)
                let watchFolder = folder.appendingPathComponent("watch")
                let hasWatch = FileManager.default.fileExists(atPath: folder.appendingPathComponent("watch.csv").path) ||
                               FileManager.default.fileExists(atPath: watchFolder.path)
                let contextData = try? Data(contentsOf: folder.appendingPathComponent(RecordingContextStore.filename))
                let context = contextData.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }

                sessions.append([
                    "id": manifest.id.uuidString,
                    "folderUri": folder.path,
                    "startedAt": isoFormatter.string(from: manifest.startedAt),
                    "endedAt": manifest.endedAt.map { isoFormatter.string(from: $0) } ?? "",
                    "sampleCount": manifest.motionSampleCount,
                    "durationSeconds": max(0, duration),
                    "placement": context?["sensorPlacement"] as? String ?? manifest.placement,
                    "sizeBytes": folderSize,
                    "hasWatchRecording": hasWatch,
                    "status": manifest.status.rawValue,
                    "contextCompleteness": context?["contextCompleteness"] as? String ?? "needs_required_context",
                    "sessionTitle": context?["sessionTitle"] as? String
                ])
            }

            let sortedSessions = sessions.sorted { (a, b) -> Bool in
                let startA = (a["startedAt"] as? String) ?? ""
                let startB = (b["startedAt"] as? String) ?? ""
                return startA > startB
            }
            resolve(sortedSessions)
        } catch {
            reject("LIST_ERROR", error.localizedDescription, error)
        }
    }

    @objc
    func deleteSession(_ sessionId: String,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        do {
            let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let root = documents.appendingPathComponent("RemusSessions", isDirectory: true)
            let entries = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            for folder in entries where folder.lastPathComponent.contains(sessionId.prefix(8)) {
                try FileManager.default.removeItem(at: folder)
                resolve(true)
                return
            }
            resolve(false)
        } catch {
            reject("DELETE_ERROR", error.localizedDescription, error)
        }
    }

    @objc
    func exportSessionZip(_ sessionId: String,
                          resolver resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
        exportArchive(sessionId, raw: false, resolve: resolve, reject: reject)
    }

    @objc func exportRawSessionZip(_ sessionId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        exportArchive(sessionId, raw: true, resolve: resolve, reject: reject)
    }

    private func exportArchive(_ sessionId: String, raw: Bool, resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
        do {
            // Attach any pending Watch imports before generating the archive
            WatchImportService.attachPendingImports()

            let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let root = documents.appendingPathComponent("RemusSessions", isDirectory: true)
            let folder = try RecordingContextStore.resolve(root: root, id: sessionId)
            let context = try RecordingContextStore.read(folder)
            guard context["captureStatus"] as? String != "recording" else { throw RecordingContextStore.error("Stop recording before exporting") }
            if !raw { try RecordingContextStore.requireComplete(folder) }
            let manifestURL = folder.appendingPathComponent("manifest.json")
            let data = try Data(contentsOf: manifestURL)
            let manifest = try JSONDecoder.telemetryDecoder.decode(RecordingManifest.self, from: data)
            let session = RecordingSession(manifest: manifest, folderURL: folder, sizeBytes: 0)
            let zipURL = try ZipArchiveService.createArchive(for: session)
            resolve(zipURL.path)
        } catch {
            reject("ZIP_ERROR", error.localizedDescription, error)
        }
    }

    @objc
    func requestWatchRecovery(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            WatchImportService.shared.requestWatchRecovery()
            resolve(true)
        }
    }

    @objc
    func requestWatchStopAndTransfer(_ resolve: @escaping RCTPromiseResolveBlock,
                                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            if let target = self.lastStoppedFolder ?? self.activeSessionFolder {
                WatchImportService.setExplicitTargetFolder(target)
            }

            WatchImportService.shared.onWatchTransferProgress = { [weak self] pct, progress, status, sessionID, error in
                var body: [String: Any] = [
                    "percentage": pct,
                    "progress": progress,
                    "status": status
                ]
                if let sessionID = sessionID { body["sessionID"] = sessionID }
                if let error = error { body["error"] = error }
                self?.sendEvent(withName: "onWatchTransferProgress", body: body)
            }

            WatchImportService.shared.requestWatchStopAndTransfer { success, error in
                if let error = error {
                    reject("WATCH_TRANSFER_FAILED", error.localizedDescription, error)
                } else {
                    resolve(success)
                }
            }
        }
    }

    @objc
    func connectRemusBle(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            self.sendEvent(withName: "onRemusDeviceConnectionState", body: ["state": "scanning"])
            if self.centralManager == nil {
                self.centralManager = CBCentralManager(delegate: self, queue: nil)
            } else if self.centralManager?.state == .poweredOn {
                self.startBleScan()
            }
            resolve(true)
        }
    }

    @objc
    func disconnectRemusBle(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            if let peripheral = self.remusPeripheral {
                self.centralManager?.cancelPeripheralConnection(peripheral)
            }
            self.remusPeripheral = nil
            self.remusCharacteristic = nil
            self.sendEvent(withName: "onRemusDeviceConnectionState", body: ["state": "disconnected"])
            resolve(true)
        }
    }

    @objc
    func sendRemusBleCommand(_ command: String,
                             resolver resolve: @escaping RCTPromiseResolveBlock,
                             rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            guard let peripheral = self.remusPeripheral,
                  let characteristic = self.remusCharacteristic else {
                reject("BLE_NOT_CONNECTED", "REMUS device not connected", nil)
                return
            }
            guard let data = command.data(using: .utf8) else {
                reject("INVALID_COMMAND", "Unable to encode command to UTF-8", nil)
                return
            }
            let type: CBCharacteristicWriteType = characteristic.properties.contains(.write) ? .withResponse : .withoutResponse
            peripheral.writeValue(data, for: characteristic, type: type)
            resolve(true)
        }
    }

    private func startBleScan() {
        centralManager?.scanForPeripherals(withServices: [remusServiceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }
}

extension RemusTelemetryModule: CBCentralManagerDelegate, CBPeripheralDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn {
            startBleScan()
        } else {
            sendEvent(withName: "onRemusDeviceConnectionState", body: ["state": "disconnected"])
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        self.remusPeripheral = peripheral
        peripheral.delegate = self
        central.stopScan()
        central.connect(peripheral, options: nil)
        sendEvent(withName: "onRemusDeviceConnectionState", body: ["state": "connecting", "name": peripheral.name ?? "REMUS"])
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        self.remusPeripheral = peripheral
        peripheral.delegate = self
        peripheral.discoverServices(nil)
        sendEvent(withName: "onRemusDeviceConnectionState", body: ["state": "connected", "name": peripheral.name ?? "REMUS"])
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        self.remusPeripheral = nil
        self.remusCharacteristic = nil
        sendEvent(withName: "onRemusDeviceConnectionState", body: ["state": "disconnected"])
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let services = peripheral.services else { return }
        for service in services {
            peripheral.discoverCharacteristics(nil, for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let characteristics = service.characteristics else { return }
        for characteristic in characteristics {
            if characteristic.uuid.uuidString.caseInsensitiveCompare(remusCharUUID.uuidString) == .orderedSame {
                self.remusCharacteristic = characteristic
                peripheral.setNotifyValue(true, for: characteristic)
                peripheral.readValue(for: characteristic)
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value else { return }
        let csv = String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
        // Removed excessive logging of every received packet
        sendEvent(withName: "onRemusDeviceTelemetry", body: ["csv": csv])

        // Append to active session archive if currently recording
        if let folder = self.activeSessionFolder {
            let fileURL = folder.appendingPathComponent("remus_device.csv")
            let line = csv.hasSuffix("\n") ? csv : "\(csv)\n"
            if let fileHandle = try? FileHandle(forWritingTo: fileURL) {
                fileHandle.seekToEndOfFile()
                if let lineData = line.data(using: .utf8) {
                    fileHandle.write(lineData)
                }
                fileHandle.closeFile()
            } else {
                let header = "timestamp_ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps,lat,lon,ground_speed_kmh,sats,records_written,gps_chars,stroke_rate_spm,imu_ok,sd_ok,imu_gap_count,max_imu_gap_ms,buffer_overflow_count,imu_read_failure_count,speed_accuracy_mps,course_degrees,course_accuracy_degrees,fix_type,gps_itow_ms\n"
                let initialContent = header + line
                try? initialContent.write(to: fileURL, atomically: true, encoding: .utf8)
            }
        }

        // Relay live telemetry to Apple Watch companion app
        if WCSession.isSupported() {
            let session = WCSession.default
            if session.activationState == .activated && session.isReachable {
                let parts = csv.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ",")
                var payload: [String: Any] = ["command": "liveTelemetry"]
                if parts.count > 9, let speed = Double(parts[9]) {
                    payload["speedKmh"] = speed
                }
                if parts.count > 13, let spm = Double(parts[13]) {
                    payload["strokeRateSpm"] = spm
                }
                session.sendMessage(payload, replyHandler: nil, errorHandler: nil)
            }
        }
    }

    private func appendWatchTelemetryCsv(payload: [String: Any], folder: URL) {
        let fileURL = folder.appendingPathComponent("watch.csv")
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        let num = { (key: String) -> Double? in
            if let n = payload[key] as? NSNumber { return n.doubleValue }
            if let d = payload[key] as? Double { return d }
            if let i = payload[key] as? Int { return Double(i) }
            if let s = payload[key] as? String { return Double(s) }
            return nil
        }

        let now = num("timestamp").map { Date(timeIntervalSince1970: $0) } ?? Date()
        let isoTime = isoFormatter.string(from: now)
        let elapsed = num("elapsed") ?? 0.0

        let hrVal = num("heartRate") ?? num("heartRateBpm")
        let hrStr = hrVal.map { String(format: "%.1f", $0) } ?? ""
        let uAxStr = num("userAx").map { String(format: "%.4f", $0) } ?? ""
        let uAyStr = num("userAy").map { String(format: "%.4f", $0) } ?? ""
        let uAzStr = num("userAz").map { String(format: "%.4f", $0) } ?? ""
        let gXStr = num("gravityX").map { String(format: "%.4f", $0) } ?? ""
        let gYStr = num("gravityY").map { String(format: "%.4f", $0) } ?? ""
        let gZStr = num("gravityZ").map { String(format: "%.4f", $0) } ?? ""
        let rXStr = num("rotationX").map { String(format: "%.4f", $0) } ?? ""
        let rYStr = num("rotationY").map { String(format: "%.4f", $0) } ?? ""
        let rZStr = num("rotationZ").map { String(format: "%.4f", $0) } ?? ""
        let rollStr = num("roll").map { String(format: "%.4f", $0) } ?? ""
        let pitchStr = num("pitch").map { String(format: "%.4f", $0) } ?? ""
        let yawStr = num("yaw").map { String(format: "%.4f", $0) } ?? ""
        let latStr = num("latitude").map { String(format: "%.7f", $0) } ?? ""
        let lonStr = num("longitude").map { String(format: "%.7f", $0) } ?? ""
        let speedStr = num("speed").map { String(format: "%.2f", $0) } ?? ""
        let accStr = num("accuracy").map { String(format: "%.1f", $0) } ?? ""
        let energyStr = num("activeEnergy").map { String(format: "%.1f", $0) } ?? ""
        let battStr = num("battery").map { String(format: "%.1f", $0) } ?? ""

        let line = "\(isoTime),\(String(format: "%.2f", elapsed)),\(hrStr),\(uAxStr),\(uAyStr),\(uAzStr),\(gXStr),\(gYStr),\(gZStr),\(rXStr),\(rYStr),\(rZStr),\(rollStr),\(pitchStr),\(yawStr),\(latStr),\(lonStr),\(speedStr),\(accStr),\(energyStr),\(battStr)\n"

        if let fileHandle = try? FileHandle(forWritingTo: fileURL) {
            fileHandle.seekToEndOfFile()
            if let lineData = line.data(using: .utf8) {
                fileHandle.write(lineData)
                NSLog("[RemusTelemetryModule] Appended watch CSV line to %@ (elapsed: %.1fs, hr: %@)", fileURL.lastPathComponent, elapsed, hrStr)
            }
            fileHandle.closeFile()
        } else {
            let header = "timestamp_iso,elapsed_s,heart_rate_bpm,user_ax_g,user_ay_g,user_az_g,gravity_x_g,gravity_y_g,gravity_z_g,rotation_x_rads,rotation_y_rads,rotation_z_rads,roll_rad,pitch_rad,yaw_rad,latitude,longitude,speed_mps,accuracy_m,active_energy_kcal,battery_pct\n"
            let initialContent = header + line
            try? initialContent.write(to: fileURL, atomically: true, encoding: .utf8)
            NSLog("[RemusTelemetryModule] Created watch CSV with first line in %@", fileURL.lastPathComponent)
        }
    }
}
