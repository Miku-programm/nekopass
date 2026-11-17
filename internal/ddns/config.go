package ddns

import (
	"errors"
	"net"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
)

type Config struct {
	Enabled    bool   `json:"enabled"`
	Provider   string `json:"provider"`
	RecordName string `json:"record_name"`
	ZoneID     string `json:"zone_id"`
	// KeyID is the Alibaba Cloud AccessKey ID or the DNSPod token ID; Token holds the matching secret.
	KeyID            string `json:"key_id"`
	Token            string `json:"token"`
	IPv4             bool   `json:"ipv4"`
	IPv6             bool   `json:"ipv6"`
	IntervalSeconds  int    `json:"interval_seconds"`
	TTL              int    `json:"ttl"`
	IPv4URL          string `json:"ipv4_url"`
	IPv6URL          string `json:"ipv6_url"`
	IPSource         string `json:"ip_source"`
	IgnorePrivateIPs bool   `json:"ignore_private_ips"`
	UseForIngress    bool   `json:"use_for_ingress"`
	UseForEgress     bool   `json:"use_for_egress"`
}

const (
	IPSourceAPI       = "api"
	IPSourceInterface = "interface"
)

func DefaultConfig() Config {
	return Config{Provider: ProviderCloudflare, IPv4: true, IntervalSeconds: 300, TTL: 300, IPv4URL: "https://api.ipify.org", IPv6URL: "https://api6.ipify.org", IPSource: IPSourceAPI, IgnorePrivateIPs: true, UseForIngress: true, UseForEgress: true}
}

var (
	zoneID      = regexp.MustCompile(`^[a-fA-F0-9]{32}$`)
	aliyunKeyID = regexp.MustCompile(`^[A-Za-z0-9]{1,128}$`)
	dnspodKeyID = regexp.MustCompile(`^[0-9]{1,20}$`)
)

// ProviderName is the label used in validation and status messages.
func ProviderName(provider string) string {
	switch provider {
	case ProviderAliDNS:
		return "阿里云"
	case ProviderDNSPod:
		return "DNSPod"
	default:
		return "Cloudflare"
	}
}

func (c *Config) Normalize() error {
	c.RecordName = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(c.RecordName), "."))
	c.ZoneID = strings.TrimSpace(c.ZoneID)
	c.KeyID = strings.TrimSpace(c.KeyID)
	c.Token = strings.TrimSpace(c.Token)
	d := DefaultConfig()
	if c.IPSource == "" {
		c.IPSource = d.IPSource
	}
	if c.IPSource != IPSourceAPI && c.IPSource != IPSourceInterface {
		return errors.New("IP 获取方式无效")
	}
	if c.Provider == "" {
		c.Provider = d.Provider
	}
	if c.IntervalSeconds == 0 {
		c.IntervalSeconds = d.IntervalSeconds
	}
	if c.TTL == 0 {
		c.TTL = d.TTL
		if c.Provider != ProviderCloudflare {
			c.TTL = managedDefaultTTL
		}
	}
	if c.IPv4URL == "" {
		c.IPv4URL = d.IPv4URL
	}
	if c.IPv6URL == "" {
		c.IPv6URL = d.IPv6URL
	}
	switch c.Provider {
	case ProviderCloudflare:
		c.KeyID = ""
		if c.ZoneID != "" && !zoneID.MatchString(c.ZoneID) {
			return errors.New("Zone ID 须为 32 位十六进制字符")
		}
	case ProviderAliDNS, ProviderDNSPod:
		// DNSPod issues "ID,Token" as one login token; accept it pasted whole.
		if c.Provider == ProviderDNSPod && c.KeyID == "" {
			if id, token, ok := strings.Cut(c.Token, ","); ok {
				c.KeyID, c.Token = strings.TrimSpace(id), strings.TrimSpace(token)
			}
		}
		pattern, label := aliyunKeyID, "AccessKey ID"
		if c.Provider == ProviderDNSPod {
			pattern, label = dnspodKeyID, "DNSPod ID"
		}
		if c.KeyID != "" && !pattern.MatchString(c.KeyID) {
			return errors.New(label + " 格式无效")
		}
		c.ZoneID = strings.ToLower(strings.TrimSuffix(c.ZoneID, "."))
		if c.ZoneID != "" && !ValidDomain(c.ZoneID) {
			return errors.New("主域名格式无效，例如 example.com")
		}
	default:
		return errors.New("DNS 服务商仅支持 Cloudflare、阿里云和 DNSPod")
	}
	if c.IntervalSeconds < 60 || c.IntervalSeconds > 86400 {
		return errors.New("检查间隔须为 60–86400 秒")
	}
	if c.TTL != 1 && (c.TTL < 60 || c.TTL > 86400) {
		return errors.New("TTL 须为 1（自动）或 60–86400 秒")
	}
	if len(c.Token) > 512 || strings.ContainsAny(c.Token, "\r\n\x00") || c.Provider == ProviderDNSPod && strings.Contains(c.Token, ",") {
		return errors.New(ProviderName(c.Provider) + " Token 格式无效")
	}
	if c.RecordName != "" && !ValidDomain(c.RecordName) {
		return errors.New("DDNS 须填写完整域名，不含协议、端口或通配符")
	}
	if c.Provider != ProviderCloudflare && c.ZoneID != "" && c.RecordName != "" {
		if _, ok := relativeName(c.RecordName, c.ZoneID); !ok {
			return errors.New("记录域名须属于所填主域名")
		}
	}
	if c.IPSource == IPSourceAPI {
		for _, source := range []string{c.IPv4URL, c.IPv6URL} {
			u, err := url.Parse(source)
			if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" || len(source) > 2048 || strings.ContainsAny(source, "\r\n\x00") {
				return errors.New("IP 获取地址须为 HTTPS URL")
			}
		}
	}
	if c.Enabled && (c.RecordName == "" || c.Token == "" || !c.IPv4 && !c.IPv6) {
		return errors.New("启用 DDNS 需要域名、Token，并至少选择一个 IP 类型")
	}
	if c.Enabled && c.Provider != ProviderCloudflare && c.KeyID == "" {
		if c.Provider == ProviderDNSPod {
			return errors.New("启用 DNSPod 需要填写 ID 和 Token")
		}
		return errors.New("启用阿里云 DNS 需要填写 AccessKey ID 和 AccessKey Secret")
	}
	return nil
}

// AllowsAddress is shared by node discovery and controller report validation.
// Link-local addresses need an interface scope and cannot serve as DNS targets.
func (c Config) AllowsAddress(address netip.Addr, v6 bool) bool {
	if !address.IsValid() || address.Zone() != "" || address.Is4In6() || address.Is6() != v6 || address.IsUnspecified() || address.IsMulticast() || address.IsLinkLocalUnicast() || address.IsLinkLocalMulticast() {
		return false
	}
	if !address.IsGlobalUnicast() && !address.IsLoopback() {
		return false
	}
	return c.IPSource == IPSourceInterface && !c.IgnorePrivateIPs || !isLocalAddress(address)
}

var sharedAddressSpace = netip.MustParsePrefix("100.64.0.0/10")

func isLocalAddress(address netip.Addr) bool {
	return address.IsPrivate() || address.IsLoopback() || sharedAddressSpace.Contains(address)
}

func ValidDomain(name string) bool {
	if len(name) > 253 || net.ParseIP(name) != nil || !strings.Contains(name, ".") {
		return false
	}
	for _, part := range strings.Split(name, ".") {
		if len(part) == 0 || len(part) > 63 || part[0] == '-' || part[len(part)-1] == '-' {
			return false
		}
		for _, ch := range part {
			if !(ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' || ch == '-') {
				return false
			}
		}
	}
	return true
}
