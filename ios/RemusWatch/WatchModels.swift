import Foundation

struct WatchMotionSample {
    let sensorUptime: TimeInterval
    let rawAcceleration: SIMD3<Double>?
    let rawRotation: SIMD3<Double>?
    let rawMagneticField: SIMD3<Double>?
    let userAcceleration: SIMD3<Double>
    let gravity: SIMD3<Double>
    let rotationRate: SIMD3<Double>
    let calibratedMagneticField: SIMD3<Double>
    let magneticAccuracy: Int
    let roll: Double
    let pitch: Double
    let yaw: Double
    let quaternion: SIMD4<Double>
}

struct WatchLocationSample {
    let sourceTime: Date
    let latitude: Double
    let longitude: Double
    let altitude: Double?
    let horizontalAccuracy: Double
    let verticalAccuracy: Double?
    let speed: Double?
    let speedAccuracy: Double?
    let course: Double?
    let courseAccuracy: Double?
}

struct WatchManifest: Codable {
    enum Status: String, Codable { case recording, completed, failed }

    let id: UUID
    let startedAt: Date
    var endedAt: Date?
    var status: Status
    var failureMessage: String?
    let appVersion: String
    let watchModel: String
    let systemVersion: String
    let wristLocation: String
    let crownOrientation: String
    let motionFrequencyHertz: Double
    var motionReferenceFrame: String
    var motionSampleCount: Int
    var locationSampleCount: Int
    var altimeterSampleCount: Int
    var healthSampleCount: Int
    var deviceSampleCount: Int
    let databaseFilename: String
    /// Correlates this Watch archive with the phone recording that requested it.
    /// Optional so archives created by older builds remain decodable.
    var phoneSessionID: UUID? = nil
    var startRequestID: String? = nil
}

struct WatchRecordingSession: TelemetryArchiveSession {
    let manifest: WatchManifest
    let folderURL: URL

    var archiveID: UUID { manifest.id }
    var archiveStartedAt: Date { manifest.startedAt }
    var archiveFolderURL: URL { folderURL }
    var archiveFilenamePrefix: String { "remus-watch" }
    var requiredArchiveRelativePaths: [String] { ["watch-manifest.json", "watch-telemetry.sqlite"] }

    func includesInArchive(relativePath: String) -> Bool {
        relativePath == "watch-manifest.json" || relativePath == "watch-telemetry.sqlite"
    }
}
