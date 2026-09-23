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
    var onWatchTransferProgress: ((Int, Double, String, String?, String?) -> Void)?
    var onTransferCompleted: ((Bool) -> Void)?
    var onWatchTelemetryReceived: (([String: Any]) -> Void)?
    var onRecordingStateReceived: (([String: Any]) -> Void)?

    @Published private(set) var imports: [WatchImport] = []
    @Published private(set) var connectionStatus = "Activating Apple Watch connection"
    @Published private(set) var workoutStatus = "Waiting for Watch workout"
    @Published private(set) var recoveryStatus = ""
    @Published private(set) var lastError: String?

    private nonisolated(unsafe) static var explicitTargetFolder: URL?
    private static let targetLock = NSLock()
    private var receivedMessageIDs = Set<String>()
    private var receivedMessageOrder: [String] = []

    public nonisolated static func setExplicitTargetFolder(_ folder: URL?) {
        targetLock.lock()
        explicitTargetFolder = folder
        targetLock.unlock()
    }

    public nonisolated static func getExplicitTargetFolder() -> URL? {
        targetLock.lock()
        defer { targetLock.unlock() }
        return explicitTargetFolder
    }

    public nonisolated static func attachPendingImports(targetFolder: URL? = nil) {
        if let targetFolder { setExplicitTargetFolder(targetFolder) }
        do {
            try attachPendingImportsThrowing(targetFolder: targetFolder ?? getExplicitTargetFolder())
        } catch {
            NSLog("[WatchImportService] Could not attach pending imports: %@", error.localizedDescription)
        }
    }

    override init() {
        super.init()
        activate()
        reload()
    }

    func requestWatchStopAndTransfer(completion: @escaping (Bool, Error?) -> Void) {
        guard WCSession.isSupported() else {
            completion(false, NSError(domain: "RemusWatchImport", code: 4, userInfo: [NSLocalizedDescriptionKey: "Watch Connectivity is unavailable."]))
            return
        }
        let session = WCSession.default
        var payload: [String: Any] = [
            "protocolVersion": "1.0.0",
            "command": "stopAndSendRecording",
            "requestedAt": Date().timeIntervalSince1970
        ]
        if let target = Self.getExplicitTargetFolder(),
           let id = Self.phoneSessionID(from: target) {
            payload["phoneSessionID"] = id.uuidString
        }
        session.transferUserInfo(payload)
        if session.activationState == .activated, session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { error in
                NSLog("[WatchImportService] Interactive stop failed; queued transfer remains: %@", error.localizedDescription)
            }
        }
        workoutStatus = "Apple Watch stop queued"
        completion(true, nil)
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
            try Self.attachPendingImportsThrowing(targetFolder: Self.getExplicitTargetFolder())
            reload()
        } catch {
            lastError = error.localizedDescription
        }
    }

    func clearError() { lastError = nil }

    func requestWatchRecovery() {
        guard WCSession.isSupported() else {
            recoveryStatus = "Apple Watch connectivity is unavailable"
            return
        }
        let session = WCSession.default
        let payload: [String: Any] = [
            "protocolVersion": "1.0.0",
            "command": "recoverWatchArchives",
            "requestID": UUID().uuidString,
            "requestedAt": Date().timeIntervalSince1970
        ]
        session.transferUserInfo(payload)
        recoveryStatus = session.isReachable
            ? "Asking Apple Watch to resend local recordings…"
            : "Recovery queued · waiting for Apple Watch"
        guard session.activationState == .activated, session.isReachable else { return }
        session.sendMessage(payload, replyHandler: nil) { [weak self] error in
            Task { @MainActor in self?.recoveryStatus = "Recovery queued · \(error.localizedDescription)" }
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

    private nonisolated static func receive(_ file: WCSessionFile) throws -> WatchTransferMetadata {
        let metadata = try transferMetadata(file.metadata)
        let root = try importsDirectory()
        let sessionFolder = root.appendingPathComponent(metadata.id.uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: sessionFolder, withIntermediateDirectories: true)
        let archiveURL = sessionFolder.appendingPathComponent("remus-watch-\(metadata.id.uuidString).zip")
        let metadataURL = sessionFolder.appendingPathComponent("transfer.json")
        if FileManager.default.fileExists(atPath: archiveURL.path) { try FileManager.default.removeItem(at: archiveURL) }
        try FileManager.default.moveItem(at: file.fileURL, to: archiveURL)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(metadata).write(to: metadataURL, options: .atomic)
        try attachImport(folder: sessionFolder, metadata: metadata, targetFolder: getExplicitTargetFolder())
        return metadata
    }

    private nonisolated static func attachPendingImportsThrowing(targetFolder: URL?) throws {
        let root = try importsDirectory()
        let decoder = JSONDecoder.telemetryDecoder
        let folders = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey])
        for folder in folders where (try? folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
            let metadataURL = folder.appendingPathComponent("transfer.json")
            guard let data = try? Data(contentsOf: metadataURL),
                  let metadata = try? decoder.decode(WatchTransferMetadata.self, from: data) else { continue }
            try attachImport(folder: folder, metadata: metadata, targetFolder: targetFolder)
        }
    }

    private nonisolated static func attachImport(folder: URL, metadata: WatchTransferMetadata, targetFolder: URL?) throws {
        let phoneSession: URL?
        if let phoneSessionID = metadata.phoneSessionID {
            phoneSession = try phoneSessionFolder(id: phoneSessionID)
        } else if let targetFolder {
            phoneSession = targetFolder
        } else {
            phoneSession = try bestPhoneSession(for: metadata)
        }
        guard let phoneSession else { return }

        if let expected = metadata.phoneSessionID,
           phoneSessionID(from: phoneSession) != expected {
            return
        }

        let watchFolder = phoneSession.appendingPathComponent("watch", isDirectory: true)
        try FileManager.default.createDirectory(at: watchFolder, withIntermediateDirectories: true)
        let sourceArchive = folder.appendingPathComponent("remus-watch-\(metadata.id.uuidString).zip")
        guard FileManager.default.fileExists(atPath: sourceArchive.path) else { return }
        let destinationArchive = watchFolder.appendingPathComponent(sourceArchive.lastPathComponent)
        if FileManager.default.fileExists(atPath: destinationArchive.path) { try FileManager.default.removeItem(at: destinationArchive) }
        try FileManager.default.moveItem(at: sourceArchive, to: destinationArchive)

        let receipt = WatchImportReceipt(
            watchSessionID: metadata.id,
            phoneSessionID: metadata.phoneSessionID,
            startRequestID: metadata.startRequestID,
            startedAt: metadata.startedAt,
            endedAt: metadata.endedAt,
            motionSampleCount: metadata.motionSampleCount,
            attachedAt: Date(),
            archiveFilename: destinationArchive.lastPathComponent
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(receipt).write(to: watchFolder.appendingPathComponent("watch-\(metadata.id.uuidString)-receipt.json"), options: .atomic)
        try? FileManager.default.removeItem(at: folder)
    }

    private nonisolated static func phoneSessionID(from folder: URL) -> UUID? {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent("manifest.json")),
              let manifest = try? JSONDecoder.telemetryDecoder.decode(RecordingManifest.self, from: data) else { return nil }
        return manifest.id
    }

    private nonisolated static func phoneSessionFolder(id: UUID) throws -> URL? {
        let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let root = documents.appendingPathComponent("RemusSessions", isDirectory: true)
        guard FileManager.default.fileExists(atPath: root.path) else { return nil }
        return try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isDirectoryKey]).first {
            phoneSessionID(from: $0) == id
        }
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
            let shorter = min(phoneEnd.timeIntervalSince(manifest.startedAt), metadata.endedAt.timeIntervalSince(metadata.startedAt))
            guard overlap > 0, shorter > 0, overlap / shorter >= 0.5 else { return nil }
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
            return WatchImport(id: metadata.id, startedAt: metadata.startedAt, endedAt: metadata.endedAt, sampleCount: metadata.motionSampleCount, archiveURL: archive, attachedSessionName: metadata.phoneSessionID?.uuidString)
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
              let started = (dictionary["startedAt"] as? NSNumber)?.doubleValue,
              let ended = (dictionary["endedAt"] as? NSNumber)?.doubleValue else {
            throw NSError(domain: "RemusWatchImport", code: 1, userInfo: [NSLocalizedDescriptionKey: "The Watch recording metadata is invalid."])
        }
        return WatchTransferMetadata(
            id: id,
            phoneSessionID: (dictionary["phoneSessionID"] as? String).flatMap { UUID(uuidString: $0) },
            startRequestID: dictionary["startRequestID"] as? String,
            startedAt: Date(timeIntervalSince1970: started),
            endedAt: Date(timeIntervalSince1970: ended),
            motionSampleCount: (dictionary["motionSampleCount"] as? NSNumber)?.intValue ?? 0
        )
    }

    private func acceptMessageID(_ payload: [String: Any]) -> Bool {
        guard let id = payload["messageId"] as? String else { return true }
        guard !receivedMessageIDs.contains(id) else { return false }
        receivedMessageIDs.insert(id)
        receivedMessageOrder.append(id)
        if receivedMessageOrder.count > 1_000 {
            receivedMessageIDs.remove(receivedMessageOrder.removeFirst())
        }
        return true
    }

    private func processIncomingPayload(_ payload: [String: Any]) {
        guard acceptMessageID(payload) else { return }
        let hr = Self.parseDouble(payload["heartRate"]) ?? Self.parseDouble(payload["heartRateBpm"])
        if let hr, hr > 0 { onHeartRateReceived?(hr) }

        if let recordingState = payload["recordingState"] as? String {
            onRecordingStateReceived?(payload)
            let active = recordingState == "recording"
            onWatchActiveChanged?(active)
            switch recordingState {
            case "recording": workoutStatus = "Apple Watch confirmed recording"
            case "starting": workoutStatus = "Apple Watch is starting"
            case "stopping": workoutStatus = "Apple Watch is finishing the workout"
            case "saved": workoutStatus = "Apple Watch recording saved"
            case "failed": workoutStatus = "Apple Watch error: \(payload["error"] as? String ?? "unknown error")"
            case "recoveryQueued":
                let count = (payload["archiveCount"] as? NSNumber)?.intValue ?? 0
                recoveryStatus = count == 0 ? "No completed Watch recordings found" : "Apple Watch queued \(count) recording(s)"
            case "recoveryFailed": recoveryStatus = "Apple Watch recovery failed: \(payload["error"] as? String ?? "unknown error")"
            default: workoutStatus = "Apple Watch: \(recordingState)"
            }
        }

        let isTelemetry = (payload["command"] as? String) == "watchTelemetry" || payload["heartRate"] != nil || payload["userAx"] != nil
        if isTelemetry { onWatchTelemetryReceived?(payload) }
    }

    private nonisolated static func parseDouble(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let text = value as? String { return Double(text) }
        return nil
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
            let metadata = try Self.receive(file)
            Task { @MainActor in
                connectionStatus = "Watch recording imported"
                recoveryStatus = "Apple Watch recording received"
                onWatchTransferProgress?(100, 1, "completed", metadata.id.uuidString, nil)
                onTransferCompleted?(true)
                reload()
            }
        } catch {
            Task { @MainActor in
                lastError = error.localizedDescription
                onWatchTransferProgress?(0, 0, "failed", nil, error.localizedDescription)
                onTransferCompleted?(false)
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.processIncomingPayload(applicationContext) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in self.processIncomingPayload(message) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        Task { @MainActor in
            self.processIncomingPayload(message)
            replyHandler(["accepted": true])
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        Task { @MainActor in self.processIncomingPayload(userInfo) }
    }
}

private struct WatchTransferMetadata: Codable {
    let id: UUID
    let phoneSessionID: UUID?
    let startRequestID: String?
    let startedAt: Date
    let endedAt: Date
    let motionSampleCount: Int
}

private struct WatchImportReceipt: Codable {
    let watchSessionID: UUID
    let phoneSessionID: UUID?
    let startRequestID: String?
    let startedAt: Date
    let endedAt: Date
    let motionSampleCount: Int
    let attachedAt: Date
    let archiveFilename: String
}
