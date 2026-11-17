package ddns

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
)

const (
	ProviderCloudflare = "cloudflare"
	ProviderAliDNS     = "alidns"
	ProviderDNSPod     = "dnspod"
)

// Free Alibaba Cloud DNS and DNSPod plans reject TTLs below 600 seconds.
const managedDefaultTTL = 600

const userAgent = "Nekopass-DDNS/1.0"

// Zone resolves the provider zone for cfg.RecordName: a Cloudflare zone ID,
// or the registered main domain for Alibaba Cloud DNS and DNSPod.
func (c *Client) Zone(ctx context.Context, cfg Config) (string, error) {
	switch cfg.Provider {
	case ProviderAliDNS:
		return c.aliyunZone(ctx, cfg)
	case ProviderDNSPod:
		return c.dnspodZone(ctx, cfg)
	default:
		return c.cloudflareZone(ctx, cfg)
	}
}

// Sync creates or updates the single A/AAAA record and reports whether DNS changed.
func (c *Client) Sync(ctx context.Context, cfg Config, zone, kind, address string) (bool, error) {
	switch cfg.Provider {
	case ProviderAliDNS:
		return c.aliyunSync(ctx, cfg, zone, kind, address)
	case ProviderDNSPod:
		return c.dnspodSync(ctx, cfg, zone, kind, address)
	default:
		return c.cloudflareSync(ctx, cfg, zone, kind, address)
	}
}

// providerError separates failures that must stop zone discovery (credentials,
// rate limits, transport) from a candidate domain that simply is not in the account.
type providerError struct {
	message string
	fatal   bool
}

func (e *providerError) Error() string { return e.message }

func fatalError(message string) error { return &providerError{message: message, fatal: true} }

func isFatal(err error) bool {
	var p *providerError
	return !errors.As(err, &p) || p.fatal
}

// zoneCandidates lists the record name and each parent domain, longest first.
func zoneCandidates(record string) []string {
	labels := strings.Split(record, ".")
	out := make([]string, 0, len(labels))
	for offset := 0; offset < len(labels)-1; offset++ {
		out = append(out, strings.Join(labels[offset:], "."))
	}
	return out
}

// relativeName converts a full record name into the host part used by the
// Alibaba Cloud and DNSPod APIs; "@" is the apex.
func relativeName(record, zone string) (string, bool) {
	record, zone = strings.ToLower(record), strings.ToLower(zone)
	if record == zone {
		return "@", true
	}
	if !strings.HasSuffix(record, "."+zone) {
		return "", false
	}
	return strings.TrimSuffix(record, "."+zone), true
}

func providerTTL(ttl int) int {
	if ttl == 1 {
		return managedDefaultTTL
	}
	return ttl
}

func readLimited(response *http.Response) ([]byte, bool) {
	data, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	return data, err == nil && len(data) <= 1<<20
}

// safeCode keeps provider error codes printable without echoing arbitrary text.
func safeCode(code string) string {
	var b strings.Builder
	for _, ch := range code {
		if b.Len() >= 64 {
			break
		}
		if ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '.' || ch == '_' || ch == '-' {
			b.WriteRune(ch)
		}
	}
	return b.String()
}
