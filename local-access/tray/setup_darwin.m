#import <Cocoa/Cocoa.h>
int popSetupDialog(const char *title, const char *message, const char *button, int cancel) {
 @autoreleasepool {
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  if (![NSApp isRunning]) [NSApp finishLaunching];
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = [NSString stringWithUTF8String:title];
  alert.informativeText = [NSString stringWithUTF8String:message];
  [alert addButtonWithTitle:[NSString stringWithUTF8String:button]];
  if (cancel) [alert addButtonWithTitle:@"Cancel"];
  [NSApp activateIgnoringOtherApps:YES];
  return [alert runModal] == NSAlertFirstButtonReturn;
 }
}
