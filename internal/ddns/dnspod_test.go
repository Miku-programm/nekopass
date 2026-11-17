package ddns

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func dnspodFixture(t *testing.T, handle func(action string, form map[string]string) any) (*httptest.Server, Config) {
	cfg := DefaultConfig()
	cfg.Provider, cfg.RecordName, cfg.KeyID, cfg.Token, cfg.TTL = ProviderDNSPod, "node.example.com", "12345", "fixturetoken", 600
	var mu sync.Mutex
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Method != "POST" || r.ParseForm() != nil || r.PostForm.Get("login_token") != "12345,fixturetoken" || r.URL.RawQuery != "" {
			t.Error("login token not sent in the POST body")
		}
		if r.Header.Get("User-Agent") == "" || r.PostForm.Get("format") != "json" {
			t.Error("DNSPod request headers lost")
		}
		form := map[string]string{}
		for key := range r.PostForm {
			form[key] = r.PostForm.Get(key)
		}
		json.NewEncoder(w).Encode(handle(strings.TrimPrefix(r.URL.Path, "/"), form))
	}))
	return s, cfg
}

func ok(extra map[string]any) map[string]any {
	extra["status"] = map[string]any{"code": "1", "message": "Action completed successful"}
	return extra
}

func TestDNSPodZoneDiscoveryAndUpsert(t *testing.T) {
	var stored map[string]any
	var actions []string
	s, cfg := dnspodFixture(t, func(action string, f map[string]string) any {
		actions = append(actions, action)
		switch action {
		case "Domain.Info":
			if f["domain"] == "example.com" {
				return ok(map[string]any{"domain": map[string]any{"id": 9, "name": "example.com"}})
			}
			return map[string]any{"status": map[string]any{"code": "6", "message": "fixturetoken"}}
		case "Record.List":
			if f["domain"] != "example.com" || f["sub_domain"] != "node" || f["record_type"] != "AAAA" {
				t.Error("record filter lost")
			}
			list := []any{}
			if stored != nil {
				// A second line's record must not hide the default-line DDNS record.
				list = append(list, map[string]any{"id": "77", "name": "node", "type": "AAAA", "value": "2001:db8::9", "ttl": "600", "line": "电信", "line_id": "10=0", "enabled": "1"}, stored)
			}
			return ok(map[string]any{"records": list})
		case "Record.Create":
			if f["sub_domain"] != "node" || f["record_line_id"] != "0" || f["ttl"] != "600" {
				t.Errorf("bad create %v", f)
			}
			stored = map[string]any{"id": 88, "name": "node", "type": "AAAA", "value": f["value"], "ttl": 600, "line": "默认", "line_id": "0", "enabled": "1"}
			return ok(map[string]any{"record": map[string]any{"id": "88"}})
		case "Record.Modify":
			if f["record_id"] != "88" || f["record_line_id"] != "0" {
				t.Errorf("bad modify %v", f)
			}
			stored["value"] = f["value"]
			return ok(map[string]any{})
		}
		t.Errorf("unexpected action %s", action)
		return map[string]any{}
	})
	defer s.Close()
	c := &Client{DNSPodBase: s.URL, API: s.Client()}
	zone, err := c.Zone(context.Background(), cfg)
	if err != nil || zone != "example.com" {
		t.Fatalf("zone discovery: %v", err)
	}
	if changed, err := c.Sync(context.Background(), cfg, zone, "AAAA", "2001:db8::1"); err != nil || !changed {
		t.Fatalf("create: %v", err)
	}
	if changed, err := c.Sync(context.Background(), cfg, zone, "AAAA", "2001:db8::1"); err != nil || changed {
		t.Fatalf("unchanged record rewritten: %v", err)
	}
	if changed, err := c.Sync(context.Background(), cfg, zone, "AAAA", "2001:db8::2"); err != nil || !changed || stored["value"] != "2001:db8::2" {
		t.Fatalf("update: %v", err)
	}
	if got := strings.Join(actions, ","); got != "Domain.Info,Domain.Info,Record.List,Record.Create,Record.List,Record.List,Record.Modify" {
		t.Fatalf("actions %s", got)
	}
}

func TestDNSPodCreatesMissingRecordAndClassifiesErrors(t *testing.T) {
	created := false
	s, cfg := dnspodFixture(t, func(action string, f map[string]string) any {
		if action == "Record.List" {
			return ok(map[string]any{"records": []any{}})
		}
		created = action == "Record.Create" && f["sub_domain"] == "@" && f["value"] == "203.0.113.7"
		return ok(map[string]any{})
	})
	c := &Client{DNSPodBase: s.URL, API: s.Client()}
	cfg.RecordName = "example.com"
	if changed, err := c.Sync(context.Background(), cfg, "example.com", "A", "203.0.113.7"); err != nil || !changed || !created {
		t.Fatalf("apex create: %v", err)
	}
	s.Close()
	for code, fatal := range map[string]bool{"-1": true, "-2": true, "-8": true, "6": false} {
		s, cfg := dnspodFixture(t, func(string, map[string]string) any {
			return map[string]any{"status": map[string]any{"code": code, "message": "fixturetoken leaked"}}
		})
		c := &Client{DNSPodBase: s.URL, API: s.Client()}
		_, err := c.Zone(context.Background(), cfg)
		if err == nil || strings.Contains(err.Error(), "fixturetoken") {
			t.Fatalf("%s: %v", code, err)
		}
		if fatal == strings.Contains(err.Error(), "找不到") {
			t.Fatalf("%s: wrong classification: %v", code, err)
		}
		s.Close()
	}
}
