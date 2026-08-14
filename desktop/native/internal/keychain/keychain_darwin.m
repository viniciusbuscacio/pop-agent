//go:build darwin

#import <Foundation/Foundation.h>
#import <Security/Security.h>

static NSString *stringFromUTF8(const char *value) {
    return [NSString stringWithUTF8String:value];
}

// The caller owns the returned dictionary and must release it.
static NSMutableDictionary *queryFor(const char *service, const char *account) {
    return [@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: stringFromUTF8(service),
        (__bridge id)kSecAttrAccount: stringFromUTF8(account)
    } mutableCopy];
}

int pop_keychain_get(const char *service, const char *account, char **value) {
    NSMutableDictionary *query = queryFor(service, account);
    query[(__bridge id)kSecReturnData] = @YES;
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;

    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    [query release];
    if (status != errSecSuccess) {
        return (int)status;
    }

    NSData *data = (NSData *)result;
    NSString *token = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    CFRelease(result);
    if (token == nil) {
        return (int)errSecDecode;
    }
    *value = strdup([token UTF8String]);
    [token release];
    return *value == NULL ? (int)errSecAllocate : (int)errSecSuccess;
}

int pop_keychain_set(const char *service, const char *account, const char *value) {
    NSMutableDictionary *query = queryFor(service, account);
    NSData *data = [stringFromUTF8(value) dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *updates = @{(__bridge id)kSecValueData: data};
    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)updates);
    if (status == errSecItemNotFound) {
        query[(__bridge id)kSecValueData] = data;
        query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlock;
        status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    }
    [query release];
    return (int)status;
}

int pop_keychain_delete(const char *service, const char *account) {
    NSMutableDictionary *query = queryFor(service, account);
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
    [query release];
    return (int)status;
}
