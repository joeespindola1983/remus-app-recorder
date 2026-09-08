import CoreLocation
import Foundation

public struct LocationQualityPolicy: Equatable {
    public var maxHorizontalAccuracyMeters: Double
    public var maxReportedSpeedAccuracyMetersPerSecond: Double
    public var maxReportedCourseAccuracyDegrees: Double
    public var minSamplingIntervalSeconds: Double
    public var maxSamplingIntervalSeconds: Double
    public var maxPlausibleSpeedMetersPerSecond: Double
    public var minDisplacementForBearingMeters: Double
    public var smoothingWindowSeconds: Double

    public static let `default` = LocationQualityPolicy(
        maxHorizontalAccuracyMeters: 20.0,
        maxReportedSpeedAccuracyMetersPerSecond: 3.0,
        maxReportedCourseAccuracyDegrees: 90.0,
        minSamplingIntervalSeconds: 0.5,
        maxSamplingIntervalSeconds: 5.0,
        maxPlausibleSpeedMetersPerSecond: 15.0,
        minDisplacementForBearingMeters: 3.0,
        smoothingWindowSeconds: 3.0
    )

    public init(
        maxHorizontalAccuracyMeters: Double = 20.0,
        maxReportedSpeedAccuracyMetersPerSecond: Double = 3.0,
        maxReportedCourseAccuracyDegrees: Double = 90.0,
        minSamplingIntervalSeconds: Double = 0.5,
        maxSamplingIntervalSeconds: Double = 5.0,
        maxPlausibleSpeedMetersPerSecond: Double = 15.0,
        minDisplacementForBearingMeters: Double = 3.0,
        smoothingWindowSeconds: Double = 3.0
    ) {
        self.maxHorizontalAccuracyMeters = maxHorizontalAccuracyMeters
        self.maxReportedSpeedAccuracyMetersPerSecond = maxReportedSpeedAccuracyMetersPerSecond
        self.maxReportedCourseAccuracyDegrees = maxReportedCourseAccuracyDegrees
        self.minSamplingIntervalSeconds = minSamplingIntervalSeconds
        self.maxSamplingIntervalSeconds = maxSamplingIntervalSeconds
        self.maxPlausibleSpeedMetersPerSecond = maxPlausibleSpeedMetersPerSecond
        self.minDisplacementForBearingMeters = minDisplacementForBearingMeters
        self.smoothingWindowSeconds = smoothingWindowSeconds
    }
}

public enum QualityOrigin: String, Codable, Equatable {
    case reported = "reported"
    case coordinateDerived = "coordinate_derived"
    case unavailable = "unavailable"
}

public struct EvaluatedMotion: Equatable {
    public let speedKilometersPerHour: Double?
    public let speedMetersPerSecond: Double?
    public let speedOrigin: QualityOrigin
    public let courseDegrees: Double?
    public let courseOrigin: QualityOrigin

    public init(
        speedKilometersPerHour: Double?,
        speedMetersPerSecond: Double?,
        speedOrigin: QualityOrigin,
        courseDegrees: Double?,
        courseOrigin: QualityOrigin
    ) {
        self.speedKilometersPerHour = speedKilometersPerHour
        self.speedMetersPerSecond = speedMetersPerSecond
        self.speedOrigin = speedOrigin
        self.courseDegrees = courseDegrees
        self.courseOrigin = courseOrigin
    }
}

public class LocationQualityEvaluator {
    public var policy: LocationQualityPolicy

    private struct QualifiedFix {
        let location: CLLocation
        let timestamp: Date
    }

    private var fixHistory: [QualifiedFix] = []

    public init(policy: LocationQualityPolicy = .default) {
        self.policy = policy
    }

    public func reset() {
        fixHistory.removeAll()
    }

    public func isPositionQualified(_ location: CLLocation) -> Bool {
        return location.horizontalAccuracy >= 0 && location.horizontalAccuracy <= policy.maxHorizontalAccuracyMeters
    }

    public func isReportedSpeedQualified(_ location: CLLocation) -> Bool {
        guard location.speed >= 0,
              location.speedAccuracy >= 0,
              location.speedAccuracy <= policy.maxReportedSpeedAccuracyMetersPerSecond,
              location.speed <= policy.maxPlausibleSpeedMetersPerSecond else {
            return false
        }
        return true
    }

    public func isReportedCourseQualified(_ location: CLLocation) -> Bool {
        guard location.course >= 0,
              location.courseAccuracy >= 0,
              location.courseAccuracy <= policy.maxReportedCourseAccuracyDegrees else {
            return false
        }
        return true
    }

    public func update(location: CLLocation) -> EvaluatedMotion {
        let positionOk = isPositionQualified(location)
        let reportedSpeedOk = isReportedSpeedQualified(location)
        let reportedCourseOk = isReportedCourseQualified(location)

        var derivedSpeedMps: Double? = nil
        var derivedCourseDeg: Double? = nil

        if positionOk {
            if let lastFix = fixHistory.last {
                let dt = location.timestamp.timeIntervalSince(lastFix.timestamp)
                if dt <= 0 {
                    // Out of order or identical timestamp; do not update history
                } else if dt > policy.maxSamplingIntervalSeconds {
                    // Stale gap: reset history to start fresh from current fix
                    fixHistory = [QualifiedFix(location: location, timestamp: location.timestamp)]
                } else {
                    let segmentDist = location.distance(from: lastFix.location)
                    let segmentSpeed = segmentDist / dt
                    if segmentSpeed <= policy.maxPlausibleSpeedMetersPerSecond {
                        fixHistory.append(QualifiedFix(location: location, timestamp: location.timestamp))
                    } else {
                        // Physically implausible jump: discard this fix from history to avoid corrupting derived speed
                    }
                }
            } else {
                fixHistory.append(QualifiedFix(location: location, timestamp: location.timestamp))
            }

            // Prune fixes older than smoothing window
            let cutoff = location.timestamp.addingTimeInterval(-policy.smoothingWindowSeconds)
            fixHistory.removeAll { $0.timestamp < cutoff }

            // Compute sliding-window coordinate-derived speed
            if fixHistory.count >= 2,
               let first = fixHistory.first,
               let last = fixHistory.last {
                let totalDt = last.timestamp.timeIntervalSince(first.timestamp)
                if totalDt >= policy.minSamplingIntervalSeconds {
                    var totalDist = 0.0
                    for i in 1..<fixHistory.count {
                        totalDist += fixHistory[i].location.distance(from: fixHistory[i - 1].location)
                    }
                    let avgSpeed = totalDist / totalDt
                    if avgSpeed <= policy.maxPlausibleSpeedMetersPerSecond {
                        derivedSpeedMps = avgSpeed
                    }
                }
            }

            // Compute coordinate-derived bearing from window span
            if fixHistory.count >= 2,
               let first = fixHistory.first,
               let last = fixHistory.last {
                let displacement = last.location.distance(from: first.location)
                if displacement >= policy.minDisplacementForBearingMeters {
                    derivedCourseDeg = Self.bearingBetween(
                        from: first.location.coordinate,
                        to: last.location.coordinate
                    )
                }
            }
        }

        // Speed resolution
        let finalSpeedKmh: Double?
        let finalSpeedMps: Double?
        let speedOrigin: QualityOrigin

        if reportedSpeedOk {
            finalSpeedMps = location.speed
            finalSpeedKmh = location.speed * 3.6
            speedOrigin = .reported
        } else if let derived = derivedSpeedMps {
            finalSpeedMps = derived
            finalSpeedKmh = derived * 3.6
            speedOrigin = .coordinateDerived
        } else {
            finalSpeedMps = nil
            finalSpeedKmh = nil
            speedOrigin = .unavailable
        }

        // Course resolution
        let finalCourse: Double?
        let courseOrigin: QualityOrigin

        if reportedCourseOk {
            finalCourse = location.course
            courseOrigin = .reported
        } else if let derivedCourse = derivedCourseDeg {
            finalCourse = derivedCourse
            courseOrigin = .coordinateDerived
        } else {
            finalCourse = nil
            courseOrigin = .unavailable
        }

        return EvaluatedMotion(
            speedKilometersPerHour: finalSpeedKmh,
            speedMetersPerSecond: finalSpeedMps,
            speedOrigin: speedOrigin,
            courseDegrees: finalCourse,
            courseOrigin: courseOrigin
        )
    }

    public static func bearingBetween(
        from: CLLocationCoordinate2D,
        to: CLLocationCoordinate2D
    ) -> Double {
        let lat1 = from.latitude * .pi / 180.0
        let lon1 = from.longitude * .pi / 180.0
        let lat2 = to.latitude * .pi / 180.0
        let lon2 = to.longitude * .pi / 180.0

        let dLon = lon2 - lon1
        let y = sin(dLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        let rad = atan2(y, x)
        var deg = rad * 180.0 / .pi
        if deg < 0 {
            deg += 360.0
        }
        return deg.truncatingRemainder(dividingBy: 360.0)
    }
}
