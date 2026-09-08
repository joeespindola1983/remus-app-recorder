# Live stroke-rate preview

The recorder exposes `strokeRateSpm` as an experimental, source-local preview on iOS and Android. It is computed from the phone's three-axis linear acceleration by the shared C++ `live-vector-acf-0.1-experimental` profile.

- causal rolling window: 15 seconds
- refresh cadence: 1 second
- search range: 12–60 strokes/minute
- causal two-stage 3 Hz low-pass before the 25 Hz analysis grid
- availability threshold: normalized vector autocorrelation ≥ 0.55
- missing or unreliable estimates are `null`, never zero

The first estimate therefore needs approximately 15 seconds. This is intentionally more responsive than the evidence-oriented offline engine's 30-second windows. It does not replace the offline result and must not be treated as athlete- or boat-level evidence until recording context declares the phone placement. The preview is not persisted as raw telemetry and no stroke count is derived from it.
