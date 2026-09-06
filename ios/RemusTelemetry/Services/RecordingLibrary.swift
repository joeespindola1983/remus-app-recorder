import Foundation

@MainActor
final class RecordingLibrary: ObservableObject {
    @Published private(set) var sessions: [RecordingSession] = []
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    func reload() {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        Task {
            do {
                let loaded = try await Task.detached(priority: .userInitiated) { try Self.scanSessions() }.value
                sessions = loaded.sorted { $0.manifest.startedAt > $1.manifest.startedAt }
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }

    func clearError() {
        errorMessage = nil
    }

    private nonisolated static func scanSessions() throws -> [RecordingSession] {
        let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let root = documents.appendingPathComponent("RemusSessions", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let folders = try FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )
        let decoder = JSONDecoder.telemetryDecoder

        return folders.compactMap { folder in
            guard (try? folder.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { return nil }
            let manifestURL = folder.appendingPathComponent("manifest.json")
            guard let data = try? Data(contentsOf: manifestURL),
                  let manifest = try? decoder.decode(RecordingManifest.self, from: data) else { return nil }
            return RecordingSession(manifest: manifest, folderURL: folder, sizeBytes: directorySize(folder))
        }
    }

    private nonisolated static func directorySize(_ folder: URL) -> Int64 {
        guard let enumerator = FileManager.default.enumerator(
            at: folder,
            includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else { return 0 }
        var total: Int64 = 0
        for case let url as URL in enumerator {
            if let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]), values.isRegularFile == true {
                total += Int64(values.fileSize ?? 0)
            }
        }
        return total
    }
}
