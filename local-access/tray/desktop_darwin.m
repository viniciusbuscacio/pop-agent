#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface PopDesktop : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler>
@property NSWindow *window;
@property WKWebView *web;
@property NSURL *origin;
@end
@implementation PopDesktop
- (BOOL)internalURL:(NSURL*)url {
 NSNumber *a = self.origin.port ?: @([self.origin.scheme isEqualToString:@"https"] ? 443 : 80);
 NSNumber *b = url.port ?: @([url.scheme isEqualToString:@"https"] ? 443 : 80);
 return url && !url.user && !url.password && [url.scheme.lowercaseString isEqual:self.origin.scheme.lowercaseString] && [url.host.lowercaseString isEqual:self.origin.host.lowercaseString] && [a isEqual:b];
}
- (BOOL)allowURL:(NSURL*)url {
 if ([self internalURL:url]) return YES;
 if (!url.user && !url.password && [url.scheme.lowercaseString isEqual:@"https"]) [[NSWorkspace sharedWorkspace] openURL:url];
 return NO;
}
- (void)webView:(WKWebView*)web decidePolicyForNavigationAction:(WKNavigationAction*)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
 handler([self allowURL:action.request.URL] ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (WKWebView*)webView:(WKWebView*)web createWebViewWithConfiguration:(WKWebViewConfiguration*)config forNavigationAction:(WKNavigationAction*)action windowFeatures:(WKWindowFeatures*)features {
 if ([self allowURL:action.request.URL]) [web loadRequest:action.request];
 return nil;
}
- (void)userContentController:(WKUserContentController*)controller didReceiveScriptMessage:(WKScriptMessage*)message {
 if (!message.frameInfo.mainFrame || ![self internalURL:message.frameInfo.request.URL] || ![message.body isKindOfClass:[NSString class]]) return;
 if ([message.body isEqual:@"pop-desktop-theme:dark"]) self.window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
 else if ([message.body isEqual:@"pop-desktop-theme:light"]) self.window.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication*)app { return NO; }
- (BOOL)applicationShouldHandleReopen:(NSApplication*)app hasVisibleWindows:(BOOL)visible {
 [self.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES]; return YES;
}
- (void)webView:(WKWebView*)web runJavaScriptAlertPanelWithMessage:(NSString*)message initiatedByFrame:(WKFrameInfo*)frame completionHandler:(void (^)(void))done {
 NSAlert *a=[NSAlert new];a.messageText=message;[a runModal];done();
}
- (void)webView:(WKWebView*)web runOpenPanelWithParameters:(WKOpenPanelParameters*)params initiatedByFrame:(WKFrameInfo*)frame completionHandler:(void (^)(NSArray<NSURL*>*))done {
 NSOpenPanel *panel=[NSOpenPanel openPanel];panel.allowsMultipleSelection=params.allowsMultipleSelection;
 [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse r){done(r==NSModalResponseOK ? panel.URLs : nil);}];
}
- (void)webView:(WKWebView*)web didFailProvisionalNavigation:(WKNavigation*)navigation withError:(NSError*)error {
 if (error.code==NSURLErrorCancelled) return;
 NSAlert *alert=[NSAlert new];alert.messageText=@"Could not connect to Pop Agent";alert.informativeText=@"Check your network, Tailscale and Pop Server, then retry.";
 [alert addButtonWithTitle:@"Retry"];[alert addButtonWithTitle:@"Cancel"];
 [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response){if(response==NSAlertFirstButtonReturn)[web loadRequest:[NSURLRequest requestWithURL:self.origin]];}];
}
@end
void popDesktopRun(const char *origin, const char *script) {
 @autoreleasepool {
  [NSApplication sharedApplication];
  // LaunchServices normally handles this; also protect direct executable launches.
  for (NSRunningApplication *app in [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.popagent.desktop"]) {
   if(app.processIdentifier != getpid() && [app.executableURL.path isEqual:NSBundle.mainBundle.executableURL.path]) { [app activateWithOptions:NSApplicationActivateIgnoringOtherApps];return; }
  }
  PopDesktop *delegate=[PopDesktop new];delegate.origin=[NSURL URLWithString:[NSString stringWithUTF8String:origin]];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];NSApp.delegate=delegate;
  NSMenu *menu=[NSMenu new]; NSMenuItem *appItem=[NSMenuItem new];[menu addItem:appItem];NSMenu *appMenu=[NSMenu new];appItem.submenu=appMenu;
  [appMenu addItemWithTitle:@"Quit Pop Agent Desktop" action:@selector(terminate:) keyEquivalent:@"q"];
  NSMenuItem *editItem=[NSMenuItem new];editItem.title=@"Edit";[menu addItem:editItem];NSMenu *edit=[NSMenu new];editItem.submenu=edit;
  [edit addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
  [edit addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
  [edit addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
  [edit addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
  [edit addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];NSApp.mainMenu=menu;
  delegate.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1180,780) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
  delegate.window.title=@"Pop Agent Desktop";delegate.window.minSize=NSMakeSize(720,520);delegate.window.releasedWhenClosed=NO;delegate.window.delegate=delegate;delegate.window.appearance=[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  WKWebViewConfiguration *config=[WKWebViewConfiguration new];
  [config.userContentController addScriptMessageHandler:delegate name:@"popTheme"];
  [config.userContentController addUserScript:[[WKUserScript alloc] initWithSource:[NSString stringWithUTF8String:script] injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
  delegate.web=[[WKWebView alloc] initWithFrame:delegate.window.contentView.bounds configuration:config];delegate.web.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;delegate.web.navigationDelegate=delegate;delegate.web.UIDelegate=delegate;
  delegate.window.contentView=delegate.web;[delegate.window center];[delegate.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
  [delegate.web loadRequest:[NSURLRequest requestWithURL:delegate.origin]];[NSApp run];
 }
}
