//go:build darwin

#import <Cocoa/Cocoa.h>
#import <pthread.h>
#include <string.h>

static NSString *dialogString(const char *value) {
    if (value == NULL) {
        return @"";
    }
    return [NSString stringWithUTF8String:value];
}

static int promptServerOnMain(const char *currentURL, char **serverURL, char **password) {
    [NSApp activateIgnoringOtherApps:YES];

    NSAlert *alert = [[NSAlert alloc] init];
    [alert setMessageText:@"Configure Pop Agent Server"];
    [alert setInformativeText:@"Enter the Pop Agent server URL and your normal server password."];
    [alert addButtonWithTitle:@"Connect"];
    [alert addButtonWithTitle:@"Cancel"];

    NSView *form = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 380, 104)];
    NSTextField *urlLabel = [NSTextField labelWithString:@"Server URL"];
    [urlLabel setFrame:NSMakeRect(0, 84, 380, 18)];
    NSTextField *urlField = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 56, 380, 24)];
    [urlField setStringValue:dialogString(currentURL)];
    [urlField setPlaceholderString:@"https://pop.example.com"];

    NSTextField *passwordLabel = [NSTextField labelWithString:@"Password"];
    [passwordLabel setFrame:NSMakeRect(0, 30, 380, 18)];
    NSSecureTextField *passwordField = [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 0, 380, 24)];

    [form addSubview:urlLabel];
    [form addSubview:urlField];
    [form addSubview:passwordLabel];
    [form addSubview:passwordField];
    [alert setAccessoryView:form];
    NSWindow *window = [alert window];
    [window setInitialFirstResponder:urlField];
    [window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    [window makeFirstResponder:urlField];

    // Menu-bar-only applications have no Edit menu to dispatch standard text
    // shortcuts. Forward them to the active field editor while this dialog is
    // open so URL and password fields behave like normal macOS controls.
    id shortcutMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown
        handler:^NSEvent *(NSEvent *event) {
            if (([event modifierFlags] & NSEventModifierFlagCommand) == 0) {
                return event;
            }
            NSString *key = [[event charactersIgnoringModifiers] lowercaseString];
            SEL action = nil;
            if ([key isEqualToString:@"x"]) action = @selector(cut:);
            if ([key isEqualToString:@"c"]) action = @selector(copy:);
            if ([key isEqualToString:@"v"]) action = @selector(paste:);
            if ([key isEqualToString:@"a"]) action = @selector(selectAll:);
            if (action == nil) {
                return event;
            }
            [NSApp sendAction:action to:nil from:nil];
            return nil;
        }];

    NSModalResponse response = [alert runModal];
    [NSEvent removeMonitor:shortcutMonitor];
    int accepted = response == NSAlertFirstButtonReturn;
    if (accepted) {
        *serverURL = strdup([[urlField stringValue] UTF8String]);
        *password = strdup([[passwordField stringValue] UTF8String]);
        if (*serverURL == NULL || *password == NULL) {
            free(*serverURL);
            free(*password);
            *serverURL = NULL;
            *password = NULL;
            accepted = 0;
        }
    }

    [passwordField setStringValue:@""];
    [passwordField release];
    [urlField release];
    [form release];
    [alert release];
    return accepted;
}

int pop_prompt_server(const char *currentURL, char **serverURL, char **password) {
    __block int result = 0;
    void (^prompt)(void) = ^{ result = promptServerOnMain(currentURL, serverURL, password); };
    if (pthread_main_np() != 0) {
        prompt();
    } else {
        dispatch_sync(dispatch_get_main_queue(), prompt);
    }
    return result;
}

static void showAlertOnMain(const char *title, const char *message, NSAlertStyle style) {
    [NSApp activateIgnoringOtherApps:YES];
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setAlertStyle:style];
    [alert setMessageText:dialogString(title)];
    [alert setInformativeText:dialogString(message)];
    [alert addButtonWithTitle:@"OK"];
    [alert runModal];
    [alert release];
}

static void showAlert(const char *title, const char *message, NSAlertStyle style) {
    void (^present)(void) = ^{ showAlertOnMain(title, message, style); };
    if (pthread_main_np() != 0) {
        present();
    } else {
        dispatch_sync(dispatch_get_main_queue(), present);
    }
}

static int confirmOnMain(const char *title, const char *message, const char *acceptTitle) {
    [NSApp activateIgnoringOtherApps:YES];
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setAlertStyle:NSAlertStyleInformational];
    [alert setMessageText:dialogString(title)];
    [alert setInformativeText:dialogString(message)];
    [alert addButtonWithTitle:dialogString(acceptTitle)];
    [alert addButtonWithTitle:@"Not Now"];
    NSModalResponse response = [alert runModal];
    [alert release];
    return response == NSAlertFirstButtonReturn;
}

int pop_confirm(const char *title, const char *message, const char *acceptTitle) {
    __block int result = 0;
    void (^present)(void) = ^{ result = confirmOnMain(title, message, acceptTitle); };
    if (pthread_main_np() != 0) {
        present();
    } else {
        dispatch_sync(dispatch_get_main_queue(), present);
    }
    return result;
}

void pop_show_info(const char *title, const char *message) {
    showAlert(title, message, NSAlertStyleInformational);
}

void pop_show_error(const char *title, const char *message) {
    showAlert(title, message, NSAlertStyleCritical);
}
