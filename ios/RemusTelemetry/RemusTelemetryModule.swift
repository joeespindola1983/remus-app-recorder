import Foundation
import React
import Combine

@objc(RemusTelemetryModule)
class RemusTelemetryModule: RCTEventEmitter {
    private var recorder: SensorRecorder?
    private var activeSessionFolder: URL?
    private var activeSessionID: UUID?
    private var cancellables = Set<AnyCancellable>()
    
    override func supportedEvents() -> [String]! {
        return ["onTelemetryUpdate"]
    }

    @objc
    func startRecording(_ params: NSDictionary,
                        resolver resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
        
        DispatchQueue.main.async {
            let recorder = SensorRecorder()
            self.recorder = recorder
            
            // Subscribe to sensor telemetry updates to send to React Native
            recorder.$currentSpeedKilometersPerHour
                .sink { [weak self] speed in
                    guard let self = self, let rec = self.recorder else { return }
                    self.sendEvent(withName: "onTelemetryUpdate", body: [
                        "speedKmh": speed,
                        "distanceMeters": rec.distanceMeters,
                        "courseDegrees": (rec.courseDegrees ?? 0) as Any,
                        "headingDegrees": (rec.headingDegrees ?? 0) as Any,
                        "accelerationG": rec.accelerationG,
                        "rotationRateRad": rec.rotationRate,
                        "gpsRateHz": rec.measuredGPSHertz,
                        "imuSamples": rec.sampleCount
                    ])
                }
                .store(in: &self.cancellables)

            // Start recording
            self.recorder?.start()
            // In the real app, we need to wait for GPS fix before recording starts (SensorRecorder handles this internally)
            
            // For now, resolve immediately to unblock the UI
            resolve([
                "sessionId": UUID().uuidString,
                "folderUri": ""
            ])
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
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
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

                sessions.append([
                    "id": manifest.id.uuidString,
                    "folderUri": folder.path,
                    "startedAt": isoFormatter.string(from: manifest.startedAt),
                    "endedAt": manifest.endedAt.map { isoFormatter.string(from: $0) } ?? "",
                    "sampleCount": manifest.motionSampleCount,
                    "durationSeconds": max(0, duration),
                    "placement": "hull",
                    "sizeBytes": folderSize,
                    "hasWatchRecording": hasWatch
                ])
            }

            sessions.sort { ($0["startedAt"] as? String ?? "") > ($1["startedAt"] as? String ?? "") }
            resolve(sessions)
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
        do {
            let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let root = documents.appendingPathComponent("RemusSessions", isDirectory: true)
            let entries = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            guard let folder = entries.first(where: { $0.lastPathComponent.contains(sessionId.prefix(8)) }) else {
                reject("NOT_FOUND", "Session folder not found: \(sessionId)", nil)
                return
            }
            let manifestURL = folder.appendingPathComponent("manifest.json")
            let data = try Data(contentsOf: manifestURL)
            let manifest = try JSONDecoder().decode(RecordingManifest.self, from: data)
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
