import SwiftUI
import HealthKit
import WatchKit

final class RemusWatchAppDelegate: NSObject, WKApplicationDelegate {
    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        Task { @MainActor in
            WatchRecorder.shared.startFromCompanion(workoutConfiguration)
        }
    }
}

@main
struct RemusWatchApp: App {
    @WKApplicationDelegateAdaptor(RemusWatchAppDelegate.self) private var appDelegate
    @StateObject private var recorder = WatchRecorder.shared

    var body: some Scene {
        WindowGroup {
            WatchContentView()
                .environmentObject(recorder)
        }
    }
}
