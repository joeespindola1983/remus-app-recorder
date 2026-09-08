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

int main() {
  for (double expected : {14.0, 22.0, 32.0, 44.0}) {
    const auto result = run(expected);
    assert(result.available);
    assert(std::abs(result.stroke_rate_spm - expected) < .35);
  }
  LiveSpmEstimator flat;
  remus::live::Result result;
  for (int i = 0; i <= 1800; ++i) if (auto next = flat.push(i / 100.0, 0, 0, 0); next.updated) result = next;
  assert(!result.available);
  assert(result.reason == "insufficient_signal");
  std::cout << "live SPM tests passed\n";
}
