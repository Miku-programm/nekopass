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

// Published example from the Alibaba Cloud DNS RPC signature documentation.
func TestAliyunSignatureVector(t *testing.T) {
	canonical := aliyunQuery(map[string]string{
		"Format": "XML", "AccessKeyId": "testid", "Action": "DescribeDomainRecords", "SignatureMethod": "HMAC-SHA1",
		"DomainName": "example.com", "SignatureNonce": "f59ed6a9-83fc-473b-9cc6-99c95df3856e", "SignatureVersion": "1.0",
		"Version": "2015-01-09", "Timestamp": "2016-03-24T16:41:54Z",
	})
	if got := aliyunSign("testsecret", "GET", canonical); got != "uRpHwaSEt3J+6KQD//svCh/x+pI=" {
		t.Fatalf("signature %s", got)
	}
}

func aliyunFixture(t *testing.T, handle func(action string, q map[string]string) (int, any)) (*httptest.Server, Config) {
	cfg := DefaultConfig()
	cfg.Provider, cfg.RecordName, cfg.KeyID, cfg.Token, cfg.TTL = ProviderAliDNS, "node.example.com", "fixtureKeyId", "fixture-secret", 1
	var mu sync.Mutex
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		q := map[string]string{}
		for key, values := range r.URL.Query() {
			q[key] = values[0]
		}
		signature := q["Signature"]
		delete(q, "Signature")
		if r.Method != "GET" || q["AccessKeyId"] != cfg.KeyID || signature != aliyunSign(cfg.Token, "GET", aliyunQuery(q)) {
			t.Error("request not signed with the AccessKey")
		}
		if strings.Contains(r.URL.RawQuery, cfg.Token) {
			t.Error("secret sent in query")
		}
		status, body := handle(q["Action"], q)
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(body)
	}))
	return s, cfg
}

func TestAliyunZoneDiscoveryAndUpsert(t *testing.T) {
	type record = map[string]any
	var stored record
	var actions []string
	s, cfg := aliyunFixture(t, func(action string, q map[string]string) (int, any) {
		actions = append(actions, action)
		switch action {
		case "DescribeDomainInfo":
			if q["DomainName"] == "example.com" {
				return 200, record{"DomainName": "example.com"}
			}
			return 400, record{"Code": "InvalidDomainName.NoExist", "Message": "fixture-secret"}
		case "DescribeSubDomainRecords":
			if q["SubDomain"] != "node.example.com" || q["DomainName"] != "example.com" || q["Type"] != "A" {
				t.Error("record filter lost")
			}
			list := []any{}
			if stored != nil {
				list = append(list, stored)
			}
			return 200, record{"DomainRecords": record{"Record": list}}
		case "AddDomainRecord":
			if q["RR"] != "node" || q["TTL"] != "600" || q["DomainName"] != "example.com" {
				t.Errorf("bad create %v", q)
			}
			stored = record{"RecordId": "123", "RR": q["RR"], "Type": q["Type"], "Value": q["Value"], "TTL": 600, "Line": "default", "Status": "ENABLE"}
			return 200, record{"RecordId": "123"}
		case "UpdateDomainRecord":
			if q["RecordId"] != "123" || q["RR"] != "node" || q["Line"] != "default" {
				t.Errorf("bad update %v", q)
			}
			stored["Value"] = q["Value"]
			return 200, record{"RecordId": "123"}
		}
		t.Errorf("unexpected action %s", action)
		return 400, record{}
	})
	defer s.Close()
	c := &Client{AliyunBase: s.URL, API: s.Client()}
	zone, err := c.Zone(context.Background(), cfg)
	if err != nil || zone != "example.com" {
		t.Fatalf("zone discovery: %q %v", zone, err)
	}
	if changed, err := c.Sync(context.Background(), cfg, zone, "A", "203.0.113.7"); err != nil || !changed {
		t.Fatalf("create: %v", err)
	}
	if changed, err := c.Sync(context.Background(), cfg, zone, "A", "203.0.113.7"); err != nil || changed {
		t.Fatalf("unchanged record rewritten: %v", err)
	}
	if changed, err := c.Sync(context.Background(), cfg, zone, "A", "203.0.113.8"); err != nil || !changed || stored["Value"] != "203.0.113.8" {
		t.Fatalf("update: %v", err)
	}
	if got := strings.Join(actions, ","); got != "DescribeDomainInfo,DescribeDomainInfo,DescribeSubDomainRecords,AddDomainRecord,DescribeSubDomainRecords,DescribeSubDomainRecords,UpdateDomainRecord" {
		t.Fatalf("actions %s", got)
	}
}

func TestAliyunApexAndErrors(t *testing.T) {
	s, cfg := aliyunFixture(t, func(action string, q map[string]string) (int, any) {
		if action == "DescribeSubDomainRecords" {
			return 200, map[string]any{"DomainRecords": map[string]any{"Record": []any{}}}
		}
		if q["RR"] != "@" {
			t.Errorf("apex RR %q", q["RR"])
		}
		return 200, map[string]any{}
	})
	c := &Client{AliyunBase: s.URL, API: s.Client()}
	cfg.RecordName = "example.com"
	if _, err := c.Sync(context.Background(), cfg, "example.com", "AAAA", "2001:db8::1"); err != nil {
		t.Fatal(err)
	}
	s.Close()
	for code, fatal := range map[string]bool{"InvalidAccessKeyId.NotFound": true, "SignatureDoesNotMatch": true, "Throttling.User": true, "InvalidDomainName.NoExist": false} {
		s, cfg := aliyunFixture(t, func(string, map[string]string) (int, any) {
			return 400, map[string]any{"Code": code, "Message": "fixture-secret details"}
		})
		c := &Client{AliyunBase: s.URL, API: s.Client()}
		_, err := c.Zone(context.Background(), cfg)
		if err == nil || strings.Contains(err.Error(), "fixture-secret") {
			t.Fatalf("%s: error leaked or missing: %v", code, err)
		}
		if fatal && strings.Contains(err.Error(), "找不到") || !fatal && !strings.Contains(err.Error(), "找不到") {
			t.Fatalf("%s: wrong classification: %v", code, err)
		}
		s.Close()
	}
}
