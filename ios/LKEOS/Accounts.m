#import "Accounts.h"
#import <Security/Security.h>

@implementation Accounts
- (NSUserDefaults *)defaults { return NSUserDefaults.standardUserDefaults; }
- (NSString *)active { return [self.defaults stringForKey:@"activeProfile"] ?: @"default"; }
- (NSArray *)profiles { return [self.defaults arrayForKey:@"profiles"] ?: @[@{@"id":@"default",@"name":@"Основной"}]; }
- (BOOL)select:(NSString *)identifier newName:(NSString *)name {
    name = [name stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (name.length) {
        if (name.length > 60) return NO;
        for (NSDictionary *p in self.profiles) if ([p[@"name"] caseInsensitiveCompare:name] == NSOrderedSame) return NO;
        identifier = NSUUID.UUID.UUIDString;
        [self.defaults setObject:[self.profiles arrayByAddingObject:@{@"id":identifier,@"name":name}] forKey:@"profiles"];
    } else if (!identifier || ![[self.profiles valueForKey:@"id"] containsObject:identifier]) return NO;
    [self.defaults setObject:identifier forKey:@"activeProfile"]; return YES;
}
- (NSString *)key:(NSString *)service item:(NSString *)item {
    return [NSString stringWithFormat:@"%@.%@.%@",self.active, service, item];
}
- (NSUUID *)storeID:(NSString *)service {
    NSString *key=[self key:service item:@"webStore"];
    NSString *stored=[self.defaults stringForKey:key];
    NSUUID *uuid=stored ? [[NSUUID alloc] initWithUUIDString:stored] : nil;
    if (!uuid) { uuid=NSUUID.UUID; [self.defaults setObject:uuid.UUIDString forKey:key]; }
    return uuid;
}
- (BOOL)connected:(NSString *)service { return [self.defaults boolForKey:[self key:service item:@"connected"]]; }
- (void)setConnected:(BOOL)value service:(NSString *)service { [self.defaults setBool:value forKey:[self key:service item:@"connected"]]; }
- (NSDictionary *)query:(NSString *)service {
    return @{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,
             (__bridge id)kSecAttrService:[NSBundle.mainBundle.bundleIdentifier stringByAppendingString:@".login"],
             (__bridge id)kSecAttrAccount:[self key:service item:@"credential"]};
}
- (NSDictionary *)credential:(NSString *)service {
    NSMutableDictionary *q=[[self query:service] mutableCopy]; q[(__bridge id)kSecReturnData]=@YES;
    CFTypeRef ref=NULL;
    if (SecItemCopyMatching((__bridge CFDictionaryRef)q,&ref)!=errSecSuccess) return nil;
    NSData *data=CFBridgingRelease(ref); return [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
}
- (BOOL)save:(NSString *)service login:(NSString *)login password:(NSString *)password {
    if (!login.length || !password.length) return NO;
    NSData *bytes=[NSJSONSerialization dataWithJSONObject:@{@"login":login,@"password":password} options:0 error:nil];
    NSDictionary *key=[self query:service];
    NSDictionary *attrs=@{(__bridge id)kSecValueData:bytes,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly};
    OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)key,(__bridge CFDictionaryRef)attrs);
    if (status==errSecItemNotFound) {
        NSMutableDictionary *row=[key mutableCopy]; [row addEntriesFromDictionary:attrs];
        status=SecItemAdd((__bridge CFDictionaryRef)row,NULL);
    }
    return status==errSecSuccess;
}
- (BOOL)forget:(NSString *)service {
    OSStatus s=SecItemDelete((__bridge CFDictionaryRef)[self query:service]);
    return s==errSecSuccess || s==errSecItemNotFound;
}
- (NSDictionary *)view {
    return @{@"active":self.active,@"profiles":self.profiles,@"restoreEos":@([self connected:@"eos"]),@"restoreLks":@([self connected:@"lks"]),
             @"eos":[self credential:@"eos"][@"login"] ?: NSNull.null,@"lks":[self credential:@"lks"][@"login"] ?: NSNull.null};
}
@end
