#include <jni.h>
#include <cstdint>
#include "LiveSpmEstimator.hpp"
#include <cmath>

using remus::live::LiveSpmEstimator;
extern "C" JNIEXPORT jlong JNICALL Java_com_remus_telemetry_LiveSpmNative_create(JNIEnv*, jobject) {
  return reinterpret_cast<jlong>(new LiveSpmEstimator());
}
extern "C" JNIEXPORT void JNICALL Java_com_remus_telemetry_LiveSpmNative_destroy(JNIEnv*, jobject, jlong handle) {
  delete reinterpret_cast<LiveSpmEstimator*>(handle);
}
extern "C" JNIEXPORT void JNICALL Java_com_remus_telemetry_LiveSpmNative_reset(JNIEnv*, jobject, jlong handle) {
  reinterpret_cast<LiveSpmEstimator*>(handle)->reset();
}
extern "C" JNIEXPORT jdoubleArray JNICALL Java_com_remus_telemetry_LiveSpmNative_push(
    JNIEnv* env, jobject, jlong handle, jdouble timestamp, jdouble x, jdouble y, jdouble z) {
  const auto r = reinterpret_cast<LiveSpmEstimator*>(handle)->push(timestamp, x, y, z);
  if (!r.updated) return nullptr;
  const double values[] = {r.available ? 1.0 : (r.progress < 1 ? 0.0 : -1.0), r.available ? r.stroke_rate_spm : NAN,
                           r.periodicity, r.progress, r.observed_hz};
  auto output = env->NewDoubleArray(5);
  env->SetDoubleArrayRegion(output, 0, 5, values);
  return output;
}
