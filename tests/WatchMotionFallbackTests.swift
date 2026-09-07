import Foundation

// Simulates reference frame resolution and fallback logic
enum ReferenceFrameHelper {
    static func preferredReferenceFrame(hasMagneticNorth: Bool, hasArbitraryCorrected: Bool) -> String {
        if hasMagneticNorth { return "xMagneticNorthZVertical" }
        if hasArbitraryCorrected { return "xArbitraryCorrectedZVertical" }
        return "xArbitraryZVertical"
    }

    static func nextFallbackFrame(current: String) -> String? {
        switch current {
        case "xTrueNorthZVertical":
            return "xMagneticNorthZVertical"
        case "xMagneticNorthZVertical":
            return "xArbitraryCorrectedZVertical"
        case "xArbitraryCorrectedZVertical":
            return "xArbitraryZVertical"
        default:
            return nil
        }
    }
}

@main struct WatchMotionFallbackTests {
    static func main() throws {
        // Test 1: Preferred frame selection never prefers xTrueNorthZVertical
        let preferredWithCompass = ReferenceFrameHelper.preferredReferenceFrame(hasMagneticNorth: true, hasArbitraryCorrected: true)
        assert(preferredWithCompass == "xMagneticNorthZVertical", "Should prefer xMagneticNorthZVertical over xTrueNorthZVertical")

        let preferredWithoutCompass = ReferenceFrameHelper.preferredReferenceFrame(hasMagneticNorth: false, hasArbitraryCorrected: true)
        assert(preferredWithoutCompass == "xArbitraryCorrectedZVertical", "Should fall back to xArbitraryCorrectedZVertical")

        let preferredMinimal = ReferenceFrameHelper.preferredReferenceFrame(hasMagneticNorth: false, hasArbitraryCorrected: false)
        assert(preferredMinimal == "xArbitraryZVertical", "Should fall back to xArbitraryZVertical")

        // Test 2: Fallback sequence progression
        assert(ReferenceFrameHelper.nextFallbackFrame(current: "xTrueNorthZVertical") == "xMagneticNorthZVertical")
        assert(ReferenceFrameHelper.nextFallbackFrame(current: "xMagneticNorthZVertical") == "xArbitraryCorrectedZVertical")
        assert(ReferenceFrameHelper.nextFallbackFrame(current: "xArbitraryCorrectedZVertical") == "xArbitraryZVertical")
        assert(ReferenceFrameHelper.nextFallbackFrame(current: "xArbitraryZVertical") == nil)

        // Test 3: WatchDatabaseWriter updates manifest reference frame
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("watch-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }

        let initialManifest = WatchManifest(
            id: UUID(),
            startedAt: Date(),
            endedAt: nil,
            status: .recording,
            failureMessage: nil,
            appVersion: "1.0",
            watchModel: "Apple Watch",
            systemVersion: "10.0",
            wristLocation: "right",
            crownOrientation: "right",
            motionFrequencyHertz: 50.0,
            motionReferenceFrame: "xMagneticNorthZVertical",
            motionSampleCount: 0,
            locationSampleCount: 0,
            altimeterSampleCount: 0,
            healthSampleCount: 0,
            deviceSampleCount: 0,
            databaseFilename: "watch-telemetry.sqlite"
        )

        let writer = WatchDatabaseWriter(rootDirectory: folder)
        _ = try writer.start(manifest: initialManifest)

        // Fallback occurred during recording setup
        writer.updateReferenceFrame("xArbitraryCorrectedZVertical")

        let session = writer.stop(at: Date(), failureMessage: nil)
        assert(session != nil, "Session should stop cleanly")
        assert(session?.manifest.motionReferenceFrame == "xArbitraryCorrectedZVertical", "Manifest should reflect updated fallback frame")

        print("WatchMotionFallbackTests: All reference frame fallback and writer manifest update tests passed!")
    }
}
