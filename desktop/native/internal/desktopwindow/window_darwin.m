//go:build darwin

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <math.h>

extern void popDesktopSessionChanged(char *token);

static NSString *const PopDesktopPageZoomDefaultsKey = @"PopDesktopPageZoom";
static NSString *const PopDesktopSessionHandlerName = @"popSession";
static const CGFloat PopDesktopMinimumPageZoom = 0.5;
static const CGFloat PopDesktopMaximumPageZoom = 2.0;
static const CGFloat PopDesktopPageZoomStep = 0.1;

typedef NS_ENUM(NSInteger, PopDesktopNavigationDisposition) {
    PopDesktopNavigationBlocked = 0,
    PopDesktopNavigationInternal = 1,
    PopDesktopNavigationExternal = 2,
};

static NSString *popString(const char *value) {
    if (value == NULL) return @"";
    return [NSString stringWithUTF8String:value];
}

static NSNumber *effectivePort(NSURL *url) {
    if (url.port != nil) return url.port;
    NSString *scheme = url.scheme.lowercaseString;
    if ([scheme isEqualToString:@"https"]) return @443;
    if ([scheme isEqualToString:@"http"]) return @80;
    return nil;
}

static BOOL hasSameOrigin(NSURL *candidate, NSURL *server) {
    if (candidate == nil || server == nil || candidate.scheme.length == 0 || candidate.host.length == 0) return NO;
    BOOL sameScheme = [candidate.scheme caseInsensitiveCompare:server.scheme] == NSOrderedSame;
    BOOL sameHost = [candidate.host caseInsensitiveCompare:server.host] == NSOrderedSame;
    return sameScheme && sameHost && [effectivePort(candidate) isEqualToNumber:effectivePort(server)];
}

static PopDesktopNavigationDisposition navigationDisposition(NSURL *candidate, NSURL *server) {
    if (hasSameOrigin(candidate, server)) return PopDesktopNavigationInternal;
    NSString *scheme = candidate.scheme.lowercaseString;
    if ([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"] ||
        [scheme isEqualToString:@"mailto"] || [scheme isEqualToString:@"tel"]) {
        return PopDesktopNavigationExternal;
    }
    return PopDesktopNavigationBlocked;
}

int pop_desktop_navigation_disposition_for_testing(const char *serverURL, const char *candidateURL) {
    NSURL *server = [NSURL URLWithString:popString(serverURL)];
    NSURL *candidate = [NSURL URLWithString:popString(candidateURL)];
    return (int)navigationDisposition(candidate, server);
}

int pop_desktop_session_origin_allowed_for_testing(const char *serverURL, const char *frameURL, int isMainFrame) {
    if (!isMainFrame) return 0;
    return hasSameOrigin([NSURL URLWithString:popString(frameURL)], [NSURL URLWithString:popString(serverURL)]) ? 1 : 0;
}

static NSString *uniqueDownloadPath(NSString *suggestedName) {
    NSURL *downloads = [[[NSFileManager defaultManager] URLsForDirectory:NSDownloadsDirectory
                                                               inDomains:NSUserDomainMask] firstObject];
    NSString *name = suggestedName.length == 0 ? @"download" : suggestedName.lastPathComponent;
    NSString *path = [[downloads path] stringByAppendingPathComponent:name];
    NSString *base = [name stringByDeletingPathExtension];
    NSString *extension = [name pathExtension];
    NSInteger suffix = 2;
    while ([[NSFileManager defaultManager] fileExistsAtPath:path]) {
        NSString *candidate = extension.length == 0
            ? [NSString stringWithFormat:@"%@ %ld", base, (long)suffix]
            : [NSString stringWithFormat:@"%@ %ld.%@", base, (long)suffix, extension];
        path = [[downloads path] stringByAppendingPathComponent:candidate];
        suffix += 1;
    }
    return path;
}

@interface PopDesktopDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler>
@property(nonatomic, retain) NSWindow *window;
@property(nonatomic, retain) WKWebView *webView;
@property(nonatomic, copy) NSString *serverURL;
@property(nonatomic, copy) NSString *initialToken;
@property(nonatomic) CGFloat pageZoom;
@property(nonatomic) NSTimeInterval lastWheelZoomTime;
@property(nonatomic) NSInteger lastWheelZoomDirection;
- (id)initWithServerURL:(NSString *)serverURL initialToken:(NSString *)initialToken;
- (void)showWindow;
- (void)zoomIn:(id)sender;
- (void)zoomOut:(id)sender;
- (void)resetZoom:(id)sender;
- (PopDesktopNavigationDisposition)dispositionForURL:(NSURL *)url;
- (void)openExternalURL:(NSURL *)url;
- (void)detachSessionBridge;
@end

@implementation PopDesktopDelegate
- (id)initWithServerURL:(NSString *)serverURL initialToken:(NSString *)initialToken {
    self = [super init];
    if (self) {
        self.serverURL = serverURL;
        self.initialToken = initialToken;
    }
    return self;
}

- (void)dealloc {
    [NSObject cancelPreviousPerformRequestsWithTarget:self
                                             selector:@selector(persistPageZoom)
                                               object:nil];
    [self detachSessionBridge];
    self.webView = nil;
    self.window = nil;
    self.serverURL = nil;
    self.initialToken = nil;
    [super dealloc];
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    if (self.serverURL.length > 0) [self showWindow];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    (void)sender;
    // Desktop and its internal Tray helper share one lifecycle: closing the
    // last Desktop window terminates Desktop, which closes the Tray pipe.
    return YES;
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible {
    (void)sender;
    if (!visible) [self showWindow];
    return YES;
}

- (void)showWindow {
    if (self.window == nil) {
        NSRect frame = NSMakeRect(0, 0, 1180, 780);
        NSUInteger style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
            NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
        NSWindow *window = [[NSWindow alloc] initWithContentRect:frame
                                                      styleMask:style
                                                        backing:NSBackingStoreBuffered
                                                          defer:NO];
        [window setTitle:@"Pop Desktop"];
        [window setMinSize:NSMakeSize(720, 520)];
        [window setReleasedWhenClosed:NO];
        [window setDelegate:self];
        [window center];

        WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
        [configuration setWebsiteDataStore:[WKWebsiteDataStore defaultDataStore]];
        NSString *version = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"CFBundleShortVersionString"];
        [configuration setApplicationNameForUserAgent:[@"PopDesktop/" stringByAppendingString:version ?: @"0"]];
        [[configuration userContentController] addScriptMessageHandler:self name:PopDesktopSessionHandlerName];
        if (self.initialToken.length > 0) {
            NSData *tokenJSON = [NSJSONSerialization dataWithJSONObject:self.initialToken
                                                                 options:NSJSONWritingFragmentsAllowed
                                                                   error:nil];
            NSString *quotedToken = [[[NSString alloc] initWithData:tokenJSON encoding:NSUTF8StringEncoding] autorelease];
            NSString *source = [NSString stringWithFormat:
                @"try { localStorage.setItem('pop-agent.persist', '1'); localStorage.setItem('pop-agent.token', %@); } catch (_) {}",
                quotedToken];
            WKUserScript *script = [[WKUserScript alloc] initWithSource:source
                                                          injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                                       forMainFrameOnly:YES];
            [[configuration userContentController] addUserScript:script];
            [script release];
            self.initialToken = nil;
        }
        [[configuration preferences] setJavaScriptCanOpenWindowsAutomatically:YES];
        WKWebView *webView = [[WKWebView alloc] initWithFrame:[[window contentView] bounds]
                                               configuration:configuration];
        [configuration release];
        [webView setAutoresizingMask:NSViewWidthSizable | NSViewHeightSizable];
        [webView setNavigationDelegate:self];
        [webView setUIDelegate:self];
        [[window contentView] addSubview:webView];
        self.window = window;
        self.webView = webView;

        NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
        CGFloat savedZoom = [defaults objectForKey:PopDesktopPageZoomDefaultsKey] == nil
            ? 1.0
            : [defaults doubleForKey:PopDesktopPageZoomDefaultsKey];
        self.pageZoom = MIN(PopDesktopMaximumPageZoom, MAX(PopDesktopMinimumPageZoom, savedZoom));
        [webView setPageZoom:self.pageZoom];
        [webView release];
        [window release];
    }

    NSURL *url = [NSURL URLWithString:self.serverURL];
    if (url != nil && url.scheme.length > 0 && self.webView.URL == nil) {
        [self.webView loadRequest:[NSURLRequest requestWithURL:url]];
    }
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (void)setPageZoomAndSchedulePersistence:(CGFloat)pageZoom {
    CGFloat clamped = MIN(PopDesktopMaximumPageZoom, MAX(PopDesktopMinimumPageZoom, pageZoom));
    CGFloat rounded = round(clamped / PopDesktopPageZoomStep) * PopDesktopPageZoomStep;
    self.pageZoom = rounded;
    [self.webView setPageZoom:rounded];
    [NSObject cancelPreviousPerformRequestsWithTarget:self
                                             selector:@selector(persistPageZoom)
                                               object:nil];
    [self performSelector:@selector(persistPageZoom) withObject:nil afterDelay:0.25];
}

- (void)persistPageZoom {
    [[NSUserDefaults standardUserDefaults] setDouble:self.pageZoom forKey:PopDesktopPageZoomDefaultsKey];
}

- (void)zoomIn:(id)sender {
    (void)sender;
    [self setPageZoomAndSchedulePersistence:self.pageZoom + PopDesktopPageZoomStep];
}

- (void)zoomOut:(id)sender {
    (void)sender;
    [self setPageZoomAndSchedulePersistence:self.pageZoom - PopDesktopPageZoomStep];
}

- (void)resetZoom:(id)sender {
    (void)sender;
    [self setPageZoomAndSchedulePersistence:1.0];
}

- (BOOL)handleZoomKeyEvent:(NSEvent *)event {
    NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
    BOOL hasZoomModifier = (flags & (NSEventModifierFlagControl | NSEventModifierFlagCommand)) != 0;
    if (!hasZoomModifier || (flags & NSEventModifierFlagOption) != 0) return NO;

    NSString *characters = event.charactersIgnoringModifiers.lowercaseString;
    if ([characters isEqualToString:@"+"] || [characters isEqualToString:@"="]) {
        [self zoomIn:nil];
        return YES;
    }
    if ([characters isEqualToString:@"-"]) {
        [self zoomOut:nil];
        return YES;
    }
    if ([characters isEqualToString:@"0"]) {
        [self resetZoom:nil];
        return YES;
    }
    return NO;
}

- (PopDesktopNavigationDisposition)dispositionForURL:(NSURL *)url {
    return navigationDisposition(url, [NSURL URLWithString:self.serverURL]);
}

- (void)openExternalURL:(NSURL *)url {
    if (url != nil) [[NSWorkspace sharedWorkspace] openURL:url];
}

- (void)detachSessionBridge {
    if (self.webView != nil) {
        [[self.webView configuration].userContentController removeScriptMessageHandlerForName:PopDesktopSessionHandlerName];
    }
}

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    (void)userContentController;
    if (![message.name isEqualToString:PopDesktopSessionHandlerName] || !message.frameInfo.isMainFrame) return;
    if (!hasSameOrigin(message.frameInfo.request.URL, [NSURL URLWithString:self.serverURL])) return;
    if (![message.body isKindOfClass:[NSDictionary class]]) return;
    NSDictionary *body = (NSDictionary *)message.body;
    if (![body[@"kind"] isEqualToString:@"session"] || ![body[@"token"] isKindOfClass:[NSString class]]) return;
    NSString *token = body[@"token"];
    if ([token lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 12 * 1024) return;
    popDesktopSessionChanged((char *)token.UTF8String);
}

- (BOOL)handleZoomScrollEvent:(NSEvent *)event {
    NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
    if ((flags & NSEventModifierFlagControl) == 0 ||
        (flags & (NSEventModifierFlagCommand | NSEventModifierFlagOption)) != 0) {
        return NO;
    }

    CGFloat delta = event.scrollingDeltaY;
    if (delta == 0) return YES;
    NSInteger direction = delta > 0 ? 1 : -1;
    NSTimeInterval now = event.timestamp;
    if (direction == self.lastWheelZoomDirection && now - self.lastWheelZoomTime < 0.08) return YES;
    self.lastWheelZoomDirection = direction;
    self.lastWheelZoomTime = now;
    if (direction > 0) {
        [self zoomIn:nil];
    } else {
        [self zoomOut:nil];
    }
    return YES;
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
                    decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    (void)webView;
    if (navigationAction.shouldPerformDownload) {
        decisionHandler(WKNavigationActionPolicyDownload);
        return;
    }
    BOOL isMainFrame = navigationAction.targetFrame == nil || navigationAction.targetFrame.isMainFrame;
    if (!isMainFrame) {
        decisionHandler(WKNavigationActionPolicyAllow);
        return;
    }
    NSURL *url = navigationAction.request.URL;
    PopDesktopNavigationDisposition disposition = [self dispositionForURL:url];
    if (disposition == PopDesktopNavigationInternal) {
        decisionHandler(WKNavigationActionPolicyAllow);
        return;
    }
    if (disposition == PopDesktopNavigationExternal) [self openExternalURL:url];
    decisionHandler(WKNavigationActionPolicyCancel);
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationResponse:(WKNavigationResponse *)navigationResponse
                    decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler {
    (void)webView;
    if (!navigationResponse.canShowMIMEType) {
        decisionHandler(WKNavigationResponsePolicyDownload);
        return;
    }
    if (!navigationResponse.isForMainFrame) {
        decisionHandler(WKNavigationResponsePolicyAllow);
        return;
    }
    NSURL *url = navigationResponse.response.URL;
    PopDesktopNavigationDisposition disposition = [self dispositionForURL:url];
    if (disposition == PopDesktopNavigationInternal) {
        decisionHandler(WKNavigationResponsePolicyAllow);
        return;
    }
    if (disposition == PopDesktopNavigationExternal) [self openExternalURL:url];
    decisionHandler(WKNavigationResponsePolicyCancel);
}

- (void)webView:(WKWebView *)webView
    runJavaScriptConfirmPanelWithMessage:(NSString *)message
                        initiatedByFrame:(WKFrameInfo *)frame
                       completionHandler:(void (^)(BOOL result))completionHandler {
    (void)webView;
    (void)frame;
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setAlertStyle:NSAlertStyleWarning];
    [alert setMessageText:message];
    [alert addButtonWithTitle:@"OK"];
    [alert addButtonWithTitle:@"Cancel"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response) {
        completionHandler(response == NSAlertFirstButtonReturn);
        [alert release];
    }];
}

- (WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
               forNavigationAction:(WKNavigationAction *)navigationAction
                    windowFeatures:(WKWindowFeatures *)windowFeatures {
    (void)configuration;
    (void)windowFeatures;
    NSURL *url = navigationAction.request.URL;
    PopDesktopNavigationDisposition disposition = [self dispositionForURL:url];
    if (disposition == PopDesktopNavigationInternal) {
        [webView loadRequest:navigationAction.request];
    } else if (disposition == PopDesktopNavigationExternal) {
        [self openExternalURL:url];
    }
    return nil;
}

- (void)webView:(WKWebView *)webView
    navigationAction:(WKNavigationAction *)navigationAction
    didBecomeDownload:(WKDownload *)download {
    (void)webView;
    (void)navigationAction;
    [download setDelegate:self];
}

- (void)webView:(WKWebView *)webView
    navigationResponse:(WKNavigationResponse *)navigationResponse
    didBecomeDownload:(WKDownload *)download {
    (void)webView;
    (void)navigationResponse;
    [download setDelegate:self];
}

- (void)download:(WKDownload *)download
    decideDestinationUsingResponse:(NSURLResponse *)response
                 suggestedFilename:(NSString *)suggestedFilename
                 completionHandler:(void (^)(NSURL *destination))completionHandler {
    (void)download;
    (void)response;
    completionHandler([NSURL fileURLWithPath:uniqueDownloadPath(suggestedFilename)]);
}

- (void)webView:(WKWebView *)webView
    requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin
                         initiatedByFrame:(WKFrameInfo *)frame
                                    type:(WKMediaCaptureType)type
                         decisionHandler:(void (^)(WKPermissionDecision decision))decisionHandler API_AVAILABLE(macos(12.0)) {
    (void)webView;
    (void)origin;
    (void)frame;
    (void)type;
    decisionHandler(WKPermissionDecisionPrompt);
}
@end

static PopDesktopDelegate *popDesktopDelegate;
static id popDesktopZoomMonitor;

static void installMenus(PopDesktopDelegate *delegate) {
    NSMenu *mainMenu = [[NSMenu alloc] initWithTitle:@""];

    NSMenuItem *appRoot = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Pop Desktop"];
    [appMenu addItemWithTitle:@"About Pop Desktop" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"Quit Pop Desktop" action:@selector(terminate:) keyEquivalent:@"q"];
    [appRoot setSubmenu:appMenu];
    [mainMenu addItem:appRoot];
    [appMenu release];
    [appRoot release];

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

    NSMenuItem *viewRoot = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
    NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"View"];
    NSMenuItem *zoomIn = [viewMenu addItemWithTitle:@"Zoom In" action:@selector(zoomIn:) keyEquivalent:@"+"];
    [zoomIn setTarget:delegate];
    NSMenuItem *zoomOut = [viewMenu addItemWithTitle:@"Zoom Out" action:@selector(zoomOut:) keyEquivalent:@"-"];
    [zoomOut setTarget:delegate];
    NSMenuItem *resetZoom = [viewMenu addItemWithTitle:@"Actual Size" action:@selector(resetZoom:) keyEquivalent:@"0"];
    [resetZoom setTarget:delegate];
    [viewRoot setSubmenu:viewMenu];
    [mainMenu addItem:viewRoot];
    [viewMenu release];
    [viewRoot release];

    [NSApp setMainMenu:mainMenu];
    [mainMenu release];
}

static void installDesktop(NSString *serverURL, NSString *initialToken) {
    if (popDesktopDelegate != nil) {
        popDesktopDelegate.serverURL = serverURL;
        return;
    }
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    popDesktopDelegate = [[PopDesktopDelegate alloc] initWithServerURL:serverURL initialToken:initialToken];
    installMenus(popDesktopDelegate);
    [NSApp setDelegate:popDesktopDelegate];
    popDesktopZoomMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:(NSEventMaskKeyDown | NSEventMaskScrollWheel)
                                                                   handler:^NSEvent *(NSEvent *event) {
        if ([NSApp keyWindow] != popDesktopDelegate.window) return event;
        if (event.type == NSEventTypeKeyDown && [popDesktopDelegate handleZoomKeyEvent:event]) return nil;
        if (event.type == NSEventTypeScrollWheel && [popDesktopDelegate handleZoomScrollEvent:event]) return nil;
        return event;
    }];
}

int pop_desktop_install(const char *serverURL, const char *initialToken) {
    NSString *value = popString(serverURL);
    NSString *token = popString(initialToken);
    if ([NSThread isMainThread]) {
        installDesktop(value, token);
    } else {
        dispatch_sync(dispatch_get_main_queue(), ^{ installDesktop(value, token); });
    }
    return popDesktopDelegate != nil;
}

static void setDesktopServerURL(NSString *serverURL) {
    if (popDesktopDelegate == nil) return;
    if ([popDesktopDelegate.serverURL isEqualToString:serverURL]) return;
    popDesktopDelegate.serverURL = serverURL;
    NSURL *url = [NSURL URLWithString:serverURL];
    if (url != nil && url.scheme.length > 0 && popDesktopDelegate.webView != nil) {
        [popDesktopDelegate.webView loadRequest:[NSURLRequest requestWithURL:url]];
    }
}

void pop_desktop_set_server_url(const char *serverURL) {
    NSString *value = popString(serverURL);
    if ([NSThread isMainThread]) {
        setDesktopServerURL(value);
    } else {
        dispatch_async(dispatch_get_main_queue(), ^{ setDesktopServerURL(value); });
    }
}

void pop_desktop_show(void) {
    if ([NSThread isMainThread]) {
        [popDesktopDelegate showWindow];
    } else {
        dispatch_async(dispatch_get_main_queue(), ^{ [popDesktopDelegate showWindow]; });
    }
}

void pop_desktop_run(void) {
    [NSApp run];
}

static void stopDesktop(void) {
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

void pop_desktop_stop(void) {
    if ([NSThread isMainThread]) {
        stopDesktop();
    } else {
        dispatch_async(dispatch_get_main_queue(), ^{ stopDesktop(); });
    }
}

static void removeDesktop(void) {
    if (popDesktopZoomMonitor != nil) {
        [NSEvent removeMonitor:popDesktopZoomMonitor];
        popDesktopZoomMonitor = nil;
    }
    [popDesktopDelegate detachSessionBridge];
    if ([NSApp delegate] == popDesktopDelegate) [NSApp setDelegate:nil];
    [popDesktopDelegate release];
    popDesktopDelegate = nil;
}

void pop_desktop_remove(void) {
    if ([NSThread isMainThread]) {
        removeDesktop();
    } else {
        dispatch_sync(dispatch_get_main_queue(), ^{ removeDesktop(); });
    }
}

int pop_desktop_terminates_after_last_window_for_testing(void) {
    PopDesktopDelegate *delegate = [[PopDesktopDelegate alloc] initWithServerURL:@"https://pop.invalid" initialToken:@""];
    BOOL terminates = [delegate applicationShouldTerminateAfterLastWindowClosed:[NSApplication sharedApplication]];
    [delegate release];
    return terminates ? 1 : 0;
}

void pop_desktop_show_fatal(const char *message) {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [NSApp activateIgnoringOtherApps:YES];
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setMessageText:@"Pop Desktop could not open"];
    [alert setInformativeText:popString(message)];
    [alert addButtonWithTitle:@"OK"];
    [alert runModal];
    [alert release];
}
