#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

extern void popDesktopBeginUpdate(char*);
void popDesktopUpdateStatus(const char*);
static WKWebView *updateWeb;
static NSString *const popDesktopZoomKey = @"PopDesktopPageZoom";

static CGFloat popBoundZoom(CGFloat zoom) {
 if (!isfinite(zoom)) return 1.0;
 return MIN(3.0, MAX(0.5, zoom));
}
static CGFloat popLoadZoom(NSUserDefaults *defaults) {
 id value = [defaults objectForKey:popDesktopZoomKey];
 return [value isKindOfClass:[NSNumber class]] ? popBoundZoom([value doubleValue]) : 1.0;
}
static void popStoreZoom(NSUserDefaults *defaults, CGFloat zoom) {
 [defaults setDouble:popBoundZoom(zoom) forKey:popDesktopZoomKey];
}

@interface PopDesktop : NSObject <NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate>
@property NSWindow *window;
@property WKWebView *web;
@property NSURL *origin;
@property NSMapTable<WKDownload*, NSURL*> *downloads;
@end
@implementation PopDesktop
- (void)popSetZoom:(CGFloat)zoom {
 self.web.pageZoom = popBoundZoom(zoom);
 popStoreZoom([NSUserDefaults standardUserDefaults], self.web.pageZoom);
}
- (void)popZoomIn:(id)sender { [self popSetZoom:self.web.pageZoom + 0.1]; }
- (void)popZoomOut:(id)sender { [self popSetZoom:self.web.pageZoom - 0.1]; }
- (void)popActualSize:(id)sender { [self popSetZoom:1.0]; }
- (BOOL)validateMenuItem:(NSMenuItem*)item {
 if (item.action == @selector(popZoomIn:)) return self.web.pageZoom < 2.999;
 if (item.action == @selector(popZoomOut:)) return self.web.pageZoom > 0.501;
 if (item.action == @selector(popActualSize:)) return fabs(self.web.pageZoom - 1.0) > 0.001;
 return YES;
}
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
 if (![self allowURL:action.request.URL]) { handler(WKNavigationActionPolicyCancel); return; }
 handler(action.shouldPerformDownload ? WKNavigationActionPolicyDownload : WKNavigationActionPolicyAllow);
}
- (void)webView:(WKWebView*)web decidePolicyForNavigationResponse:(WKNavigationResponse*)response decisionHandler:(void (^)(WKNavigationResponsePolicy))handler {
 if (![self internalURL:response.response.URL]) { handler(WKNavigationResponsePolicyCancel); return; }
 NSString *disposition = [response.response isKindOfClass:[NSHTTPURLResponse class]] ? [(NSHTTPURLResponse*)response.response valueForHTTPHeaderField:@"Content-Disposition"] : nil;
 BOOL attachment = [disposition.lowercaseString hasPrefix:@"attachment"];
 handler(attachment || !response.canShowMIMEType ? WKNavigationResponsePolicyDownload : WKNavigationResponsePolicyAllow);
}
- (void)webView:(WKWebView*)web navigationAction:(WKNavigationAction*)action didBecomeDownload:(WKDownload*)download { download.delegate = self; }
- (void)webView:(WKWebView*)web navigationResponse:(WKNavigationResponse*)response didBecomeDownload:(WKDownload*)download { download.delegate = self; }
- (NSURL*)downloadDirectory { return [[NSFileManager defaultManager] URLForDirectory:NSDownloadsDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:nil]; }
- (void)download:(WKDownload*)download decideDestinationUsingResponse:(NSURLResponse*)response suggestedFilename:(NSString*)suggestedFilename completionHandler:(void (^)(NSURL*))done {
 NSURL *directory = [self downloadDirectory];
 if (!directory) { done(nil); return; }
 NSString *name = suggestedFilename.lastPathComponent;
 if (!name.length || [name isEqual:@"."] || [name isEqual:@".."]) name = @"Download";
 NSURL *destination = [directory URLByAppendingPathComponent:name];
 // WebKit requires a nonexistent destination. Preserve earlier downloads.
 for (NSUInteger index = 1; [[NSFileManager defaultManager] fileExistsAtPath:destination.path]; index++) {
  NSString *stem = name.stringByDeletingPathExtension;
  NSString *unique = [NSString stringWithFormat:@"%@ (%lu)", stem, (unsigned long)index];
  if (name.pathExtension.length) unique = [unique stringByAppendingPathExtension:name.pathExtension];
  destination = [directory URLByAppendingPathComponent:unique];
 }
 if (!self.downloads) self.downloads = [NSMapTable strongToStrongObjectsMapTable];
 [self.downloads setObject:destination forKey:download];
 done(destination);
}
- (void)downloadDidFinish:(WKDownload*)download {
 NSURL *destination = [self.downloads objectForKey:download];
 [self.downloads removeObjectForKey:download];
 if (destination) [[NSWorkspace sharedWorkspace] activateFileViewerSelectingURLs:@[destination]];
}
- (void)download:(WKDownload*)download didFailWithError:(NSError*)error resumeData:(NSData*)resumeData {
 [self.downloads removeObjectForKey:download];
 if (error.code == NSURLErrorCancelled) return;
 NSAlert *alert = [NSAlert new]; alert.messageText = @"Download failed";
 alert.informativeText = @"The file could not be downloaded. Check your connection and try the download again.";
 [alert beginSheetModalForWindow:self.window completionHandler:nil];
}
- (void)download:(WKDownload*)download willPerformHTTPRedirection:(NSHTTPURLResponse*)response newRequest:(NSURLRequest*)request decisionHandler:(void (^)(WKDownloadRedirectPolicy))handler {
 handler([self internalURL:request.URL] ? WKDownloadRedirectPolicyAllow : WKDownloadRedirectPolicyCancel);
}
- (WKWebView*)webView:(WKWebView*)web createWebViewWithConfiguration:(WKWebViewConfiguration*)config forNavigationAction:(WKNavigationAction*)action windowFeatures:(WKWindowFeatures*)features {
 if ([self allowURL:action.request.URL]) [web loadRequest:action.request];
 return nil;
}
- (void)userContentController:(WKUserContentController*)controller didReceiveScriptMessage:(WKScriptMessage*)message {
 if (!message.frameInfo.mainFrame || ![self internalURL:message.frameInfo.request.URL] || ![message.body isKindOfClass:[NSString class]]) return;
 if ([message.name isEqual:@"popUpdate"] && [message.body isEqual:@"update"]) {
  [self.web evaluateJavaScript:@"location.href" completionHandler:^(id value, NSError *error) {
   if (error || ![value isKindOfClass:[NSString class]] || ![self internalURL:[NSURL URLWithString:value]]) { popDesktopUpdateStatus("error"); return; }
   popDesktopBeginUpdate((char*)[(NSString*)value UTF8String]);
  }];
  return;
 }
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
- (void)webView:(WKWebView*)web runJavaScriptConfirmPanelWithMessage:(NSString*)message initiatedByFrame:(WKFrameInfo*)frame completionHandler:(void (^)(BOOL))done {
 if (![self internalURL:frame.request.URL]) { done(NO); return; }
 NSAlert *alert = [NSAlert new];
 alert.messageText = @"Pop Agent";
 alert.informativeText = message;
 [alert addButtonWithTitle:@"OK"];
 [alert addButtonWithTitle:@"Cancel"];
 [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response) {
  done(response == NSAlertFirstButtonReturn);
 }];
}
- (void)webView:(WKWebView*)web runOpenPanelWithParameters:(WKOpenPanelParameters*)params initiatedByFrame:(WKFrameInfo*)frame completionHandler:(void (^)(NSArray<NSURL*>*))done {
 NSOpenPanel *panel=[NSOpenPanel openPanel];panel.allowsMultipleSelection=params.allowsMultipleSelection;
 [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse r){done(r==NSModalResponseOK ? panel.URLs : nil);}];
}
- (void)webView:(WKWebView*)web didFailProvisionalNavigation:(WKNavigation*)navigation withError:(NSError*)error {
 // Converting a navigation to a download interrupts the frame by design.
 if (error.code==NSURLErrorCancelled || ([error.domain isEqual:WebKitErrorDomain] && error.code==WebKitErrorFrameLoadInterruptedByPolicyChange)) return;
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
  [edit addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
  NSMenuItem *viewItem=[NSMenuItem new];viewItem.title=@"View";[menu addItem:viewItem];
  NSMenu *view=[NSMenu new];viewItem.submenu=view;
  NSMenuItem *zoomIn=[view addItemWithTitle:@"Zoom In" action:@selector(popZoomIn:) keyEquivalent:@"+"];zoomIn.target=delegate;
  NSMenuItem *zoomEqual=[view addItemWithTitle:@"Zoom In" action:@selector(popZoomIn:) keyEquivalent:@"="];zoomEqual.target=delegate;zoomEqual.hidden=YES;zoomEqual.allowsKeyEquivalentWhenHidden=YES;
  NSMenuItem *zoomOut=[view addItemWithTitle:@"Zoom Out" action:@selector(popZoomOut:) keyEquivalent:@"-"];zoomOut.target=delegate;
  NSMenuItem *actual=[view addItemWithTitle:@"Actual Size" action:@selector(popActualSize:) keyEquivalent:@"0"];actual.target=delegate;
  NSApp.mainMenu=menu;
  delegate.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1180,780) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
  delegate.window.title=@"Pop Agent Desktop";delegate.window.minSize=NSMakeSize(720,520);delegate.window.releasedWhenClosed=NO;delegate.window.delegate=delegate;delegate.window.appearance=[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  WKWebViewConfiguration *config=[WKWebViewConfiguration new];
  [config.userContentController addScriptMessageHandler:delegate name:@"popTheme"];
  [config.userContentController addScriptMessageHandler:delegate name:@"popUpdate"];
  [config.userContentController addUserScript:[[WKUserScript alloc] initWithSource:[NSString stringWithUTF8String:script] injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
  delegate.web=[[WKWebView alloc] initWithFrame:delegate.window.contentView.bounds configuration:config];delegate.web.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;delegate.web.navigationDelegate=delegate;delegate.web.UIDelegate=delegate;
  delegate.web.pageZoom=popLoadZoom([NSUserDefaults standardUserDefaults]);
  updateWeb = delegate.web;
  const char *ready = getenv("POP_DESKTOP_UPDATE_READY");
  if (ready) [@"ready" writeToFile:[NSString stringWithUTF8String:ready] atomically:YES encoding:NSUTF8StringEncoding error:nil];
  delegate.window.contentView=delegate.web;[delegate.window center];[delegate.window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
  [delegate.web loadRequest:[NSURLRequest requestWithURL:delegate.origin]];
  // WKWebView may consume standard browser key equivalents before the menu.
  id zoomKeys = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent*(NSEvent *event) {
   if (NSApp.keyWindow != delegate.window || !(event.modifierFlags & NSEventModifierFlagCommand) || (event.modifierFlags & (NSEventModifierFlagControl | NSEventModifierFlagOption))) return event;
   NSString *key = event.charactersIgnoringModifiers;
   if ([key isEqual:@"+"] || [key isEqual:@"="]) { [delegate popZoomIn:nil]; return nil; }
   if ([key isEqual:@"-"]) { [delegate popZoomOut:nil]; return nil; }
   if ([key isEqual:@"0"]) { [delegate popActualSize:nil]; return nil; }
   return event;
  }];
  [NSApp run];
  [NSEvent removeMonitor:zoomKeys];
 }
}

void popDesktopUpdateStatus(const char *status) {
 NSString *value = [NSString stringWithUTF8String:status];
 dispatch_async(dispatch_get_main_queue(), ^{
  NSData *data = [NSJSONSerialization dataWithJSONObject:@[value] options:0 error:nil];
  NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  [updateWeb evaluateJavaScript:[NSString stringWithFormat:@"window.dispatchEvent(new CustomEvent('pop-desktop-update', {detail: %@[0]}))",json] completionHandler:nil];
 });
}
void popDesktopQuitForUpdate(void) {
 dispatch_async(dispatch_get_main_queue(), ^{ [NSApp terminate:nil]; });
}
