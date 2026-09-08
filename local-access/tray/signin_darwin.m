#import <Cocoa/Cocoa.h>
#include <stdlib.h>
#include <string.h>

// Go menu callbacks run off the main thread; AppKit dialogs must not.
char *popPromptPassword(const char *server) {
    __block char *result = NULL;
    NSString *origin = [NSString stringWithUTF8String:server];
    dispatch_sync(dispatch_get_main_queue(), ^{
        NSAlert *alert = [[NSAlert alloc] init];
        alert.messageText = @"Sign in to Pop Agent";
        alert.informativeText = [NSString stringWithFormat:@"Server: %@\n\nEnter your Pop Agent password to reconnect this computer. Your file-access permission will not change.", origin];
        [alert addButtonWithTitle:@"Sign in"];
        [alert addButtonWithTitle:@"Cancel"];
        NSSecureTextField *field = [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 0, 360, 26)];
        field.placeholderString = @"Password";
        field.accessibilityLabel = @"Pop Agent password";
        alert.accessoryView = field;
        [alert.window setInitialFirstResponder:field];
        [NSApp activateIgnoringOtherApps:YES];
        if ([alert runModal] == NSAlertFirstButtonReturn) {
            result = strdup(field.stringValue.UTF8String);
        }
        field.stringValue = @"";
    });
    return result;
}

void popShowSignInError(const char *message) {
    NSString *text = [NSString stringWithUTF8String:message];
    dispatch_sync(dispatch_get_main_queue(), ^{
        NSAlert *alert = [[NSAlert alloc] init];
        alert.messageText = @"Could not sign in";
        alert.informativeText = text;
        [alert addButtonWithTitle:@"OK"];
        [NSApp activateIgnoringOtherApps:YES];
        [alert runModal];
    });
}
