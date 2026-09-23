import SwiftUI

struct WatchContentView: View {
    @EnvironmentObject private var recorder: WatchRecorder
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @State private var selectedTab = 1 // 0 = Controls, 1 = SpeedCoach HUD

    var body: some View {
        if recorder.isRecording {
            TabView(selection: $selectedTab) {
                // Page 0: Workout Controls & Diagnostics
                workoutControlsView
                    .tag(0)

                // Page 1: SpeedCoach High-Glance HUD
                speedCoachHudView
                    .tag(1)
            }
            .tabViewStyle(.page)
        } else {
            idleStartView
        }
    }

    // MARK: - SpeedCoach High-Glance HUD (Page 1)
    private var speedCoachHudView: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            // TOP SECTION: SPM (Stroke Rate)
            VStack(spacing: 0) {
                Text(spmDisplayString)
                    .font(.system(size: isLuminanceReduced ? 48 : 54, weight: .black, design: .rounded))
                    .foregroundStyle(isLuminanceReduced ? Color.gray : Color(red: 0.29, green: 0.87, blue: 0.50)) // #4ADE80
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                    .monospacedDigit()

                Text("SPM")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(isLuminanceReduced ? Color.gray : Color.white)
                    .tracking(1)
            }
            .frame(maxWidth: .infinity)

            Divider()
                .background(isLuminanceReduced ? Color.gray.opacity(0.2) : Color.white.opacity(0.25))
                .padding(.horizontal, 16)
                .padding(.vertical, 2)

            // MIDDLE SECTION: SPLIT (/500m)
            VStack(spacing: 0) {
                Text(splitDisplayString)
                    .font(.system(size: isLuminanceReduced ? 38 : 44, weight: .black, design: .rounded))
                    .foregroundStyle(isLuminanceReduced ? Color.gray : Color.white)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                    .monospacedDigit()

                Text("/500m")
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(isLuminanceReduced ? Color.gray : Color(red: 0.58, green: 0.64, blue: 0.72))
                    .tracking(1)
            }
            .frame(maxWidth: .infinity)

            Spacer(minLength: 0)

            // BOTTOM SECTION: Distance, Heart Rate & Elapsed Time
            if !isLuminanceReduced {
                HStack(alignment: .center) {
                    // Distance
                    HStack(spacing: 2) {
                        Image(systemName: "flag.fill")
                            .font(.system(size: 9))
                            .foregroundStyle(.cyan)
                        Text(distanceDisplayString)
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .monospacedDigit()
                    }

                    Spacer()

                    // Heart Rate
                    if let hr = recorder.heartRate, hr > 0 {
                        HStack(spacing: 2) {
                            Image(systemName: "heart.fill")
                                .font(.system(size: 9))
                                .foregroundStyle(.red)
                            Text("\(Int(hr))")
                                .font(.system(size: 12, weight: .bold, design: .rounded))
                                .monospacedDigit()
                        }
                    }

                    Spacer()

                    // Elapsed Workout Time
                    if let startedAt = recorder.startedAt {
                        TimelineView(.periodic(from: .now, by: 1)) { context in
                            let elapsed = max(0, context.date.timeIntervalSince(startedAt))
                            HStack(spacing: 2) {
                                Image(systemName: "stopwatch.fill")
                                    .font(.system(size: 9))
                                    .foregroundStyle(.yellow)
                                Text(formatTime(elapsed))
                                    .font(.system(size: 12, weight: .bold, design: .rounded))
                                    .monospacedDigit()
                            }
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 2)
            } else {
                // Dimmed minimal footer for Always-On Display
                HStack {
                    Text(distanceDisplayString)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                    Spacer()
                    if let startedAt = recorder.startedAt {
                        let elapsed = max(0, Date().timeIntervalSince(startedAt))
                        Text(formatTime(elapsed))
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.ignoresSafeArea())
    }

    // MARK: - Workout Controls (Page 0)
    private var workoutControlsView: some View {
        ScrollView {
            VStack(spacing: 12) {
                HStack {
                    Circle()
                        .fill(Color.red)
                        .frame(width: 8, height: 8)
                    Text("Remus Workout")
                        .font(.headline)
                    Spacer()
                }

                if let startedAt = recorder.startedAt {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(Duration.seconds(max(0, context.date.timeIntervalSince(startedAt))).formatted(.time(pattern: .hourMinuteSecond)))
                            .font(.title3.monospacedDigit().bold())
                    }
                }

                Button(role: .destructive) {
                    recorder.stop()
                } label: {
                    Label("End Workout", systemImage: "stop.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .disabled(recorder.state == .stopping)

                // Quick Diagnostics
                Grid(horizontalSpacing: 10, verticalSpacing: 4) {
                    GridRow {
                        diagCell("Heart", recorder.heartRate.map { "\(Int($0)) bpm" } ?? "—")
                        diagCell("GPS Acc", recorder.gpsAccuracyMeters.map { "±\(Int($0))m" } ?? "—")
                    }
                    GridRow {
                        diagCell("Motion", "\(recorder.measuredHertz.formatted(.number.precision(.fractionLength(1)))) Hz")
                        diagCell("Battery", recorder.batteryLevel.map { "\(Int($0 * 100))%" } ?? "—")
                    }
                }
                .padding(.top, 4)

                Text("👉 Swipe for SpeedCoach HUD")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 4)
        }
    }

    // MARK: - Idle Screen (Before starting)
    private var idleStartView: some View {
        ScrollView {
            VStack(spacing: 12) {
                VStack(spacing: 2) {
                    Image(systemName: "figure.rower")
                        .font(.system(size: 28))
                        .foregroundStyle(.green)
                    Text("REMUS")
                        .font(.title2.bold())
                    Text("Outdoor Rowing")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 4)

                Button {
                    selectedTab = 1
                    recorder.start()
                } label: {
                    Label("Start Workout", systemImage: "play.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(recorder.state == .requestingPermissions)

                VStack(spacing: 2) {
                    Text(recorder.status)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    Text(recorder.transferStatus)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    if case let .failed(message) = recorder.state {
                        Text(message)
                            .font(.caption2)
                            .foregroundStyle(.red)
                    }
                }
            }
            .padding(.horizontal, 4)
        }
    }

    // MARK: - Formatters & Computed Helpers
    private var spmDisplayString: String {
        if let spm = recorder.strokeRateSpm, spm > 0 {
            return String(format: "%.0f", spm)
        }
        return "—"
    }

    private var splitDisplayString: String {
        if let split = recorder.splitSeconds, split > 0, split < 1800 {
            let minutes = Int(split) / 60
            let seconds = Int(split) % 60
            if isLuminanceReduced {
                // In Always-On mode: M:SS (e.g. 1:52)
                return String(format: "%d:%02d", minutes, seconds)
            } else {
                // In active wrist-up mode: M:SS.S (e.g. 1:52.4)
                let tenths = Int((split - Double(Int(split))) * 10)
                return String(format: "%d:%02d.%d", minutes, seconds, tenths)
            }
        }
        return "—:——"
    }

    private var distanceDisplayString: String {
        if let d = recorder.distanceMeters, d > 0 {
            if d >= 1000 {
                return String(format: "%.2f km", d / 1000.0)
            } else {
                return String(format: "%.0f m", d)
            }
        }
        return "0 m"
    }

    private func formatTime(_ elapsed: TimeInterval) -> String {
        let m = Int(elapsed) / 60
        let s = Int(elapsed) % 60
        if m >= 60 {
            let h = m / 60
            return String(format: "%d:%02d:%02d", h, m % 60, s)
        } else {
            return String(format: "%02d:%02d", m, s)
        }
    }

    private func diagCell(_ title: String, _ value: String) -> some View {
        VStack(spacing: 1) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.caption.monospacedDigit()).lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }
}
