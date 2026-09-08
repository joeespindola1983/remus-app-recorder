#import "RemusLiveSpmBridge.h"
#include "../../../native/live_spm/LiveSpmEstimator.hpp"

@implementation RemusLiveSpmBridge {
  remus::live::LiveSpmEstimator _estimator;
}
- (void)reset { _estimator.reset(); }
- (NSDictionary<NSString *, id> *)pushTimestamp:(double)timestamp x:(double)x y:(double)y z:(double)z {
  const auto result = _estimator.push(timestamp, x, y, z);
  if (!result.updated) return nil;
  return @{
    @"strokeRateSpm": result.available ? @(result.stroke_rate_spm) : [NSNull null],
    @"strokeRateStatus": result.available ? @"available" : (result.progress < 1 ? @"collecting" : @"unavailable"),
    @"strokeRateReason": [NSString stringWithUTF8String:result.reason.c_str()],
    @"strokeRatePeriodicity": @(result.periodicity),
    @"strokeRateProgress": @(result.progress),
    @"strokeRateWindowSeconds": @(remus::live::kWindowSeconds),
    @"strokeRateObservedHertz": @(result.observed_hz),
    @"strokeRateAlgorithmVersion": [NSString stringWithUTF8String:remus::live::kAlgorithmVersion],
    @"strokeRateOrigin": @"phone_linear_acceleration"
  };
}
@end
