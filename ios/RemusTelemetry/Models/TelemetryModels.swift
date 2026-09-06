import Foundation

struct Vector3: Codable, Equatable {
    let x: Double
    let y: Double
    let z: Double

    var magnitude: Double { SensorMath.magnitude(x: x, y: y, z: z) }
}

struct AttitudeSample: Codable, Equatable {
    let rollRadians: Double
    let pitchRadians: Double
    let yawRadians: Double
    let quaternionX: Double
    let quaternionY: Double
    let quaternionZ: Double
    let quaternionW: Double
}

struct LocationSample: Codable, Equatable {
    let latitude: Double
    let longitude: Double
    let altitudeMeters: Double?
    let ellipsoidalAltitudeMeters: Double?
    let horizontalAccuracyMeters: Double
    let verticalAccuracyMeters: Double?
    let speedMetersPerSecond: Double?
    let speedAccuracyMetersPerSecond: Double?
    let courseDegrees: Double?
    let courseAccuracyDegrees: Double?
    let isSimulatedBySoftware: Bool?
    let isProducedByAccessory: Bool?
    let sourceTimestamp: Date
}

struct HeadingSample: Codable, Equatable {
    let trueDegrees: Double?
    let magneticDegrees: Double
    let accuracyDegrees: Double
    let magneticFieldMicrotesla: Vector3
}

struct MotionSample: Codable, Equatable {
    let sensorTimestampSeconds: Double
    let rawAccelerationG: Vector3?
    let rawRotationRateRadiansPerSecond: Vector3?
    let rawMagneticFieldMicrotesla: Vector3?
    let userAccelerationG: Vector3
    let gravityG: Vector3
    let rotationRateRadiansPerSecond: Vector3
    let calibratedMagneticFieldMicrotesla: Vector3
    let magneticFieldCalibrationAccuracy: Int
    let attitude: AttitudeSample
}

struct AltimeterSample: Codable, Equatable {
    let relativeAltitudeMeters: Double
    let pressureKilopascals: Double
}

struct DeviceSample: Codable, Equatable {
    let batteryLevel: Double?
    let batteryState: String
}

struct TelemetrySample: Codable, Equatable {
    let recordedAt: Date
    let elapsedSeconds: Double
    let location: LocationSample?
    let heading: HeadingSample?
    let motion: MotionSample?
    let altimeter: AltimeterSample?
    let device: DeviceSample
}

struct WeatherSnapshot: Codable, Equatable {
    let recordedAt: Date
    let latitude: Double
    let longitude: Double
    let sourceTime: String
    let temperatureCelsius: Double?
    let apparentTemperatureCelsius: Double?
    let relativeHumidityPercent: Double?
    let precipitationMillimeters: Double?
    let surfacePressureHectopascals: Double?
    let windSpeedKilometersPerHour: Double?
    let windDirectionDegrees: Double?
    let windGustKilometersPerHour: Double?
    let weatherCode: Int?
    let provider: String
}

struct SessionMetadata: Codable, Equatable {
    let sessionID: UUID
    let startedAt: Date
    let appVersion: String
    let deviceModel: String
    let systemVersion: String
    let motionFrequencyHertz: Double
    let notes: String
}

struct RecordingManifest: Codable, Equatable, Identifiable {
    enum Status: String, Codable {
        case recording
        case completed
        case failed
    }

    let id: UUID
    let startedAt: Date
    var endedAt: Date?
    let appVersion: String
    let deviceModel: String
    let systemVersion: String
    let notes: String
    let motionFrequencyHertz: Double
    var motionSampleCount: Int
    var locationSampleCount: Int
    var headingSampleCount: Int
    var altimeterSampleCount: Int
    var weatherSampleCount: Int
    var status: Status
    var failureMessage: String?
    let databaseFilename: String
}

struct RecordingSession: Identifiable, Equatable {
    let manifest: RecordingManifest
    let folderURL: URL
    let sizeBytes: Int64

    var id: UUID { manifest.id }
    var duration: TimeInterval {
        (manifest.endedAt ?? Date()).timeIntervalSince(manifest.startedAt)
    }

    var hasWatchRecording: Bool {
        let folder = folderURL.appendingPathComponent("watch", isDirectory: true)
        return ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [])
            .contains { $0.pathExtension.lowercased() == "zip" }
    }
}

extension JSONDecoder {
    static var telemetryDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            if let dateStr = try? container.decode(String.self) {
                let isoFormatter = ISO8601DateFormatter()
                if let date = isoFormatter.date(from: dateStr) {
                    return date
                }
                isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let date = isoFormatter.date(from: dateStr) {
                    return date
                }
                if let seconds = Double(dateStr) {
                    return Date(timeIntervalSince1970: seconds)
                }
            } else if let seconds = try? container.decode(Double.self) {
                if seconds > 100_000_000_000 {
                    return Date(timeIntervalSince1970: seconds / 1000.0)
                } else if seconds > 900_000_000 {
                    return Date(timeIntervalSince1970: seconds)
                } else {
                    return Date(timeIntervalSinceReferenceDate: seconds)
                }
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode date format"
            )
        }
        return decoder
    }
}

