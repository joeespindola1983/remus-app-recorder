import SwiftUI

struct WatchContentView: View {
    @EnvironmentObject private var recorder: WatchRecorder

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                HStack {
                    Circle()
                        .fill(recorder.isRecording ? .red : .secondary)
                        .frame(width: 9, height: 9)
                    Text(recorder.isRecording ? "Recording" : "Remus")
                        .font(.headline)
                    Spacer()
                }

                if recorder.isRecording, let startedAt = recorder.startedAt {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(Duration.seconds(max(0, context.date.timeIntervalSince(startedAt))).formatted(.time(pattern: .hourMinuteSecond)))
                            .font(.title2.monospacedDigit())
                    }
                }

                metrics

                Button {
                    recorder.isRecording ? recorder.stop() : recorder.start()
                } label: {
                    Label(recorder.isRecording ? "Stop" : "Start", systemImage: recorder.isRecording ? "stop.fill" : "record.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(recorder.isRecording ? .red : .blue)
                .disabled(recorder.state == .requestingPermissions || recorder.state == .stopping)

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
            .padding(.horizontal, 4)
        }
    }

    private var metrics: some View {
        Grid(horizontalSpacing: 12, verticalSpacing: 5) {
            GridRow {
                value("Heart", recorder.heartRate.map { "\(Int($0)) bpm" } ?? "—")
                value("Motion", "\(recorder.measuredHertz.formatted(.number.precision(.fractionLength(1)))) Hz")
            }
            GridRow {
                value("GPS", recorder.gpsAccuracyMeters.map { "±\(Int($0)) m" } ?? "—")
                value("Battery", recorder.batteryLevel.map { "\(Int($0 * 100))%" } ?? "—")
            }
            GridRow {
                value("Samples", recorder.elapsedSamples.formatted())
                value("Queue", recorder.queuedWrites.formatted())
            }
        }
    }

    private func value(_ title: String, _ value: String) -> some View {
        VStack(spacing: 1) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.caption.monospacedDigit()).lineLimit(1)
        }
        .frame(maxWidth: .infinity)
    }
}
