//go:build darwin

#import <Cocoa/Cocoa.h>
#import <pthread.h>

extern void popTrayOpenDesktop(void);
extern void popTrayCheckDesktop(void);
extern void popTrayInstallDesktop(void);
extern void popTrayCheckUpdates(void);
extern void popTrayCheckServer(void);
extern void popTrayCheckNode(void);
extern void popTrayCheckCLI(void);
extern void popTrayUpdateCLI(void);
extern void popTrayConfigureServer(void);
extern void popTrayDiagnostics(void);
extern void popTrayToggleStartAtLogin(void);
extern void popTrayQuit(void);

static NSString *stringFromUTF8(const char *value) {
    if (value == NULL) {
        return @"";
    }
    return [NSString stringWithUTF8String:value];
}

static NSStatusItem *popStatusItem;
static NSObject *popMenuTarget;
static NSMenuItem *popServerItem;
static NSMenuItem *popDesktopItem;
static NSMenuItem *popCLIItem;
static NSMenuItem *popNodeItem;
static NSMenuItem *popServerDetailStatusItem;
static NSMenuItem *popServerURLItem;
static NSMenuItem *popDesktopDetailStatusItem;
static NSMenuItem *popDesktopVersionItem;
static NSMenuItem *popDesktopPathItem;
static NSMenuItem *popCheckDesktopItem;
static NSMenuItem *popInstallDesktopItem;
static NSMenuItem *popCLIDetailStatusItem;
static NSMenuItem *popCLIVersionItem;
static NSMenuItem *popCLIPathItem;
static NSMenuItem *popCLINodePathItem;
static NSMenuItem *popCheckCLIItem;
static NSMenuItem *popUpdateCLIItem;
static NSMenuItem *popNodeDetailStatusItem;
static NSMenuItem *popNodeVersionItem;
static NSMenuItem *popNodePathItem;
static NSMenuItem *popCheckNodeItem;
static NSMenuItem *popCheckServerItem;
static NSMenuItem *popOpenDesktopItem;
static NSMenuItem *popCheckUpdatesItem;
static NSMenuItem *popConfigureServerItem;
static NSMenuItem *popDiagnosticsItem;
static NSMenuItem *popStartAtLoginItem;

@interface PopTrayTarget : NSObject
- (void)openDesktop:(id)sender;
- (void)checkDesktop:(id)sender;
- (void)installDesktop:(id)sender;
- (void)checkUpdates:(id)sender;
- (void)checkServer:(id)sender;
- (void)checkNode:(id)sender;
- (void)checkCLI:(id)sender;
- (void)updateCLI:(id)sender;
- (void)configureServer:(id)sender;
- (void)diagnostics:(id)sender;
- (void)toggleStartAtLogin:(id)sender;
- (void)quit:(id)sender;
@end

@implementation PopTrayTarget
- (void)openDesktop:(id)sender { popTrayOpenDesktop(); }
- (void)checkDesktop:(id)sender { popTrayCheckDesktop(); }
- (void)installDesktop:(id)sender { popTrayInstallDesktop(); }
- (void)checkUpdates:(id)sender { popTrayCheckUpdates(); }
- (void)checkServer:(id)sender {
    [NSApp activateIgnoringOtherApps:YES];
    popTrayCheckServer();
}
- (void)checkNode:(id)sender { popTrayCheckNode(); }
- (void)checkCLI:(id)sender { popTrayCheckCLI(); }
- (void)updateCLI:(id)sender { popTrayUpdateCLI(); }
- (void)configureServer:(id)sender {
    [NSApp activateIgnoringOtherApps:YES];
    popTrayConfigureServer();
}
- (void)diagnostics:(id)sender {
    [NSApp activateIgnoringOtherApps:YES];
    popTrayDiagnostics();
}
- (void)toggleStartAtLogin:(id)sender { popTrayToggleStartAtLogin(); }
- (void)quit:(id)sender { popTrayQuit(); }
@end

static NSMenuItem *headerItem(NSString *title) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
    NSDictionary *attributes = @{
        NSFontAttributeName: [NSFont boldSystemFontOfSize:[NSFont systemFontSize]],
        NSForegroundColorAttributeName: [NSColor labelColor]
    };
    NSAttributedString *styled = [[NSAttributedString alloc] initWithString:title attributes:attributes];
    [item setAttributedTitle:styled];
    [item setAccessibilityLabel:title];
    // Only unavailable actions are dimmed. The product heading is informative,
    // has no action or target, and remains fully legible.
    [item setEnabled:YES];
    [styled release];
    return [item autorelease];
}

static NSMenuItem *componentItem(NSString *title) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
    // Component rows own submenus, so they stay legible and receive AppKit's
    // native submenu arrow rather than pretending to be disabled labels.
    [item setEnabled:YES];
    return [item autorelease];
}

static NSMenuItem *detailItem(NSString *title) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
    [item setEnabled:YES];
    [item setAccessibilityLabel:title];
    return [item autorelease];
}

static NSColor *indicatorColor(int indicator) {
    switch (indicator) {
        case 1: return [NSColor systemGreenColor];
        case 2: return [NSColor systemYellowColor];
        case 3: return [NSColor systemRedColor];
        default: return [NSColor secondaryLabelColor];
    }
}

static void setComponentStatus(NSMenuItem *item, NSString *title, int indicator) {
    NSString *displayTitle = [@"●  " stringByAppendingString:title];
    NSMutableAttributedString *styled = [[NSMutableAttributedString alloc] initWithString:displayTitle];
    [styled addAttribute:NSForegroundColorAttributeName value:[NSColor labelColor]
                   range:NSMakeRange(0, [displayTitle length])];
    [styled addAttribute:NSForegroundColorAttributeName value:indicatorColor(indicator)
                   range:NSMakeRange(0, 1)];
    [item setTitle:title];
    [item setAttributedTitle:styled];
    [item setAccessibilityLabel:title];
    [styled release];
}

static NSMenuItem *actionItem(NSString *title, SEL action) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:@""];
    [item setTarget:popMenuTarget];
    return [item autorelease];
}

static void installTray(NSData *iconData) {
    if (popStatusItem != nil) {
        return;
    }

    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];

    popMenuTarget = [[PopTrayTarget alloc] init];
    popStatusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSSquareStatusItemLength];

    NSImage *image = [[NSImage alloc] initWithData:iconData];
    [image setSize:NSMakeSize(18.0, 18.0)];
    [image setTemplate:YES];
    [[popStatusItem button] setImage:image];
    [[popStatusItem button] setImagePosition:NSImageOnly];
    [[popStatusItem button] setToolTip:@"Pop Desktop"];
    [image release];

    NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Pop Desktop"];
    [menu setAutoenablesItems:NO];

    [menu addItem:headerItem(@"Pop Desktop")];
    [menu addItem:[NSMenuItem separatorItem]];
    popServerItem = componentItem(@"Server  ·  Not configured");
    popDesktopItem = componentItem(@"Desktop  ·  Not installed");
    popCLIItem = componentItem(@"CLI  ·  Checking");
    popNodeItem = componentItem(@"Node  ·  Checking");
    [menu addItem:popServerItem];
    [menu addItem:popDesktopItem];
    [menu addItem:popCLIItem];
    [menu addItem:popNodeItem];

    NSMenu *serverMenu = [[NSMenu alloc] initWithTitle:@"Server"];
    [serverMenu setAutoenablesItems:NO];
    [serverMenu addItem:headerItem(@"Server Details")];
    [serverMenu addItem:[NSMenuItem separatorItem]];
    popServerDetailStatusItem = detailItem(@"Status  ·  Not configured");
    popServerURLItem = detailItem(@"URL  ·  Not configured");
    [serverMenu addItem:popServerDetailStatusItem];
    [serverMenu addItem:popServerURLItem];
    [serverMenu addItem:[NSMenuItem separatorItem]];
    popCheckServerItem = actionItem(@"Check Connection", @selector(checkServer:));
    [popCheckServerItem setEnabled:NO];
    [serverMenu addItem:popCheckServerItem];
    popConfigureServerItem = actionItem(@"Configure Server…", @selector(configureServer:));
    [serverMenu addItem:popConfigureServerItem];
    [popServerItem setSubmenu:serverMenu];
    [serverMenu release];

    NSMenu *desktopMenu = [[NSMenu alloc] initWithTitle:@"Pop Desktop"];
    [desktopMenu setAutoenablesItems:NO];
    [desktopMenu addItem:headerItem(@"Pop Desktop Details")];
    [desktopMenu addItem:[NSMenuItem separatorItem]];
    popDesktopDetailStatusItem = detailItem(@"Status  ·  Running");
    popDesktopVersionItem = detailItem(@"Version  ·  Checking");
    popDesktopPathItem = detailItem(@"Path  ·  Checking");
    [desktopMenu addItem:popDesktopDetailStatusItem];
    [desktopMenu addItem:popDesktopVersionItem];
    [desktopMenu addItem:popDesktopPathItem];
    [desktopMenu addItem:[NSMenuItem separatorItem]];
    popOpenDesktopItem = actionItem(@"Open Pop Desktop", @selector(openDesktop:));
    [popOpenDesktopItem setEnabled:YES];
    [desktopMenu addItem:popOpenDesktopItem];
    [popDesktopItem setSubmenu:desktopMenu];
    [desktopMenu release];

    NSMenu *cliMenu = [[NSMenu alloc] initWithTitle:@"Pop CLI"];
    [cliMenu setAutoenablesItems:NO];
    [cliMenu addItem:headerItem(@"Pop CLI Details")];
    [cliMenu addItem:[NSMenuItem separatorItem]];
    popCLIDetailStatusItem = detailItem(@"Status  ·  Checking");
    popCLIVersionItem = detailItem(@"Version  ·  Checking");
    popCLIPathItem = detailItem(@"Path  ·  Searching common locations");
    popCLINodePathItem = detailItem(@"Node runtime  ·  Checking");
    [cliMenu addItem:popCLIDetailStatusItem];
    [cliMenu addItem:popCLIVersionItem];
    [cliMenu addItem:popCLIPathItem];
    [cliMenu addItem:popCLINodePathItem];
    [cliMenu addItem:[NSMenuItem separatorItem]];
    popCheckCLIItem = actionItem(@"Check Again", @selector(checkCLI:));
    [popCheckCLIItem setEnabled:NO];
    [cliMenu addItem:popCheckCLIItem];
    popUpdateCLIItem = actionItem(@"Update CLI…", @selector(updateCLI:));
    [popUpdateCLIItem setEnabled:NO];
    [cliMenu addItem:popUpdateCLIItem];
    [popCLIItem setSubmenu:cliMenu];
    [cliMenu release];

    NSMenu *nodeMenu = [[NSMenu alloc] initWithTitle:@"Node"];
    [nodeMenu setAutoenablesItems:NO];
    [nodeMenu addItem:headerItem(@"Node Details")];
    [nodeMenu addItem:[NSMenuItem separatorItem]];
    popNodeDetailStatusItem = detailItem(@"Status  ·  Checking");
    popNodeVersionItem = detailItem(@"Version  ·  Checking");
    popNodePathItem = detailItem(@"Path  ·  Searching common locations");
    [nodeMenu addItem:popNodeDetailStatusItem];
    [nodeMenu addItem:popNodeVersionItem];
    [nodeMenu addItem:popNodePathItem];
    [nodeMenu addItem:[NSMenuItem separatorItem]];
    popCheckNodeItem = actionItem(@"Check Again", @selector(checkNode:));
    [popCheckNodeItem setEnabled:NO];
    [nodeMenu addItem:popCheckNodeItem];
    [popNodeItem setSubmenu:nodeMenu];
    [nodeMenu release];

    [menu addItem:[NSMenuItem separatorItem]];
    popCheckUpdatesItem = actionItem(@"Check for Updates…", @selector(checkUpdates:));
    [popCheckUpdatesItem setEnabled:NO];
    [menu addItem:popCheckUpdatesItem];

    popDiagnosticsItem = actionItem(@"Diagnostics…", @selector(diagnostics:));
    [menu addItem:popDiagnosticsItem];

    popStartAtLoginItem = actionItem(@"Start at Login", @selector(toggleStartAtLogin:));
    [menu addItem:popStartAtLoginItem];

    [menu addItem:[NSMenuItem separatorItem]];
    NSMenuItem *quit = [[NSMenuItem alloc] initWithTitle:@"Quit Pop Desktop" action:@selector(quit:) keyEquivalent:@"q"];
    [quit setTarget:popMenuTarget];
    [menu addItem:quit];
    [quit release];

    [popStatusItem setMenu:menu];
    [menu release];
}

int pop_install_tray(const void *iconBytes, size_t iconLength) {
    NSData *data = [NSData dataWithBytes:iconBytes length:iconLength];
    if (pthread_main_np() != 0) {
        installTray(data);
    } else {
        dispatch_sync(dispatch_get_main_queue(), ^{ installTray(data); });
    }
    return popStatusItem != nil;
}

static void updateTray(NSString *server, NSString *serverDetail, NSString *serverURL, int serverIndicator,
                       NSString *desktop, NSString *desktopDetail, NSString *desktopVersion, NSString *desktopPath, int desktopIndicator,
                       NSString *cli, NSString *cliDetail, NSString *cliVersion, NSString *cliPath, NSString *cliNodePath, int cliIndicator,
                       NSString *node, NSString *nodeDetail, NSString *nodeVersion, NSString *nodePath, int nodeIndicator,
                       BOOL openDesktopEnabled, BOOL checkDesktopEnabled, BOOL installDesktopEnabled, NSString *desktopActionTitle,
                       BOOL checkUpdatesEnabled, BOOL checkServerEnabled, BOOL checkNodeEnabled, BOOL checkCLIEnabled, BOOL updateCLIEnabled, NSString *cliActionTitle, BOOL configureServerEnabled, BOOL startAtLogin,
                       BOOL startAtLoginEnabled) {
    setComponentStatus(popServerItem, server, serverIndicator);
    setComponentStatus(popDesktopItem, desktop, desktopIndicator);
    setComponentStatus(popCLIItem, cli, cliIndicator);
    setComponentStatus(popNodeItem, node, nodeIndicator);
    setComponentStatus(popServerDetailStatusItem,
                       [@"Status  ·  " stringByAppendingString:serverDetail], serverIndicator);
    setComponentStatus(popDesktopDetailStatusItem,
                       [@"Status  ·  " stringByAppendingString:desktopDetail], desktopIndicator);
    NSString *desktopVersionTitle = [@"Version  ·  " stringByAppendingString:desktopVersion];
    NSString *desktopPathTitle = [@"Path  ·  " stringByAppendingString:desktopPath];
    [popDesktopVersionItem setTitle:desktopVersionTitle];
    [popDesktopVersionItem setAccessibilityLabel:desktopVersionTitle];
    [popDesktopPathItem setTitle:desktopPathTitle];
    [popDesktopPathItem setAccessibilityLabel:desktopPathTitle];
    setComponentStatus(popCLIDetailStatusItem,
                       [@"Status  ·  " stringByAppendingString:cliDetail], cliIndicator);
    NSString *cliVersionTitle = [@"Version  ·  " stringByAppendingString:cliVersion];
    NSString *cliPathTitle = [@"Path  ·  " stringByAppendingString:cliPath];
    NSString *cliNodePathTitle = [@"Node runtime  ·  " stringByAppendingString:cliNodePath];
    [popCLIVersionItem setTitle:cliVersionTitle];
    [popCLIVersionItem setAccessibilityLabel:cliVersionTitle];
    [popCLIPathItem setTitle:cliPathTitle];
    [popCLIPathItem setAccessibilityLabel:cliPathTitle];
    [popCLINodePathItem setTitle:cliNodePathTitle];
    [popCLINodePathItem setAccessibilityLabel:cliNodePathTitle];
    setComponentStatus(popNodeDetailStatusItem,
                       [@"Status  ·  " stringByAppendingString:nodeDetail], nodeIndicator);
    NSString *nodeVersionTitle = [@"Version  ·  " stringByAppendingString:nodeVersion];
    NSString *nodePathTitle = [@"Path  ·  " stringByAppendingString:nodePath];
    [popNodeVersionItem setTitle:nodeVersionTitle];
    [popNodeVersionItem setAccessibilityLabel:nodeVersionTitle];
    [popNodePathItem setTitle:nodePathTitle];
    [popNodePathItem setAccessibilityLabel:nodePathTitle];
    NSString *urlTitle = serverURL.length == 0
        ? @"URL  ·  Not configured"
        : [@"URL  ·  " stringByAppendingString:serverURL];
    [popServerURLItem setTitle:urlTitle];
    [popServerURLItem setAccessibilityLabel:urlTitle];
    [popOpenDesktopItem setEnabled:openDesktopEnabled];
    [popCheckDesktopItem setEnabled:checkDesktopEnabled];
    [popInstallDesktopItem setTitle:desktopActionTitle.length == 0 ? @"Install Pop Desktop…" : desktopActionTitle];
    [popInstallDesktopItem setEnabled:installDesktopEnabled];
    [popCheckUpdatesItem setEnabled:checkUpdatesEnabled];
    [popCheckServerItem setEnabled:checkServerEnabled];
    [popCheckNodeItem setEnabled:checkNodeEnabled];
    [popCheckCLIItem setEnabled:checkCLIEnabled];
    [popUpdateCLIItem setTitle:cliActionTitle.length == 0 ? @"Update CLI…" : cliActionTitle];
    [popUpdateCLIItem setEnabled:updateCLIEnabled];
    [popConfigureServerItem setEnabled:configureServerEnabled];
    [popStartAtLoginItem setState:startAtLogin ? NSControlStateValueOn : NSControlStateValueOff];
    [popStartAtLoginItem setEnabled:startAtLoginEnabled];
}

void pop_update_tray(const char *server, const char *serverDetail, const char *serverURL, int serverIndicator,
                     const char *desktop, const char *desktopDetail, const char *desktopVersion, const char *desktopPath, int desktopIndicator,
                     const char *cli, const char *cliDetail, const char *cliVersion, const char *cliPath, const char *cliNodePath, int cliIndicator,
                     const char *node, const char *nodeDetail, const char *nodeVersion, const char *nodePath, int nodeIndicator,
                     int openDesktopEnabled, int checkDesktopEnabled, int installDesktopEnabled, const char *desktopActionTitle,
                     int checkUpdatesEnabled, int checkServerEnabled, int checkNodeEnabled, int checkCLIEnabled, int updateCLIEnabled, const char *cliActionTitle, int configureServerEnabled, int startAtLogin,
                     int startAtLoginEnabled) {
    if (popStatusItem == nil) {
        return;
    }
    NSString *serverTitle = stringFromUTF8(server);
    NSString *serverDetailTitle = stringFromUTF8(serverDetail);
    NSString *serverURLTitle = stringFromUTF8(serverURL);
    NSString *desktopTitle = stringFromUTF8(desktop);
    NSString *desktopDetailTitle = stringFromUTF8(desktopDetail);
    NSString *desktopVersionTitle = stringFromUTF8(desktopVersion);
    NSString *desktopPathTitle = stringFromUTF8(desktopPath);
    NSString *desktopAction = stringFromUTF8(desktopActionTitle);
    NSString *cliTitle = stringFromUTF8(cli);
    NSString *cliDetailTitle = stringFromUTF8(cliDetail);
    NSString *cliVersionTitle = stringFromUTF8(cliVersion);
    NSString *cliPathTitle = stringFromUTF8(cliPath);
    NSString *cliNodePathTitle = stringFromUTF8(cliNodePath);
    NSString *nodeTitle = stringFromUTF8(node);
    NSString *nodeDetailTitle = stringFromUTF8(nodeDetail);
    NSString *nodeVersionTitle = stringFromUTF8(nodeVersion);
    NSString *nodePathTitle = stringFromUTF8(nodePath);
    NSString *cliAction = stringFromUTF8(cliActionTitle);
    void (^update)(void) = ^{
        updateTray(serverTitle, serverDetailTitle, serverURLTitle, serverIndicator,
                   desktopTitle, desktopDetailTitle, desktopVersionTitle, desktopPathTitle, desktopIndicator,
                   cliTitle, cliDetailTitle, cliVersionTitle, cliPathTitle, cliNodePathTitle, cliIndicator,
                   nodeTitle, nodeDetailTitle, nodeVersionTitle, nodePathTitle, nodeIndicator,
                   openDesktopEnabled != 0, checkDesktopEnabled != 0, installDesktopEnabled != 0, desktopAction,
                   checkUpdatesEnabled != 0, checkServerEnabled != 0, checkNodeEnabled != 0, checkCLIEnabled != 0, updateCLIEnabled != 0, cliAction, configureServerEnabled != 0,
                   startAtLogin != 0, startAtLoginEnabled != 0);
    };
    if (pthread_main_np() != 0) {
        update();
    } else {
        dispatch_sync(dispatch_get_main_queue(), update);
    }
}

static void removeTray(void) {
    if (popStatusItem == nil) {
        return;
    }
    [[NSStatusBar systemStatusBar] removeStatusItem:popStatusItem];
    popStatusItem = nil;
    [popMenuTarget release];
    popMenuTarget = nil;
    popServerItem = nil;
    popDesktopItem = nil;
    popCLIItem = nil;
    popNodeItem = nil;
    popServerDetailStatusItem = nil;
    popServerURLItem = nil;
    popDesktopDetailStatusItem = nil;
    popDesktopVersionItem = nil;
    popDesktopPathItem = nil;
    popCheckDesktopItem = nil;
    popInstallDesktopItem = nil;
    popCLIDetailStatusItem = nil;
    popCLIVersionItem = nil;
    popCLIPathItem = nil;
    popCLINodePathItem = nil;
    popCheckCLIItem = nil;
    popUpdateCLIItem = nil;
    popNodeDetailStatusItem = nil;
    popNodeVersionItem = nil;
    popNodePathItem = nil;
    popCheckNodeItem = nil;
    popCheckServerItem = nil;
    popOpenDesktopItem = nil;
    popCheckUpdatesItem = nil;
    popConfigureServerItem = nil;
    popDiagnosticsItem = nil;
    popStartAtLoginItem = nil;
}

void pop_remove_tray(void) {
    if (pthread_main_np() != 0) {
        removeTray();
    } else {
        dispatch_sync(dispatch_get_main_queue(), ^{ removeTray(); });
    }
}

void pop_run_application(void) {
    [NSApp run];
}

static void stopApplication(void) {
    [NSApp stop:nil];
    NSEvent *event = [NSEvent otherEventWithType:NSEventTypeApplicationDefined
                                       location:NSZeroPoint
                                  modifierFlags:0
                                      timestamp:0
                                   windowNumber:0
                                        context:nil
                                        subtype:0
                                          data1:0
                                          data2:0];
    [NSApp postEvent:event atStart:NO];
}

void pop_stop_application(void) {
    if (pthread_main_np() != 0) {
        stopApplication();
    } else {
        dispatch_async(dispatch_get_main_queue(), ^{ stopApplication(); });
    }
}
