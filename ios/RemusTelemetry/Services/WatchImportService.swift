import Foundation
import WatchConnectivity

struct WatchImport: Identifiable, Equatable {
    let id: UUID
    let startedAt: Date
    let endedAt: Date
    let sampleCount: Int
    let archiveURL: URL
    let attachedSessionName: String?

    var duration: TimeInterval { max(0, endedAt.timeIntervalSince(startedAt)) }
}

@MainActor
final class WatchImportService: NSObject, ObservableObject {
    static let shared = WatchImportService()
    var onHeartRateReceived: ((Double) -> Void)?
    var onWatchActiveChanged: ((Bool) -> Void)?


    @Published private(set) var imports: [WatchImport] = []
    @Published private(set) var connectionStatus = "Activating Apple Watch connection"
    @Published private(set) var workoutStatus = "Waiting for Watch workout"
    @Published private(set) var recoveryStatus = ""
    @Published private(set) var lastError: String?

    override init() {
        super.init()
        activate()
        reload()
    }

    func reload() {
        do {
            imports = try Self.scanImports().sorted { $0.startedAt > $1.startedAt }
            connectionStatus = WCSession.isSupported() ? "Ready to receive Watch recordings" : "Watch Connectivity unavailable"
        } catch {
            lastError = error.localizedDescription
        }
    }

    func retryPendingAssociations() {
        do {
            try Self.attachPendingImports()
            reload()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func clearError() {
        lastError = nil
    }

    func requestWatchRecovery() {
        guard WCSession.isSupported() else {
            recoveryStatus = "Apple Watch connectivity is unavailable"
            return
        }

        let session = WCSession.default
        let requestID = UUID().uuidString
        let payload: [String: Any] = [
            "command": "recoverWatchArchives",
            "requestID": requestID,
            "requestedAt": Date().timeIntervalSince1970
        ]

        // User-info transfer survives an unreachable Watch and is delivered later.
        session.transferUserInfo(payload)
        recoveryStatus = session.isReachable
            ? "Asking Apple Watch to resend local recordings…"
            : "Recovery queued · waiting for Apple Watch"

        guard session.activationState == .activated, session.isReachable else { return }
        session.sendMessage(payload, replyHandler: nil) { [weak self] error in
            Task { @MainActor in
                self?.recoveryStatus = "Recovery queued · \(error.localizedDescription)"
            }
        }
    }

    private func activate() {
        guard WCSession.isSupported() else {
            connectionStatus = "Watch Connectivity unavailable"
            return
        }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    private nonisolated static func receive(_ file: WCSessionFile) throws {
        let metadata = try transferMetadata(file.metadata)
        let root = try importsDirectory()
        let sessionFolder = root.appendingPathComponent(metadata.id.uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: sessionFolder, withIntermediateDirectories: true)
        let archiveURL = sessionFolder.appendingPathComponent("remus-watch-\(metadata.id.uuidString).zip")
        let metadataURL = sessionFolder.appendingPathComponent("transfer.json")

        if FileManager.default.fileExists(atPath: archiveURL.path) {
            try FileManager.default.removeItem(at: archiveURL)
        }
        try FileManager.default.moveItem(at: file.fileURL, to: archiveURL)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(metadata).write(to: metadataURL, options: .atomic)
        try attachImport(folder: sessionFolder, metadata: metadata)
    }

    private nonisolated static func attachPendingImports() throws {
        let root = try importsDirectory()
        let decoder = JSONDecoder.telemetryDecoder
        let folders = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])
        for folder in folders where (try? folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
            let metadataURL = folder.appendingPathComponent("transfer.json")
            guard let data = try? Data(contentsOf: metadataURL),
                  let metadata = try? decoder.decode(WatchTransferMetadata.self, from: data) else { continue }
            try attachImport(folder: folder, metadata: metadata)
        }
    }

    private nonisolated static func attachImport(folder: URL, metadata: WatchTransferMetadata) throws {
        guard let phoneSession = try bestPhoneSession(for: metadata) else { return }
        let watchFolder = phoneSession.appendingPathComponent("watch", isDirectory: true)
        try FileManager.default.createDirectory(at: watchFolder, withIntermediateDirectories: true)
        let sourceArchive = folder.appendingPathComponent("remus-watch-\(metadata.id.uuidString).zip")
        guard FileManager.default.fileExists(atPath: sourceArchive.path) else { return }
        let destinationArchive = watchFolder.appendingPathComponent(sourceArchive.lastPathComponent)
        if FileManager.default.fileExists(atPath: destinationArchive.path) {
            try FileManager.default.removeItem(at: destinationArchive)
        }
        try FileManager.default.moveItem(at: sourceArchive, to: destinationArchive)

        let receipt = WatchImportReceipt(
            watchSessionID: metadata.id,
            startedAt: metadata.startedAt,
            endedAt: metadata.endedAt,
            motionSampleCount: metadata.motionSampleCount,
            attachedAt: Date(),
            archiveFilename: destinationArchive.lastPathComponent
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(receipt).write(
            to: watchFolder.appendingPathComponent("watch-\(metadata.id.uuidString)-receipt.json"),
            options: .atomic
        )
        try? FileManager.default.removeItem(at: folder)
    }

    private nonisolated static func bestPhoneSession(for metadata: WatchTransferMetadata) throws -> URL? {
        let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let root = documents.appendingPathComponent("RemusSessions", isDirectory: true)
        guard FileManager.default.fileExists(atPath: root.path) else { return nil }
        let decoder = JSONDecoder.telemetryDecoder
        let folders = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])

        return folders.compactMap { folder -> (URL, TimeInterval)? in
            guard let data = try? Data(contentsOf: folder.appendingPathComponent("manifest.json")),
                  let manifest = try? decoder.decode(RecordingManifest.self, from: data),
                  let phoneEnd = manifest.endedAt else { return nil }
            let overlap = min(phoneEnd, metadata.endedAt).timeIntervalSince(max(manifest.startedAt, metadata.startedAt))
            let shorterDuration = min(phoneEnd.timeIntervalSince(manifest.startedAt), metadata.endedAt.timeIntervalSince(metadata.startedAt))
            guard overlap > 0, shorterDuration > 0, overlap / shorterDuration >= 0.5 else { return nil }
            return (folder, overlap)
        }.max { $0.1 < $1.1 }?.0
    }

    private nonisolated static func scanImports() throws -> [WatchImport] {
        let root = try importsDirectory()
        let decoder = JSONDecoder.telemetryDecoder
        let folders = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])
        return folders.compactMap { folder in
            guard let data = try? Data(contentsOf: folder.appendingPathComponent("transfer.json")),
                  let metadata = try? decoder.decode(WatchTransferMetadata.self, from: data) else { return nil }
            let archive = folder.appendingPathComponent("remus-watch-\(metadata.id.uuidString).zip")
            guard FileManager.default.fileExists(atPath: archive.path) else { return nil }
            return WatchImport(
                id: metadata.id,
                startedAt: metadata.startedAt,
                endedAt: metadata.endedAt,
                sampleCount: metadata.motionSampleCount,
                archiveURL: archive,
                attachedSessionName: nil
            )
        }
    }

    private nonisolated static func importsDirectory() throws -> URL {
        let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let root = documents.appendingPathComponent("RemusWatchImports", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private nonisolated static func transferMetadata(_ dictionary: [String: Any]?) throws -> WatchTransferMetadata {
        guard let dictionary,
              let idText = dictionary["sessionID"] as? String,
              let id = UUID(uuidString: idText),
              let started = dictionary["startedAt"] as? TimeInterval,
              let ended = dictionary["endedAt"] as? TimeInterval else {
            throw NSError(domain: "RemusWatchImport", code: 1, userInfo: [NSLocalizedDescriptionKey: "The Watch recording metadata is invalid."])
        }
        return WatchTransferMetadata(
            id: id,
            startedAt: Date(timeIntervalSince1970: started),
            endedAt: Date(timeIntervalSince1970: ended),
            motionSampleCount: dictionary["motionSampleCount"] as? Int ?? 0
        )
    }
}

extension WatchImportService: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in
            connectionStatus = error == nil ? "Ready to receive Watch recordings" : "Watch connection failed"
            lastError = error?.localizedDescription
        }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    nonisolated func session(_ session: WCSession, didReceive file: WCSessionFile) {
        do {
            try Self.receive(file)
            Task { @MainActor in
                connectionStatus = "Watch recording imported"
                recoveryStatus = "Apple Watch recording received"
                reload()
                let importedStatus = recoveryStatus
                Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    guard self?.recoveryStatus == importedStatus else { return }
                    self?.recoveryStatus = ""
                }
            }
        } catch {
            Task { @MainActor in lastError = error.localizedDescription }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        updateWorkoutStatus(from: applicationContext)
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        updateWorkoutStatus(from: message)
    }

    nonisolated private func updateWorkoutStatus(from payload: [String: Any]) {
        if let hr = payload["heartRate"] as? Double {
            Task { @MainActor in
                WatchImportService.shared.onHeartRateReceived?(hr)
                WatchImportService.shared.onWatchActiveChanged?(true)
            }
        }
        if let watchActive = payload["watchActive"] as? Bool {
            Task { @MainActor in WatchImportService.shared.onWatchActiveChanged?(watchActive) }
        }
        guard let recordingState = payload["recordingState"] as? String else { return }
        if recordingState == "recording" {
            Task { @MainActor in WatchImportService.shared.onWatchActiveChanged?(true) }
        } else if recordingState == "stopping" || recordingState == "saved" || recordingState == "failed" {
            Task { @MainActor in WatchImportService.shared.onWatchActiveChanged?(false) }
        }
        let message: String
        switch recordingState {
        case "recording": message = "Apple Watch confirmed recording"
        case "stopping": message = "Apple Watch is finishing the workout"
        case "saved": message = "Apple Watch recording saved"
        case "failed": message = "Apple Watch error: \(payload["error"] as? String ?? "unknown error")"
        case "recoveryQueued":
            let count = payload["archiveCount"] as? Int ?? 0
            message = count == 0 ? "No completed Watch recordings found" : "Apple Watch queued \(count) recording(s)"
            Task { @MainActor in recoveryStatus = message }
            return
        case "recoveryFailed":
            message = "Apple Watch recovery failed: \(payload["error"] as? String ?? "unknown error")"
            Task { @MainActor in recoveryStatus = message }
            return
        default: message = "Apple Watch: \(recordingState)"
        }
        Task { @MainActor in workoutStatus = message }
    }
}

private struct WatchTransferMetadata: Codable {
    let id: UUID
    let startedAt: Date
    let endedAt: Date
    let motionSampleCount: Int
}

private struct WatchImportReceipt: Codable {
    let watchSessionID: UUID
    let startedAt: Date
    let endedAt: Date
    let motionSampleCount: Int
    let attachedAt: Date
    let archiveFilename: String
}
