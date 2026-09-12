# Vendored WebView2 adapter

Source: the repository's previously shipped adapter at commit `8ef8bc8`, based
on `github.com/jchv/go-webview2` revision `56598839c808`. Licenses and the embedded
Microsoft WebView2 loader notices are retained.

The existing patches expose navigation-starting and new-window callbacks used
to restrict the Desktop to its configured server origin. Pop adds no RPC bindings.
The unconditional clipboard-read permission has been removed: WebView2's normal
permission behavior applies instead of silently granting pages clipboard access.

This dependency is Windows-only. Review navigation, web permissions and loader
integrity when updating it; cross-compilation is not device acceptance testing.
