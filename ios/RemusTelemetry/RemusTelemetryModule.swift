import Foundation
import React
import Combine
import CoreLocation

@objc(RemusTelemetryModule)
class RemusTelemetryModule: RCTEventEmitter {
    private var recorder: SensorRecorder?
    private var activeSessionFolder: URL?
    private var activeSessionID: UUID?
    private var cancellables = Set<AnyCancellable>()
    private var permissionLocationManager: CLLocationManager?

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
    
    override func supportedEvents() -> [String]! {
        return ["onTelemetryUpdate"]
    }

    @objc
    func startRecording(_ params: NSDictionary,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        
        DispatchQueue.main.async {
            guard self.recorder == nil else { reject("ALREADY_RECORDING", "A recording is already in progress", nil); return }
            let recorder = SensorRecorder()
            self.recorder = recorder
            
            // Subscribe to sensor telemetry updates to send to React Native
            recorder.$currentSpeedKilometersPerHour
                .sink { [weak self] speed in
                    guard let self = self, let rec = self.recorder else { return }
                    self.sendEvent(withName: "onTelemetryUpdate", body: [
                        "speedKmh": speed,
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
                        "speedKmh": rec.currentSpeedKilometersPerHour,
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
                self.activeSessionFolder = folder
                self.activeSessionID = sessionUUID
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
            
            let folderURL = recorder.lastSessionURL
            self.recorder = nil
            
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
                let hasWatch = FileManager.default.fileExists(atPath: watchFolder.path)
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
                    "contextCompleteness": context?["contextCompleteness"] as? String ?? "needs_required_context"
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
}
