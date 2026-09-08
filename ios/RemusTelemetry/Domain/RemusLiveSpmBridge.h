#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
@interface RemusLiveSpmBridge : NSObject
- (void)reset;
- (nullable NSDictionary<NSString *, id> *)pushTimestamp:(double)timestamp
                                                       x:(double)x
                                                       y:(double)y
                                                       z:(double)z;
@end
NS_ASSUME_NONNULL_END
