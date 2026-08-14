package serverclient

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const sessionTokenHeader = "x-pop-agent-token"

type ErrorKind string

const (
	Offline            ErrorKind = "offline"
	InvalidCredentials ErrorKind = "invalid_credentials"
	InvalidSession     ErrorKind = "invalid_session"
	UnexpectedResponse ErrorKind = "unexpected_response"
)

type Error struct {
	Kind       ErrorKind
	StatusCode int
	Message    string
	Cause      error
}

func (e *Error) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return string(e.Kind)
}

func (e *Error) Unwrap() error { return e.Cause }

func IsKind(err error, kind ErrorKind) bool {
	var clientErr *Error
	return errors.As(err, &clientErr) && clientErr.Kind == kind
}

type Client struct {
	http *http.Client
}

func New() *Client {
	return NewWithHTTP(&http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	})
}

func NewWithHTTP(client *http.Client) *Client { return &Client{http: client} }

func NormalizeURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("Enter a valid Pop Agent server URL.")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("The server URL must use HTTP or HTTPS.")
	}
	if parsed.User != nil || (parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("Enter only the server origin, without a path, query, credentials, or fragment.")
	}
	hostname := parsed.Hostname()
	if parsed.Scheme == "http" && !isLoopback(hostname) {
		return "", errors.New("Remote Pop Agent servers must use HTTPS.")
	}
	parsed.Path = ""
	parsed.RawPath = ""
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

func isLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

type loginResponse struct {
	Token string `json:"token"`
}

type updateStatusResponse struct {
	PopAgent struct {
		Current string `json:"current"`
	} `json:"popAgent"`
}

type DesktopRelease struct {
	Version      string `json:"version"`
	Platform     string `json:"platform"`
	Arch         string `json:"arch"`
	SHA256       string `json:"sha256"`
	Size         int64  `json:"size"`
	DownloadPath string `json:"downloadPath"`
}

var desktopVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)
var desktopSHA256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

const maxDesktopPackageBytes = 64 << 20

type apiErrorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func (c *Client) Login(ctx context.Context, origin, password string) (string, error) {
	body, err := json.Marshal(struct {
		Password string `json:"password"`
	}{Password: password})
	if err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+"/v1/login", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return "", offlineError(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", responseError(response, UnexpectedResponse)
	}
	var result loginResponse
	if err := decodeJSON(response.Body, &result); err != nil || result.Token == "" {
		return "", &Error{Kind: UnexpectedResponse, StatusCode: response.StatusCode, Message: "Pop Agent returned an invalid login response.", Cause: err}
	}
	return result.Token, nil
}

// ProbeSession verifies both reachability and authentication against a guarded,
// side-effect-free endpoint. A non-empty returned token replaces the old one.
func (c *Client) ProbeSession(ctx context.Context, origin, token string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/v1/settings", nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := c.http.Do(request)
	if err != nil {
		return "", offlineError(err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized {
		return "", responseError(response, InvalidSession)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", responseError(response, UnexpectedResponse)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	return strings.TrimSpace(response.Header.Get(sessionTokenHeader)), nil
}

func (c *Client) CurrentVersion(ctx context.Context, origin, token string) (string, string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/v1/update/status", nil)
	if err != nil {
		return "", "", err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := c.http.Do(request)
	if err != nil {
		return "", "", offlineError(err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized {
		return "", "", responseError(response, InvalidSession)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", "", responseError(response, UnexpectedResponse)
	}
	var result updateStatusResponse
	if err := decodeJSON(io.LimitReader(response.Body, 64<<10), &result); err != nil || result.PopAgent.Current == "" {
		return "", "", &Error{Kind: UnexpectedResponse, Message: "Pop Agent returned an invalid version response.", Cause: err}
	}
	return result.PopAgent.Current, strings.TrimSpace(response.Header.Get(sessionTokenHeader)), nil
}

func (c *Client) DesktopRelease(ctx context.Context, origin, token string) (DesktopRelease, string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/v1/desktop/release", nil)
	if err != nil {
		return DesktopRelease{}, "", err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := c.http.Do(request)
	if err != nil {
		return DesktopRelease{}, "", offlineError(err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized {
		return DesktopRelease{}, "", responseError(response, InvalidSession)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return DesktopRelease{}, "", responseError(response, UnexpectedResponse)
	}
	var release DesktopRelease
	if err := decodeJSON(io.LimitReader(response.Body, 64<<10), &release); err != nil || !validDesktopRelease(release) {
		return DesktopRelease{}, "", &Error{Kind: UnexpectedResponse, Message: "Pop Agent returned invalid Pop Desktop release metadata.", Cause: err}
	}
	return release, strings.TrimSpace(response.Header.Get(sessionTokenHeader)), nil
}

func (c *Client) DownloadDesktop(ctx context.Context, origin, token string, release DesktopRelease, target io.Writer) (string, error) {
	if !validDesktopRelease(release) {
		return "", errors.New("invalid Pop Desktop release metadata")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+release.DownloadPath, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := c.http.Do(request)
	if err != nil {
		return "", offlineError(err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized {
		return "", responseError(response, InvalidSession)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", responseError(response, UnexpectedResponse)
	}
	hash := sha256.New()
	written, err := io.Copy(io.MultiWriter(target, hash), io.LimitReader(response.Body, release.Size+1))
	if err != nil {
		return "", fmt.Errorf("download Pop Desktop: %w", err)
	}
	if written != release.Size || written > maxDesktopPackageBytes {
		return "", errors.New("Pop Desktop package size does not match its release metadata")
	}
	if hex.EncodeToString(hash.Sum(nil)) != release.SHA256 {
		return "", errors.New("Pop Desktop package checksum does not match its release metadata")
	}
	return strings.TrimSpace(response.Header.Get(sessionTokenHeader)), nil
}

func validDesktopRelease(release DesktopRelease) bool {
	expected := "/v1/desktop/package/pop-desktop-" + release.Version + "-darwin-arm64.zip"
	return desktopVersionPattern.MatchString(release.Version) &&
		release.Platform == "darwin" && release.Arch == "arm64" &&
		desktopSHA256Pattern.MatchString(release.SHA256) && release.Size > 0 &&
		release.Size <= maxDesktopPackageBytes && release.DownloadPath == expected
}

func responseError(response *http.Response, fallback ErrorKind) error {
	var payload apiErrorResponse
	_ = decodeJSON(io.LimitReader(response.Body, 64<<10), &payload)
	kind := fallback
	if payload.Error.Code == string(InvalidSession) {
		kind = InvalidSession
	} else if payload.Error.Code == string(InvalidCredentials) {
		kind = InvalidCredentials
	}
	message := payload.Error.Message
	if message == "" {
		message = fmt.Sprintf("Pop Agent returned HTTP %d.", response.StatusCode)
	}
	return &Error{Kind: kind, StatusCode: response.StatusCode, Message: message}
}

func decodeJSON(reader io.Reader, target any) error {
	decoder := json.NewDecoder(reader)
	return decoder.Decode(target)
}

func offlineError(err error) error {
	return &Error{Kind: Offline, Message: "Pop Agent server couldn't be reached. Check the server URL and try again.", Cause: err}
}
