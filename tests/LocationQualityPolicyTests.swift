import CoreLocation
import Foundation

@main
struct LocationQualityPolicyTests {
    static func main() throws {
        print("Running LocationQualityPolicyTests...")

        testExactAnomalyReproduction()
        testHealthyGPS()
        testDegradedGPSUnavailable()
        testImplausibleJumpRejection()
        testStaleGapReset()

        print("All LocationQualityPolicyTests passed successfully!")
    }

    /// Reproduces the exact 835-sample anomaly from the athlete's capture:
    /// - Continuous coordinates with horizontalAccuracy ~2m
    /// - False reported speed ~0.71 m/s with speedAccuracy ~3.75 m/s
    /// - Frozen course 262° with courseAccuracy = 180°
    /// - Actual coordinate-derived speed ~2.4 m/s heading north (~0°)
    static func testExactAnomalyReproduction() {
        let evaluator = LocationQualityEvaluator()
        let baseDate = Date(timeIntervalSince1970: 1725800000)
        let baseLat = -27.595000
        let baseLon = -48.548000
        let deltaLatPerSecond = 2.4 / 111139.0 // ~2.4 m/s northward

        var lastMotion: EvaluatedMotion?

        for i in 0..<20 {
            let timestamp = baseDate.addingTimeInterval(Double(i))
            let coordinate = CLLocationCoordinate2D(
                latitude: baseLat + Double(i) * deltaLatPerSecond,
                longitude: baseLon
            )

            // Simulating CLLocation with custom properties
            let loc = CLLocation(
                coordinate: coordinate,
                altitude: 2.0,
                horizontalAccuracy: 2.0,
                verticalAccuracy: 3.0,
                course: 262.0,
                courseAccuracy: 180.0,
                speed: 0.71,
                speedAccuracy: 3.754,
                timestamp: timestamp
            )

            let motion = evaluator.update(location: loc)
            lastMotion = motion

            // Check reported speed/course qualifications
            assert(!evaluator.isReportedSpeedQualified(loc), "Reported speed must be rejected due to speedAccuracy 3.754 > 3.0")
            assert(!evaluator.isReportedCourseQualified(loc), "Reported course must be rejected due to courseAccuracy 180 > 90")
        }

        guard let motion = lastMotion else {
            fatalError("Expected evaluated motion")
        }

        assert(motion.speedOrigin == .coordinateDerived, "Speed origin must be coordinateDerived, got \(motion.speedOrigin)")
        assert(motion.courseOrigin == .coordinateDerived, "Course origin must be coordinateDerived, got \(motion.courseOrigin)")

        guard let speedMps = motion.speedMetersPerSecond,
              let speedKmh = motion.speedKilometersPerHour,
              let course = motion.courseDegrees else {
            fatalError("Derived speed and course must not be nil")
        }

        assert(abs(speedMps - 2.4) < 0.15, "Derived speed should be ~2.4 m/s, got \(speedMps)")
        assert(abs(speedKmh - 8.64) < 0.5, "Derived speed km/h should be ~8.64, got \(speedKmh)")
        // Heading north means course is ~0° or ~360°
        assert(course < 5.0 || course > 355.0, "Derived bearing heading north should be ~0°, got \(course)")

        print("✓ testExactAnomalyReproduction passed")
    }

    static func testHealthyGPS() {
        let evaluator = LocationQualityEvaluator()
        let baseDate = Date(timeIntervalSince1970: 1725800000)
        let coordinate = CLLocationCoordinate2D(latitude: -27.595, longitude: -48.548)

        let loc = CLLocation(
            coordinate: coordinate,
            altitude: 2.0,
            horizontalAccuracy: 4.0,
            verticalAccuracy: 3.0,
            course: 90.0,
            courseAccuracy: 5.0,
            speed: 3.2,
            speedAccuracy: 0.4,
            timestamp: baseDate
        )

        let motion = evaluator.update(location: loc)
        assert(motion.speedOrigin == .reported, "Speed origin must be reported")
        assert(motion.courseOrigin == .reported, "Course origin must be reported")
        assert(motion.speedMetersPerSecond == 3.2)
        assert(abs((motion.speedKilometersPerHour ?? 0) - 11.52) < 0.001)
        assert(motion.courseDegrees == 90.0)

        print("✓ testHealthyGPS passed")
    }

    static func testDegradedGPSUnavailable() {
        let evaluator = LocationQualityEvaluator()
        let baseDate = Date(timeIntervalSince1970: 1725800000)
        let coordinate = CLLocationCoordinate2D(latitude: -27.595, longitude: -48.548)

        let loc = CLLocation(
            coordinate: coordinate,
            altitude: 2.0,
            horizontalAccuracy: 50.0, // degraded horizontal accuracy > 20m
            verticalAccuracy: 3.0,
            course: -1.0,
            courseAccuracy: -1.0,
            speed: -1.0,
            speedAccuracy: -1.0,
            timestamp: baseDate
        )

        let motion = evaluator.update(location: loc)
        assert(motion.speedOrigin == .unavailable, "Speed origin must be unavailable")
        assert(motion.courseOrigin == .unavailable, "Course origin must be unavailable")
        assert(motion.speedKilometersPerHour == nil, "Speed must be nil, never 0.0")
        assert(motion.courseDegrees == nil, "Course must be nil")

        print("✓ testDegradedGPSUnavailable passed")
    }

    static func testImplausibleJumpRejection() {
        let evaluator = LocationQualityEvaluator()
        let baseDate = Date(timeIntervalSince1970: 1725800000)
        let baseLat = -27.595000
        let baseLon = -48.548000
        let deltaLatPerSecond = 2.4 / 111139.0

        for i in 0..<5 {
            let loc = CLLocation(
                coordinate: CLLocationCoordinate2D(latitude: baseLat + Double(i) * deltaLatPerSecond, longitude: baseLon),
                altitude: 2.0,
                horizontalAccuracy: 2.0,
                verticalAccuracy: 3.0,
                course: 262.0,
                courseAccuracy: 180.0,
                speed: 0.7,
                speedAccuracy: 4.0,
                timestamp: baseDate.addingTimeInterval(Double(i))
            )
            _ = evaluator.update(location: loc)
        }

        // Now inject an implausible jump: 200m away in 1 second (200 m/s > 15 m/s limit)
        let jumpLoc = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: baseLat + 200.0 / 111139.0, longitude: baseLon),
            altitude: 2.0,
            horizontalAccuracy: 2.0,
            verticalAccuracy: 3.0,
            course: 262.0,
            courseAccuracy: 180.0,
            speed: 0.7,
            speedAccuracy: 4.0,
            timestamp: baseDate.addingTimeInterval(5.0)
        )
        let jumpMotion = evaluator.update(location: jumpLoc)

        // Speed should NOT jump to 200 m/s
        if let speed = jumpMotion.speedMetersPerSecond {
            assert(speed <= 15.0, "Speed must not exceed max plausible speed 15.0, got \(speed)")
        }

        print("✓ testImplausibleJumpRejection passed")
    }

    static func testStaleGapReset() {
        let evaluator = LocationQualityEvaluator()
        let baseDate = Date(timeIntervalSince1970: 1725800000)

        let loc1 = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: -27.595, longitude: -48.548),
            altitude: 2.0,
            horizontalAccuracy: 2.0,
            verticalAccuracy: 3.0,
            course: -1.0,
            courseAccuracy: -1.0,
            speed: -1.0,
            speedAccuracy: -1.0,
            timestamp: baseDate
        )
        _ = evaluator.update(location: loc1)

        // Gap of 30 seconds
        let loc2 = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: -27.594, longitude: -48.548),
            altitude: 2.0,
            horizontalAccuracy: 2.0,
            verticalAccuracy: 3.0,
            course: -1.0,
            courseAccuracy: -1.0,
            speed: -1.0,
            speedAccuracy: -1.0,
            timestamp: baseDate.addingTimeInterval(30.0)
        )
        let motion2 = evaluator.update(location: loc2)

        // Across a 30s gap with no reported speed, motion should be unavailable (not averaged over 30s)
        assert(motion2.speedOrigin == .unavailable, "Across a stale gap, initial point cannot yield coordinate-derived speed")

        print("✓ testStaleGapReset passed")
    }
}
