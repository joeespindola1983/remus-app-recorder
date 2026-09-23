import Foundation
import Compression

protocol TelemetryArchiveSession {
    var archiveID: UUID { get }
    var archiveStartedAt: Date { get }
    var archiveFolderURL: URL { get }
    var archiveFilenamePrefix: String { get }
    var requiredArchiveRelativePaths: [String] { get }
    func includesInArchive(relativePath: String) -> Bool
}

extension TelemetryArchiveSession {
    var requiredArchiveRelativePaths: [String] { [] }
}

#if os(iOS)
extension RecordingSession: TelemetryArchiveSession {
    var archiveID: UUID { manifest.id }
    var archiveStartedAt: Date { manifest.startedAt }
    var archiveFolderURL: URL { folderURL }
    var archiveFilenamePrefix: String { "remus" }
    var requiredArchiveRelativePaths: [String] { ["manifest.json", "telemetry.sqlite"] }

    func includesInArchive(relativePath: String) -> Bool {
        relativePath == "manifest.json" ||
        relativePath == "recording-context.json" ||
        relativePath == "telemetry.sqlite" ||
        relativePath == "remus_device.csv" ||
        relativePath == "watch.csv" ||
        relativePath.hasPrefix("watch/") ||
        relativePath.lowercased().contains("watch") ||
        relativePath.hasSuffix(".csv") ||
        relativePath.hasSuffix(".json") ||
        relativePath.hasSuffix(".sqlite")
    }
}
#endif

enum ZipArchiveService {
    enum ArchiveError: LocalizedError {
        case fileTooLarge(String)
        case archiveTooLarge
        case cannotCreate
        case noFiles
        case missingRequiredFile(String)
        case emptyRequiredFile(String)
        case compressionFailed(String)

        var errorDescription: String? {
            switch self {
            case let .fileTooLarge(name): return "\(name) is too large for this ZIP exporter."
            case .archiveTooLarge: return "The ZIP archive exceeds the 4 GB demo limit."
            case .cannotCreate: return "Could not create the ZIP archive."
            case .noFiles: return "No telemetry files were found for the ZIP archive."
            case let .missingRequiredFile(name): return "Required telemetry file is missing: \(name)."
            case let .emptyRequiredFile(name): return "Required telemetry file is empty: \(name)."
            case let .compressionFailed(name): return "Could not compress \(name)."
            }
        }
    }

    private struct Entry {
        let nameData: Data
        let crc32: UInt32
        let compressedSize: UInt32
        let uncompressedSize: UInt32
        let localOffset: UInt32
        let dosTime: UInt16
        let dosDate: UInt16
    }

    private struct CompressionResult {
        let crc32: UInt32
        let compressedSize: UInt32
        let uncompressedSize: UInt32
    }

    private static let utf8AndDataDescriptorFlags: UInt16 = 0x0808
    private static let deflateMethod: UInt16 = 8
    private static let chunkSize = 1_048_576

    private static let crcTable: [UInt32] = (0..<256).map { index in
        var value = UInt32(index)
        for _ in 0..<8 { value = (value & 1) == 1 ? (value >> 1) ^ 0xEDB8_8320 : value >> 1 }
        return value
    }

    static func createArchive<Session: TelemetryArchiveSession>(for session: Session, outputDirectory: URL? = nil) throws -> URL {
        let files = try regularFiles(in: session.archiveFolderURL, session: session)
        guard !files.isEmpty else { throw ArchiveError.noFiles }
        let exports: URL
        if let outputDirectory {
            exports = outputDirectory
        } else {
            let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            exports = documents.appendingPathComponent("RemusExports", isDirectory: true)
        }
        try FileManager.default.createDirectory(at: exports, withIntermediateDirectories: true)
        let archiveURL = exports.appendingPathComponent("\(session.archiveFilenamePrefix)-\(session.archiveID.uuidString).zip")
        if FileManager.default.fileExists(atPath: archiveURL.path) { try FileManager.default.removeItem(at: archiveURL) }
        guard FileManager.default.createFile(atPath: archiveURL.path, contents: nil) else { throw ArchiveError.cannotCreate }

        let output = try FileHandle(forWritingTo: archiveURL)
        defer { try? output.close() }
        var entries: [Entry] = []
        var offset: UInt64 = 0

        for file in files {
            let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
            let size64 = (attributes[.size] as? NSNumber)?.uint64Value ?? 0
            guard size64 <= UInt32.max else { throw ArchiveError.fileTooLarge(file.lastPathComponent) }
            guard offset <= UInt32.max else { throw ArchiveError.archiveTooLarge }
            let relative = relativePath(of: file, inside: session.archiveFolderURL)
            let storedName = session.archiveFolderURL.lastPathComponent + "/" + relative
            let nameData = Data(storedName.utf8)
            let (dosTime, dosDate) = dosTimestamp(attributes[.modificationDate] as? Date ?? session.archiveStartedAt)

            var header = Data()
            header.appendLE(UInt32(0x04034b50))
            header.appendLE(UInt16(20))
            header.appendLE(utf8AndDataDescriptorFlags)
            header.appendLE(deflateMethod)
            header.appendLE(dosTime)
            header.appendLE(dosDate)
            header.appendLE(UInt32(0))
            header.appendLE(UInt32(0))
            header.appendLE(UInt32(0))
            header.appendLE(UInt16(nameData.count))
            header.appendLE(UInt16(0))
            header.append(nameData)
            try output.write(contentsOf: header)

            let result = try compress(file, to: output)
            var descriptor = Data()
            descriptor.appendLE(UInt32(0x08074b50))
            descriptor.appendLE(result.crc32)
            descriptor.appendLE(result.compressedSize)
            descriptor.appendLE(result.uncompressedSize)
            try output.write(contentsOf: descriptor)

            entries.append(Entry(
                nameData: nameData,
                crc32: result.crc32,
                compressedSize: result.compressedSize,
                uncompressedSize: result.uncompressedSize,
                localOffset: UInt32(offset),
                dosTime: dosTime,
                dosDate: dosDate
            ))
            offset += UInt64(header.count) + UInt64(result.compressedSize) + UInt64(descriptor.count)
        }

        let centralStart = offset
        for entry in entries {
            var central = Data()
            central.appendLE(UInt32(0x02014b50))
            central.appendLE(UInt16(20))
            central.appendLE(UInt16(20))
            central.appendLE(utf8AndDataDescriptorFlags)
            central.appendLE(deflateMethod)
            central.appendLE(entry.dosTime)
            central.appendLE(entry.dosDate)
            central.appendLE(entry.crc32)
            central.appendLE(entry.compressedSize)
            central.appendLE(entry.uncompressedSize)
            central.appendLE(UInt16(entry.nameData.count))
            central.appendLE(UInt16(0))
            central.appendLE(UInt16(0))
            central.appendLE(UInt16(0))
            central.appendLE(UInt16(0))
            central.appendLE(UInt32(0))
            central.appendLE(entry.localOffset)
            central.append(entry.nameData)
            try output.write(contentsOf: central)
            offset += UInt64(central.count)
        }

        guard entries.count <= Int(UInt16.max), centralStart <= UInt32.max, offset <= UInt32.max else { throw ArchiveError.archiveTooLarge }
        var end = Data()
        end.appendLE(UInt32(0x06054b50))
        end.appendLE(UInt16(0))
        end.appendLE(UInt16(0))
        end.appendLE(UInt16(entries.count))
        end.appendLE(UInt16(entries.count))
        end.appendLE(UInt32(offset - centralStart))
        end.appendLE(UInt32(centralStart))
        end.appendLE(UInt16(0))
        try output.write(contentsOf: end)
        try output.synchronize()
        return archiveURL
    }

    private static func regularFiles<Session: TelemetryArchiveSession>(in folder: URL, session: Session) throws -> [URL] {
        let fileManager = FileManager.default
        var filesByRelativePath: [String: URL] = [:]

        for relativePath in session.requiredArchiveRelativePaths {
            let file = folder.appendingPathComponent(relativePath)
            var isDirectory: ObjCBool = false
            guard fileManager.fileExists(atPath: file.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
                throw ArchiveError.missingRequiredFile(relativePath)
            }
            let attributes = try fileManager.attributesOfItem(atPath: file.path)
            let size = (attributes[.size] as? NSNumber)?.uint64Value ?? 0
            guard size > 0 else { throw ArchiveError.emptyRequiredFile(relativePath) }
            filesByRelativePath[relativePath] = file
        }

        guard let enumerator = fileManager.enumerator(
            at: folder,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            return filesByRelativePath.sorted { $0.key < $1.key }.map { $0.value }
        }
        for case let url as URL in enumerator {
            var isDirectory: ObjCBool = false
            guard fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory), !isDirectory.boolValue else { continue }
            let relative = relativePath(of: url, inside: folder)
            guard session.includesInArchive(relativePath: relative) else { continue }
            filesByRelativePath[relative] = url
        }
        return filesByRelativePath.sorted { $0.key < $1.key }.map { $0.value }
    }

    private static func relativePath(of file: URL, inside folder: URL) -> String {
        let filePath = file.resolvingSymlinksInPath().path
        let folderPath = folder.resolvingSymlinksInPath().path
        if filePath.hasPrefix(folderPath) {
            let dropped = filePath.dropFirst(folderPath.count)
            return String(dropped.drop(while: { $0 == "/" }))
        }
        if file.path.hasPrefix(folder.path) {
            let dropped = file.path.dropFirst(folder.path.count)
            return String(dropped.drop(while: { $0 == "/" }))
        }
        return file.lastPathComponent
    }

    private static func compress(_ url: URL, to output: FileHandle) throws -> CompressionResult {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }

        let destination = UnsafeMutablePointer<UInt8>.allocate(capacity: chunkSize)
        defer { destination.deallocate() }

        var stream = compression_stream(
            dst_ptr: destination,
            dst_size: 0,
            src_ptr: UnsafePointer(destination),
            src_size: 0,
            state: nil
        )
        guard compression_stream_init(&stream, COMPRESSION_STREAM_ENCODE, COMPRESSION_ZLIB) != COMPRESSION_STATUS_ERROR else {
            throw ArchiveError.compressionFailed(url.lastPathComponent)
        }
        defer { compression_stream_destroy(&stream) }

        var crc: UInt32 = 0xFFFF_FFFF
        var inputSize: UInt64 = 0
        var outputSize: UInt64 = 0

        while let data = try handle.read(upToCount: chunkSize), !data.isEmpty {
            inputSize += UInt64(data.count)
            guard inputSize <= UInt32.max else { throw ArchiveError.fileTooLarge(url.lastPathComponent) }
            for byte in data {
                let tableIndex = Int((crc ^ UInt32(byte)) & 0xFF)
                crc = (crc >> 8) ^ crcTable[tableIndex]
            }

            try data.withUnsafeBytes { source in
                guard let sourceAddress = source.bindMemory(to: UInt8.self).baseAddress else {
                    throw ArchiveError.compressionFailed(url.lastPathComponent)
                }
                stream.src_ptr = sourceAddress
                stream.src_size = data.count
                while stream.src_size > 0 {
                    try process(&stream, flags: 0, destination: destination, output: output, outputSize: &outputSize, filename: url.lastPathComponent)
                }
            }
        }

        var status = COMPRESSION_STATUS_OK
        repeat {
            status = try process(
                &stream,
                flags: Int32(COMPRESSION_STREAM_FINALIZE.rawValue),
                destination: destination,
                output: output,
                outputSize: &outputSize,
                filename: url.lastPathComponent
            )
        } while status == COMPRESSION_STATUS_OK

        guard status == COMPRESSION_STATUS_END, outputSize <= UInt32.max else {
            throw ArchiveError.compressionFailed(url.lastPathComponent)
        }
        return CompressionResult(
            crc32: crc ^ 0xFFFF_FFFF,
            compressedSize: UInt32(outputSize),
            uncompressedSize: UInt32(inputSize)
        )
    }

    @discardableResult
    private static func process(
        _ stream: inout compression_stream,
        flags: Int32,
        destination: UnsafeMutablePointer<UInt8>,
        output: FileHandle,
        outputSize: inout UInt64,
        filename: String
    ) throws -> compression_status {
        stream.dst_ptr = destination
        stream.dst_size = chunkSize
        let status = compression_stream_process(&stream, flags)
        guard status != COMPRESSION_STATUS_ERROR else { throw ArchiveError.compressionFailed(filename) }
        let produced = chunkSize - stream.dst_size
        if produced > 0 {
            try output.write(contentsOf: Data(bytes: destination, count: produced))
            outputSize += UInt64(produced)
            guard outputSize <= UInt32.max else { throw ArchiveError.archiveTooLarge }
        }
        return status
    }

    private static func dosTimestamp(_ date: Date) -> (UInt16, UInt16) {
        let calendar = Calendar(identifier: .gregorian)
        let parts = calendar.dateComponents(in: .current, from: date)
        let year = max(1980, min(2107, parts.year ?? 1980))
        let hours = UInt16(parts.hour ?? 0)
        let minutes = UInt16(parts.minute ?? 0)
        let seconds = UInt16((parts.second ?? 0) / 2)
        let month = UInt16(parts.month ?? 1)
        let monthDay = UInt16(parts.day ?? 1)
        let dosYear = UInt16(year - 1980)
        let time = (hours << 11) | (minutes << 5) | seconds
        let day = (dosYear << 9) | (month << 5) | monthDay
        return (time, day)
    }
}

private extension Data {
    mutating func appendLE<T: FixedWidthInteger>(_ value: T) {
        var littleEndian = value.littleEndian
        Swift.withUnsafeBytes(of: &littleEndian) { append(contentsOf: $0) }
    }
}
