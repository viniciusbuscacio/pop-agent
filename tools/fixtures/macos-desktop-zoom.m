#import "../../local-access/tray/desktop_darwin.m"
void popDesktopBeginUpdate(char *url) { }

static void requireZoom(CGFloat actual, CGFloat expected, const char *message) {
 if (fabs(actual - expected) > 0.001) {
  fprintf(stderr, "%s: got %.3f, expected %.3f\n", message, actual, expected);
  exit(2);
 }
}

int main(int argc, char **argv) {
 @autoreleasepool {
  if (argc != 3) return 3;
  NSString *suite = @(argv[1]);
  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:suite];
  if (strcmp(argv[2], "write") == 0) {
   [defaults removePersistentDomainForName:suite];
   requireZoom(popLoadZoom(defaults), 1.0, "missing preference");
   popStoreZoom(defaults, 1.4);
   [defaults synchronize];
   puts("PASS: saved native Desktop zoom preference");
   return 0;
  }

  requireZoom(popLoadZoom(defaults), 1.4, "saved preference after relaunch");
  popStoreZoom(defaults, 9.0);
  requireZoom(popLoadZoom(defaults), 3.0, "upper bound");
  popStoreZoom(defaults, 0.1);
  requireZoom(popLoadZoom(defaults), 0.5, "lower bound");
  [defaults setObject:@"invalid" forKey:popDesktopZoomKey];
  requireZoom(popLoadZoom(defaults), 1.0, "invalid preference");
  [defaults removePersistentDomainForName:suite];
  puts("PASS: restored native Desktop zoom preference after relaunch");
 }
 return 0;
}
