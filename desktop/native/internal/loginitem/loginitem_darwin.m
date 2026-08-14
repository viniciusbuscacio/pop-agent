//go:build darwin

#import <Foundation/Foundation.h>
#import <ServiceManagement/ServiceManagement.h>
#import <pthread.h>
#include <string.h>

int pop_login_item_enabled(void) {
    if (@available(macOS 13.0, *)) {
        return [SMAppService mainAppService].status == SMAppServiceStatusEnabled;
    }
    return 0;
}

static int setEnabledOnMain(int enabled, char **errorMessage) {
    if (@available(macOS 13.0, *)) {
        NSError *error = nil;
        BOOL success = enabled
            ? [[SMAppService mainAppService] registerAndReturnError:&error]
            : [[SMAppService mainAppService] unregisterAndReturnError:&error];
        if (!success && error != nil) {
            *errorMessage = strdup([[error localizedDescription] UTF8String]);
        }
        return success ? 1 : 0;
    }
    *errorMessage = strdup("Start at Login requires macOS 13 or later.");
    return 0;
}

int pop_set_login_item_enabled(int enabled, char **errorMessage) {
    __block int result = 0;
    void (^update)(void) = ^{ result = setEnabledOnMain(enabled, errorMessage); };
    if (pthread_main_np() != 0) {
        update();
    } else {
        dispatch_sync(dispatch_get_main_queue(), update);
    }
    return result;
}
