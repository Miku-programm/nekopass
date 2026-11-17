package ddns

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// flexString accepts DNSPod fields that are returned either as strings or numbers.
type flexString string

func (f *flexString) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if bytes.Equal(data, []byte("null")) {
		*f = ""
		return nil
	}
	if len(data) > 0 && data[0] == '"' {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		*f = flexString(s)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(data, &n); err != nil {
		return err
	}
	*f = flexString(n.String())
	return nil
}

type dnspodStatus struct {
	Status struct {
		Code flexString `json:"code"`
	} `json:"status"`
}

func (c *Client) dnspod(ctx context.Context, cfg Config, action string, params url.Values, result any) error {
	form := url.Values{"login_token": {cfg.KeyID + "," + cfg.Token}, "format": {"json"}, "lang": {"cn"}, "error_on_empty": {"no"}}
	for key, values := range params {
		form[key] = values
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSuffix(c.DNSPodBase, "/")+"/"+action, strings.NewReader(form.Encode()))
	if err != nil {
		return fatalError("DNS 请求创建失败")
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("User-Agent", userAgent)
	response, err := c.API.Do(request)
	if err != nil {
		return fatalError("DNSPod 连接失败")
	}
	defer response.Body.Close()
	data, ok := readLimited(response)
	var status dnspodStatus
	if !ok || json.Unmarshal(data, &status) != nil {
		return fatalError("DNSPod 响应无效")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fatalError(fmt.Sprintf("DNSPod DNS 操作失败（HTTP %d）", response.StatusCode))
	}
	if code := string(status.Status.Code); code != "1" {
		return dnspodError(code)
	}
	if result != nil && json.Unmarshal(data, result) != nil {
		return fatalError("DNSPod 结果无效")
	}
	return nil
}

func dnspodError(code string) error {
	switch code {
	case "-1", "-7", "-8", "-99", "85":
		return fatalError("DNSPod Token 无效、账号受限或权限不足")
	case "-2":
		return fatalError("DNSPod 请求过于频繁，稍后重试")
	}
	// Remaining codes concern the domain or record, e.g. 6/7/8 for foreign domains.
	return &providerError{message: fmt.Sprintf("DNSPod DNS 操作失败（%s）", safeCode(code))}
}

func (c *Client) dnspodZone(ctx context.Context, cfg Config) (string, error) {
	if cfg.ZoneID != "" {
		return cfg.ZoneID, nil
	}
	for _, candidate := range zoneCandidates(cfg.RecordName) {
		var info struct {
			Domain struct {
				Name string `json:"name"`
			} `json:"domain"`
		}
		err := c.dnspod(ctx, cfg, "Domain.Info", url.Values{"domain": {candidate}}, &info)
		if err == nil && strings.EqualFold(strings.TrimSuffix(info.Domain.Name, "."), candidate) {
			return candidate, nil
		}
		if err != nil && isFatal(err) {
			return "", err
		}
	}
	return "", errors.New("DNSPod 账号中找不到该域名，请填写主域名或检查 Token")
}

type dnspodRecord struct {
	ID      flexString `json:"id"`
	Name    string     `json:"name"`
	Type    string     `json:"type"`
	Value   string     `json:"value"`
	TTL     flexString `json:"ttl"`
	Line    string     `json:"line"`
	LineID  flexString `json:"line_id"`
	Enabled flexString `json:"enabled"`
}

func (c *Client) dnspodSync(ctx context.Context, cfg Config, zone, kind, address string) (bool, error) {
	sub, ok := relativeName(cfg.RecordName, zone)
	if !ok {
		return false, errors.New("记录域名不属于所填主域名")
	}
	var listing struct {
		Records []dnspodRecord `json:"records"`
	}
	if err := c.dnspod(ctx, cfg, "Record.List", url.Values{"domain": {zone}, "sub_domain": {sub}, "record_type": {kind}, "length": {"100"}}, &listing); err != nil {
		return false, err
	}
	records := []dnspodRecord{}
	for _, record := range listing.Records {
		if record.Type == kind && strings.EqualFold(record.Name, sub) {
			records = append(records, record)
		}
	}
	if len(records) > 1 {
		defaults := []dnspodRecord{}
		for _, record := range records {
			if record.LineID == "0" || record.Line == "默认" {
				defaults = append(defaults, record)
			}
		}
		records = defaults
	}
	if len(records) > 1 {
		return false, errors.New("同名 DNS 记录有多条，请指定单条 A/AAAA 记录用于 DDNS")
	}
	ttl := fmt.Sprint(providerTTL(cfg.TTL))
	params := url.Values{"domain": {zone}, "sub_domain": {sub}, "record_type": {kind}, "value": {address}, "ttl": {ttl}, "record_line_id": {"0"}}
	if len(records) == 0 {
		return true, c.dnspod(ctx, cfg, "Record.Create", params, nil)
	}
	record := records[0]
	if record.ID == "" || len(record.ID) > 32 {
		return false, errors.New("DNSPod DNS 记录不匹配")
	}
	if record.Enabled == "0" {
		return false, errors.New("DNSPod DNS 记录已暂停，请先启用")
	}
	if record.Value == address && string(record.TTL) == ttl {
		return false, nil
	}
	params.Set("record_id", string(record.ID))
	if record.LineID != "" {
		params.Set("record_line_id", string(record.LineID))
	}
	return true, c.dnspod(ctx, cfg, "Record.Modify", params, nil)
}
