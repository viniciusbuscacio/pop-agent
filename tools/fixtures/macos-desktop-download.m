#import "../../local-access/tray/desktop_darwin.m"
void popDesktopBeginUpdate(char *url) { }

@interface DownloadProbe : PopDesktop
@property NSURL *output;
@property NSUInteger completed;
@end
@implementation DownloadProbe
- (NSURL*)downloadDirectory { return self.output; }
- (void)webView:(WKWebView*)web didFinishNavigation:(WKNavigation*)navigation {
 [web evaluateJavaScript:@"document.querySelector('a').click()" completionHandler:nil];
}
- (void)downloadDidFinish:(WKDownload*)download {
 NSURL *file = [self.downloads objectForKey:download];
 NSData *data = [NSData dataWithContentsOfURL:file];
 NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
 if (![text isEqual:@"download-fixture"]) { fprintf(stderr,"Bad bytes: %s\n",text.UTF8String);exit(2); }
 [self.downloads removeObjectForKey:download];
 [self.web evaluateJavaScript:@"location.pathname === '/' && !!document.querySelector('a')" completionHandler:^(id result, NSError *error) {
 if (error || ![result boolValue]) { fprintf(stderr,"Page was replaced\n");exit(2); }
 self.completed++;
 if (self.completed == 1) {
  [self.web evaluateJavaScript:@"document.querySelector('a').removeAttribute('download'); document.querySelector('a').click()" completionHandler:nil];
 } else {
  if ([self.downloads count] != 0 || ![file.lastPathComponent isEqual:@"fixture (1).dmg"]) { fprintf(stderr,"Unexpected filename: %s\n",file.lastPathComponent.UTF8String);exit(3); }
  puts("PASS: download attribute, attachment response, preserved page and duplicate filename");
  exit(0);
 }
 }];
}
- (void)download:(WKDownload*)download didFailWithError:(NSError*)error resumeData:(NSData*)resumeData { fprintf(stderr,"Download error: %s\n",error.description.UTF8String);exit(4); }
- (void)webView:(WKWebView*)web didFailProvisionalNavigation:(WKNavigation*)navigation withError:(NSError*)error { if(error.code!=NSURLErrorCancelled && !([error.domain isEqual:WebKitErrorDomain] && error.code==WebKitErrorFrameLoadInterruptedByPolicyChange)) { fprintf(stderr,"Navigation: %s\n",error.description.UTF8String);exit(5); } }
@end
int main(int argc, char **argv) {
 @autoreleasepool {
  [NSApplication sharedApplication]; [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
  DownloadProbe *probe = [DownloadProbe new]; probe.origin = [NSURL URLWithString:@(argv[1])]; probe.output = [NSURL fileURLWithPath:@(argv[2])];
  WKWebViewConfiguration *config = [WKWebViewConfiguration new]; config.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
  probe.web = [[WKWebView alloc] initWithFrame:NSMakeRect(0,0,400,200) configuration:config]; probe.web.navigationDelegate = probe;
  [probe.web loadRequest:[NSURLRequest requestWithURL:probe.origin]];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,30*NSEC_PER_SEC), dispatch_get_main_queue(), ^{exit(6);});
  [NSApp run];
 }
 return 0;
}
