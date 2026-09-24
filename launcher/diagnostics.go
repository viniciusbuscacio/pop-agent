package main

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"syscall"
)

// Bootstrap errors describe the failed public request, never response bodies or credentials.
type manifestError struct {
	endpoint string
	status   int
	cause    error
}

func (e *manifestError) Unwrap() error { return e.cause }
func (e *manifestError) Error() string {
	code, detail := "client_manifest_invalid", "The server returned invalid client metadata. Check the server client distribution and reverse-proxy routes."
	switch {
	case e.status == 0:
		code, detail = "server_connection_failed", "Could not connect to the Pop Agent server. Check its address, network, and TLS configuration."
		var dns *net.DNSError
		var certificate x509.UnknownAuthorityError
		var hostname x509.HostnameError
		var invalidCertificate x509.CertificateInvalidError
		if errors.Is(e.cause, context.DeadlineExceeded) {
			code = "server_request_timed_out"
			detail = "The request timed out. Check server availability and network connectivity."
		} else if errors.As(e.cause, &dns) {
			code = "server_dns_failed"
			detail = "DNS lookup failed. Check the server hostname and private-network connection."
		} else if errors.As(e.cause, &certificate) || errors.As(e.cause, &hostname) || errors.As(e.cause, &invalidCertificate) {
			code, detail = "server_tls_failed", "TLS certificate validation failed. Check the server hostname, certificate, trust chain, and system clock."
		} else if errors.Is(e.cause, syscall.ECONNREFUSED) {
			code, detail = "server_connection_refused", "Could not connect: the connection was refused. Check that the server or proxy is listening at this address."
		}
	case e.status == http.StatusNotFound:
		code, detail = "client_distribution_missing", "The server responded, but a required client manifest is missing. The server administrator should restore/prepare cli/pack and verify the deployment; also check reverse-proxy routing."
	case e.status == http.StatusUnauthorized || e.status == http.StatusForbidden:
		code, detail = "client_manifest_access_denied", "The server or proxy denied a public client manifest. Check access/proxy rules; this is not evidence that your chat sign-in expired."
	case e.status == http.StatusTooManyRequests:
		code, detail = "client_manifest_rate_limited", "The server or proxy is rate limiting client startup. Retry later and check its request limits."
	case e.status >= 500:
		code, detail = "server_http_error", "The server or proxy returned an error. Check its logs and health before retrying."
	case e.status != http.StatusOK:
		code, detail = "client_manifest_http_error", "The server returned an unexpected status for public client metadata. Check the endpoint and proxy configuration."
	}
	status := "no HTTP response"
	if e.status != 0 {
		status = fmt.Sprintf("HTTP %d", e.status)
	}
	return fmt.Sprintf("[%s] GET %s: %s. %s", code, e.endpoint, status, detail)
}
func manifestFailure(endpoint string, status int, cause error) error {
	parsed, err := url.Parse(endpoint)
	safe := "(invalid endpoint)"
	if err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != "" {
		safe = parsed.Scheme + "://" + parsed.Host + parsed.EscapedPath()
	}
	return &manifestError{endpoint: safe, status: status, cause: cause}
}
func reportBootstrapFailure(out io.Writer, err error) {
	fmt.Fprintln(out, describeNetworkError(err))
	fmt.Fprintln(out, "Run `pop doctor` for client/bootstrap diagnostics.")
}
