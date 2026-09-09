#include "LiveSpmEstimator.hpp"
#include <cassert>
#include <cmath>
#include <iostream>

using remus::live::LiveSpmEstimator;

static remus::live::Result run(double spm) {
  LiveSpmEstimator estimator;
  remus::live::Result latest;
  constexpr double hz = 100;
  for (int i = 0; i <= 1800; ++i) {
    const double t = i / hz;
    const double phase = 2 * 3.141592653589793 * (spm / 60) * t;
    auto result = estimator.push(t, std::sin(phase), .55 * std::cos(phase), .25 * std::sin(phase + .4));
    if (result.updated) latest = result;
  }
  return latest;
}

#include <random>

static remus::live::Result run_with_gravity(double spm, double gx, double gy, double gz, bool add_noise, bool add_drift) {
  LiveSpmEstimator estimator;
  remus::live::Result latest;
  constexpr double hz = 100;
  std::mt19937 gen(42);
  std::normal_distribution<double> noise(0.0, add_noise ? 0.3 : 0.0); // moderate noise

  for (int i = 0; i <= 1800; ++i) {
    const double t = i / hz;
    const double phase = 2 * 3.141592653589793 * (spm / 60) * t;
    
    double drift_x = add_drift ? (t * 0.1) : 0; // slow drift
    double drift_y = add_drift ? (t * -0.05) : 0;
    
    double x = std::sin(phase) + gx + drift_x + noise(gen);
    double y = 0.55 * std::cos(phase) + gy + drift_y + noise(gen);
    double z = 0.25 * std::sin(phase + 0.4) + gz + noise(gen);
    
    auto result = estimator.push(t, x, y, z);
    if (result.updated) latest = result;
  }
  return latest;
}

static remus::live::Result run_aperiodic() {
  LiveSpmEstimator estimator;
  remus::live::Result latest;
  constexpr double hz = 100;
  std::mt19937 gen(42);
  std::normal_distribution<double> noise(0.0, 2.0); // large noise, no periodic signal

  for (int i = 0; i <= 1800; ++i) {
    const double t = i / hz;
    auto result = estimator.push(t, 9.8 + noise(gen), noise(gen), noise(gen));
    if (result.updated) latest = result;
  }
  return latest;
}

int main() {
  // Test basic
  for (double expected : {14.0, 20.0, 22.0, 32.0, 44.0}) {
    const auto result = run(expected);
    assert(result.available);
    assert(std::abs(result.stroke_rate_spm - expected) < .35);
  }
  
  // Test with gravity, noise, drift on different orientations
  // Orientations: Flat, Portrait, Landscape
  for (double expected : {14.0, 20.0, 22.0, 32.0, 44.0}) {
    // Z-down (flat)
    auto r1 = run_with_gravity(expected, 0.0, 0.0, 9.81, true, true);
    assert(r1.available);
    assert(std::abs(r1.stroke_rate_spm - expected) < .35);

    // Y-down (portrait)
    auto r2 = run_with_gravity(expected, 0.0, 9.81, 0.0, true, true);
    assert(r2.available);
    assert(std::abs(r2.stroke_rate_spm - expected) < .35);

    // X-down (landscape)
    auto r3 = run_with_gravity(expected, 9.81, 0.0, 0.0, true, true);
    assert(r3.available);
    assert(std::abs(r3.stroke_rate_spm - expected) < .35);
  }

  // Aperiodic signal test
  {
    auto r = run_aperiodic();
    assert(!r.available);
  }

  LiveSpmEstimator flat;
  remus::live::Result result;
  for (int i = 0; i <= 1800; ++i) if (auto next = flat.push(i / 100.0, 0, 0, 0); next.updated) result = next;
  assert(!result.available);
  assert(result.reason == "insufficient_signal");
  std::cout << "live SPM tests passed\n";
}
