#import <Foundation/Foundation.h>

@interface Accounts : NSObject
@property(nonatomic, readonly) NSString *active;
- (NSDictionary *)view;
- (BOOL)autoLoginEnabled;
- (void)setAutoLoginEnabled:(BOOL)enabled;
- (BOOL)renameActive:(NSString *)name;
- (BOOL)removeActive;
- (BOOL)hasDifferentLegacyLksAccount;
- (BOOL)select:(NSString *)identifier newName:(NSString *)name;
- (NSUUID *)storeID:(NSString *)service;
- (NSDictionary *)credential:(NSString *)service;
- (BOOL)save:(NSString *)service login:(NSString *)login password:(NSString *)password;
- (BOOL)forget:(NSString *)service;
- (BOOL)connected:(NSString *)service;
- (void)setConnected:(BOOL)value service:(NSString *)service;
@end
