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
- (NSDictionary *)storedCredential:(NSString *)service {
    NSMutableDictionary *q=[[self query:service] mutableCopy]; q[(__bridge id)kSecReturnData]=@YES;
    CFTypeRef ref=NULL;
    if (SecItemCopyMatching((__bridge CFDictionaryRef)q,&ref)!=errSecSuccess) return nil;
    NSData *data=CFBridgingRelease(ref); return [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
}
- (NSDictionary *)credential:(NSString *)service {
    return [self storedCredential:@"shared"] ?: [self storedCredential:@"eos"] ?: [self storedCredential:@"lks"];
}
- (BOOL)hasDifferentLegacyLksAccount {
    NSString *primary=[self credential:@"eos"][@"login"];
    NSString *legacy=[self storedCredential:@"lks"][@"login"];
    return primary.length && legacy.length && [primary caseInsensitiveCompare:legacy]!=NSOrderedSame;
}
- (BOOL)autoLoginEnabled {
    NSNumber *value=[self.defaults objectForKey:[self key:@"shared" item:@"autoLogin"]];
    return value ? value.boolValue : YES;
}
- (void)setAutoLoginEnabled:(BOOL)enabled {
    [self.defaults setBool:enabled forKey:[self key:@"shared" item:@"autoLogin"]];
}
- (BOOL)renameActive:(NSString *)name {
    name=[name stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (!name.length || name.length>60) return NO;
    NSMutableArray *rows=[self.profiles mutableCopy];
    for (NSUInteger i=0; i<rows.count; i++) {
        NSDictionary *p=rows[i];
        if ([p[@"id"] isEqual:self.active]) rows[i]=@{@"id":self.active,@"name":name};
        else if ([p[@"name"] caseInsensitiveCompare:name]==NSOrderedSame) return NO;
    }
    [self.defaults setObject:rows forKey:@"profiles"];return YES;
}
- (BOOL)removeActive {
    if (![self forget:@"shared"]) return NO;
    NSMutableArray *profiles=[self.profiles mutableCopy];
    [profiles filterUsingPredicate:[NSPredicate predicateWithFormat:@"id != %@", self.active]];
    if (!profiles.count) [profiles addObject:@{@"id":NSUUID.UUID.UUIDString,@"name":@"Основной"}];
    for (NSString *service in @[@"eos",@"lks"]) {
        [self.defaults removeObjectForKey:[self key:service item:@"webStore"]];
        [self.defaults removeObjectForKey:[self key:service item:@"connected"]];
    }
    [self.defaults removeObjectForKey:[self key:@"shared" item:@"autoLogin"]];
    [self.defaults setObject:profiles forKey:@"profiles"];
    [self.defaults setObject:profiles.firstObject[@"id"] forKey:@"activeProfile"];
    return YES;
}
- (BOOL)save:(NSString *)service login:(NSString *)login password:(NSString *)password {
    if (!login.length || !password.length) return NO;
    NSData *bytes=[NSJSONSerialization dataWithJSONObject:@{@"login":login,@"password":password} options:0 error:nil];
    NSDictionary *key=[self query:@"shared"];
    NSDictionary *attrs=@{(__bridge id)kSecValueData:bytes,(__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly};
    OSStatus status=SecItemUpdate((__bridge CFDictionaryRef)key,(__bridge CFDictionaryRef)attrs);
    if (status==errSecItemNotFound) {
        NSMutableDictionary *row=[key mutableCopy]; [row addEntriesFromDictionary:attrs];
        status=SecItemAdd((__bridge CFDictionaryRef)row,NULL);
    }
    if (status!=errSecSuccess) return NO;
    for (NSString *old in @[@"eos",@"lks"]) SecItemDelete((__bridge CFDictionaryRef)[self query:old]);
    return YES;
}
- (BOOL)forget:(NSString *)service {
    for (NSString *key in @[@"shared",@"eos",@"lks"]) {
        OSStatus status=SecItemDelete((__bridge CFDictionaryRef)[self query:key]);
        if (status!=errSecSuccess && status!=errSecItemNotFound) return NO;
    }
    return YES;
}
- (NSDictionary *)view {
    return @{@"active":self.active,@"autoLogin":@(self.autoLoginEnabled),@"profiles":self.profiles,@"restoreEos":@([self connected:@"eos"]),@"restoreLks":@([self connected:@"lks"]),
             @"eos":[self credential:@"eos"][@"login"] ?: NSNull.null,@"lks":[self credential:@"lks"][@"login"] ?: NSNull.null};
}
@end
