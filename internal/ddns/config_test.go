package ddns

import "testing"

func TestConfigValidation(t *testing.T) {
	valid := DefaultConfig()
	valid.Enabled = true
	valid.RecordName = " Node.Example.COM. "
	valid.Token = "fixture-token"
	if err := valid.Normalize(); err != nil || valid.RecordName != "node.example.com" {
		t.Fatalf("valid config rejected: %v", err)
	}
	for _, change := range []func(*Config){
		func(c *Config) { c.Token = "" }, func(c *Config) { c.Token = "x\ny" }, func(c *Config) { c.Provider = "unknown" },
		func(c *Config) { c.RecordName = "*.example.com" }, func(c *Config) { c.RecordName = "https://example.com" },
		func(c *Config) { c.RecordName = "127.0.0.1" }, func(c *Config) { c.IPv4 = false; c.IPv6 = false },
		func(c *Config) { c.IntervalSeconds = 1 }, func(c *Config) { c.TTL = 2 }, func(c *Config) { c.ZoneID = "invalid" },
		func(c *Config) { c.IPv4URL = "http://example.com" }, func(c *Config) { c.IPv4URL = "https://user:secret@example.com" },
	} {
		c := valid
		change(&c)
		if c.Normalize() == nil {
			t.Fatal("invalid config accepted")
		}
	}
	disabled := DefaultConfig()
	if disabled.Normalize() != nil {
		t.Fatal("disabled initial config rejected")
	}
}

func TestManagedProviderConfigValidation(t *testing.T) {
	ali := Config{Enabled: true, Provider: ProviderAliDNS, RecordName: "node.example.com", ZoneID: "Example.com.", KeyID: "LTAIfixture", Token: "fixture-secret", IPv4: true}
	if err := ali.Normalize(); err != nil || ali.ZoneID != "example.com" || ali.TTL != 600 {
		t.Fatalf("aliyun config: %v %+v", err, ali)
	}
	pod := Config{Enabled: true, Provider: ProviderDNSPod, RecordName: "example.com", Token: "12345,fixturetoken", IPv4: true}
	if err := pod.Normalize(); err != nil || pod.KeyID != "12345" || pod.Token != "fixturetoken" {
		t.Fatalf("dnspod pasted login token: %v %+v", err, pod)
	}
	cf := DefaultConfig()
	cf.KeyID = "leftover"
	if cf.Normalize() != nil || cf.KeyID != "" {
		t.Fatal("Cloudflare kept an unused key ID")
	}
	for _, change := range []func(*Config){
		func(c *Config) { c.KeyID = "" }, func(c *Config) { c.KeyID = "bad id" },
		func(c *Config) { c.ZoneID = "other.com" }, func(c *Config) { c.ZoneID = "not a domain" },
		func(c *Config) { c.Provider = ProviderDNSPod; c.KeyID = "abc" },
		func(c *Config) { c.Provider = ProviderDNSPod; c.Token = "a,b" },
	} {
		c := Config{Enabled: true, Provider: ProviderAliDNS, RecordName: "node.example.com", KeyID: "12345", Token: "fixture", IPv4: true}
		change(&c)
		if c.Normalize() == nil {
			t.Fatalf("invalid managed config accepted: %+v", c)
		}
	}
}
