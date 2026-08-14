//go:build darwin

#import <Cocoa/Cocoa.h>
#include <stdlib.h>
#include <string.h>

static NSWindow *progressWindow;
static NSTextField *progressLabel;
static NSProgressIndicator *progressIndicator;

static NSString *popSetupString(const char *value) {
    if (value == NULL) return @"";
    return [NSString stringWithUTF8String:value] ?: @"";
}

static void installMenus(void) {
    if ([NSApp mainMenu] != nil) return;
    NSMenu *mainMenu = [[NSMenu alloc] initWithTitle:@""];

    NSMenuItem *appRoot = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Pop Desktop Setup"];
    [appMenu addItemWithTitle:@"Quit Pop Desktop Setup" action:@selector(terminate:) keyEquivalent:@"q"];
    [appRoot setSubmenu:appMenu];
    [mainMenu addItem:appRoot];
    [appMenu release];
    [appRoot release];

    // NSTextField routes standard shortcuts through the responder chain, but
    // only when the application owns the matching Edit menu commands.
    NSMenuItem *editRoot = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
    NSMenuItem *redo = [editMenu addItemWithTitle:@"Redo" action:@selector(redo:) keyEquivalent:@"Z"];
    [redo setKeyEquivalentModifierMask:NSEventModifierFlagCommand | NSEventModifierFlagShift];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
    [editRoot setSubmenu:editMenu];
    [mainMenu addItem:editRoot];
    [editMenu release];
    [editRoot release];

    [NSApp setMainMenu:mainMenu];
    [mainMenu release];
}

static void prepareApplication(void) {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    installMenus();
    [NSApp activateIgnoringOtherApps:YES];
}

static NSTextField *label(NSString *text, NSRect frame) {
    NSTextField *field = [[NSTextField alloc] initWithFrame:frame];
    [field setStringValue:text];
    [field setEditable:NO];
    [field setSelectable:NO];
    [field setBezeled:NO];
    [field setDrawsBackground:NO];
    [field setFont:[NSFont systemFontOfSize:12.0]];
    return field;
}

int pop_setup_paste_menu_ready_for_testing(void) {
    prepareApplication();
    for (NSMenuItem *root in [[NSApp mainMenu] itemArray]) {
        for (NSMenuItem *item in [[root submenu] itemArray]) {
            if ([item action] == @selector(paste:) && [[item keyEquivalent] isEqualToString:@"v"]) return 1;
        }
    }
    return 0;
}

int pop_setup_welcome(void) {
    prepareApplication();
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setMessageText:@"Welcome to Pop Desktop Setup"];
    [alert setInformativeText:@"This wizard installs Pop Desktop, Pop CLI, and a private Node.js runtime for your user account. Administrator access is not required."];
    [alert addButtonWithTitle:@"Continue"];
    [alert addButtonWithTitle:@"Quit"];
    NSModalResponse response = [alert runModal];
    [alert release];
    return response == NSAlertFirstButtonReturn ? 1 : 0;
}

int pop_setup_credentials(const char *initialURL, char **serverURL, char **password) {
    prepareApplication();
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setMessageText:@"Connect to your Pop Agent"];
    [alert setInformativeText:@"Enter the address shown in Settings → Installation and your Pop Agent password."];
    [alert addButtonWithTitle:@"Install"];
    [alert addButtonWithTitle:@"Quit"];

    NSView *accessory = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 430, 112)];
    NSTextField *urlLabel = label(@"Pop Agent address", NSMakeRect(0, 86, 430, 18));
    NSTextField *urlField = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 58, 430, 24)];
    NSString *suggestedURL = popSetupString(initialURL);
    if (suggestedURL.length == 0) {
        NSString *clipboard = [[NSPasteboard generalPasteboard] stringForType:NSPasteboardTypeString];
        if ([clipboard hasPrefix:@"https://"] || [clipboard hasPrefix:@"http://127.0.0.1"] || [clipboard hasPrefix:@"http://localhost"]) {
            suggestedURL = clipboard;
        }
    }
    [urlField setStringValue:suggestedURL];
    [urlField setPlaceholderString:@"https://pop.example.com"];
    NSTextField *passwordLabel = label(@"Password", NSMakeRect(0, 32, 430, 18));
    NSSecureTextField *passwordField = [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 4, 430, 24)];
    [passwordField setPlaceholderString:@"Pop Agent password"];
    [accessory addSubview:urlLabel];
    [accessory addSubview:urlField];
    [accessory addSubview:passwordLabel];
    [accessory addSubview:passwordField];
    [urlLabel release];
    [passwordLabel release];
    [alert setAccessoryView:accessory];
    [accessory release];
    [alert.window setInitialFirstResponder:urlField];

    NSModalResponse response = [alert runModal];
    if (response == NSAlertFirstButtonReturn) {
        *serverURL = strdup(urlField.stringValue.UTF8String ?: "");
        *password = strdup(passwordField.stringValue.UTF8String ?: "");
    }
    [urlField release];
    [passwordField release];
    [alert release];
    return response == NSAlertFirstButtonReturn ? 1 : 0;
}

void pop_setup_begin_progress(void) {
    prepareApplication();
    NSRect frame = NSMakeRect(0, 0, 500, 180);
    progressWindow = [[NSWindow alloc] initWithContentRect:frame
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
    [progressWindow setTitle:@"Pop Desktop Setup"];
    [progressWindow setReleasedWhenClosed:NO];
    [progressWindow center];

    NSTextField *title = label(@"Installing Pop Desktop", NSMakeRect(36, 118, 428, 28));
    [title setFont:[NSFont systemFontOfSize:20 weight:NSFontWeightSemibold]];
    progressLabel = label(@"Connecting to your Pop Agent…", NSMakeRect(36, 82, 428, 20));
    progressIndicator = [[NSProgressIndicator alloc] initWithFrame:NSMakeRect(36, 48, 428, 16)];
    [progressIndicator setIndeterminate:YES];
    [progressIndicator setStyle:NSProgressIndicatorStyleBar];
    [progressIndicator startAnimation:nil];
    [[progressWindow contentView] addSubview:title];
    [[progressWindow contentView] addSubview:progressLabel];
    [[progressWindow contentView] addSubview:progressIndicator];
    [title release];
    [progressWindow makeKeyAndOrderFront:nil];
}

void pop_setup_run_progress(void) {
    if (progressWindow != nil) [NSApp runModalForWindow:progressWindow];
}

void pop_setup_set_progress(const char *message) {
    NSString *value = [popSetupString(message) copy];
    dispatch_async(dispatch_get_main_queue(), ^{
        if (progressLabel != nil) [progressLabel setStringValue:value];
        [value release];
    });
}

void pop_setup_finish_progress(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        [NSApp stopModal];
        [progressIndicator stopAnimation:nil];
        [progressWindow orderOut:nil];
        [progressIndicator release];
        [progressLabel release];
        [progressWindow release];
        progressIndicator = nil;
        progressLabel = nil;
        progressWindow = nil;
    });
}

void pop_setup_show_error(const char *message) {
    prepareApplication();
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setAlertStyle:NSAlertStyleCritical];
    [alert setMessageText:@"Pop Desktop could not be installed"];
    [alert setInformativeText:popSetupString(message)];
    [alert addButtonWithTitle:@"Try Again"];
    [alert runModal];
    [alert release];
}

int pop_setup_show_success(void) {
    prepareApplication();
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setMessageText:@"Pop Desktop is ready"];
    [alert setInformativeText:@"Pop Desktop, Pop CLI, and private Node.js were installed for your account. Start at Login remains off until you enable it from the menu bar."];
    [alert addButtonWithTitle:@"Open Pop Desktop"];
    [alert addButtonWithTitle:@"Close"];
    NSModalResponse response = [alert runModal];
    [alert release];
    return response == NSAlertFirstButtonReturn ? 1 : 0;
}
