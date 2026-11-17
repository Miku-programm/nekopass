package ddns

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// aliyunEncode is the RFC 3986 percent-encoding required by RPC signature v1.
func aliyunEncode(value string) string {
	value = url.QueryEscape(value)
	value = strings.ReplaceAll(value, "+", "%20")
	value = strings.ReplaceAll(value, "*", "%2A")
	return strings.ReplaceAll(value, "%7E", "~")
}

func aliyunQuery(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for key := range params {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, aliyunEncode(key)+"="+aliyunEncode(params[key]))
	}
	return strings.Join(parts, "&")
}

func aliyunSign(secret, method, canonical string) string {
	mac := hmac.New(sha1.New, []byte(secret+"&"))
	mac.Write([]byte(method + "&" + aliyunEncode("/") + "&" + aliyunEncode(canonical)))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func (c *Client) aliyun(ctx context.Context, cfg Config, action string, params map[string]string, result any) error {
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return fatalError("阿里云请求签名失败")
	}
	query := map[string]string{
		"Action": action, "Format": "JSON", "Version": "2015-01-09", "AccessKeyId": cfg.KeyID,
		"SignatureMethod": "HMAC-SHA1", "SignatureVersion": "1.0", "SignatureNonce": hex.EncodeToString(nonce),
		"Timestamp": time.Now().UTC().Format("2006-01-02T15:04:05Z"),
	}
	for key, value := range params {
		query[key] = value
	}
	canonical := aliyunQuery(query)
	target := strings.TrimSuffix(c.AliyunBase, "/") + "/?" + canonical + "&Signature=" + aliyunEncode(aliyunSign(cfg.Token, "GET", canonical))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return fatalError("DNS 请求创建失败")
	}
	request.Header.Set("User-Agent", userAgent)
	response, err := c.API.Do(request)
	if err != nil {
		return fatalError("阿里云 DNS 连接失败")
	}
	defer response.Body.Close()
	data, ok := readLimited(response)
	if !ok {
		return fatalError("阿里云 DNS 响应无效")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct {
			Code string `json:"Code"`
		}
		json.Unmarshal(data, &failure)
		return aliyunError(response.StatusCode, failure.Code)
	}
	if result != nil && json.Unmarshal(data, result) != nil {
		return fatalError("阿里云 DNS 结果无效")
	}
	return nil
}

func aliyunError(status int, code string) error {
	switch {
	case strings.HasPrefix(code, "InvalidAccessKeyId"), code == "SignatureDoesNotMatch", code == "IncompleteSignature",
		strings.HasPrefix(code, "Forbidden"), code == "NoPermission", status == 401:
		return fatalError("阿里云 AccessKey 无效或权限不足")
	case strings.HasPrefix(code, "Throttling"), status == 429:
		return fatalError("阿里云请求过于频繁，稍后重试")
	case code == "SignatureNonceUsed", strings.HasPrefix(code, "InvalidTimeStamp"):
		return fatalError("阿里云请求时间或签名无效，请检查节点系统时间")
	}
	message := fmt.Sprintf("阿里云 DNS 操作失败（HTTP %d）", status)
	if code = safeCode(code); code != "" {
		message = fmt.Sprintf("阿里云 DNS 操作失败（%s）", code)
	}
	// Unknown or foreign domains surface as 4xx codes; let discovery try the parent.
	return &providerError{message: message, fatal: status >= 500}
}

func (c *Client) aliyunZone(ctx context.Context, cfg Config) (string, error) {
	if cfg.ZoneID != "" {
		return cfg.ZoneID, nil
	}
	for _, candidate := range zoneCandidates(cfg.RecordName) {
		var info struct {
			DomainName string `json:"DomainName"`
		}
		err := c.aliyun(ctx, cfg, "DescribeDomainInfo", map[string]string{"DomainName": candidate}, &info)
		if err == nil && strings.EqualFold(strings.TrimSuffix(info.DomainName, "."), candidate) {
			return candidate, nil
		}
		if err != nil && isFatal(err) {
			return "", err
		}
	}
	return "", errors.New("阿里云账号中找不到该域名，请填写主域名或检查 AccessKey 权限")
}

type aliyunRecord struct {
	RecordID string `json:"RecordId"`
	RR       string `json:"RR"`
	Type     string `json:"Type"`
	Value    string `json:"Value"`
	TTL      int    `json:"TTL"`
	Line     string `json:"Line"`
	Status   string `json:"Status"`
}

func (c *Client) aliyunSync(ctx context.Context, cfg Config, zone, kind, address string) (bool, error) {
	rr, ok := relativeName(cfg.RecordName, zone)
	if !ok {
		return false, errors.New("记录域名不属于所填主域名")
	}
	var listing struct {
		DomainRecords struct {
			Record []aliyunRecord `json:"Record"`
		} `json:"DomainRecords"`
	}
	if err := c.aliyun(ctx, cfg, "DescribeSubDomainRecords", map[string]string{"SubDomain": cfg.RecordName, "DomainName": zone, "Type": kind, "PageSize": "100"}, &listing); err != nil {
		return false, err
	}
	records := []aliyunRecord{}
	for _, record := range listing.DomainRecords.Record {
		if record.Type == kind && strings.EqualFold(record.RR, rr) {
			records = append(records, record)
		}
	}
	if len(records) > 1 {
		defaults := []aliyunRecord{}
		for _, record := range records {
			if record.Line == "" || record.Line == "default" {
				defaults = append(defaults, record)
			}
		}
		records = defaults
	}
	if len(records) > 1 {
		return false, errors.New("同名 DNS 记录有多条，请指定单条 A/AAAA 记录用于 DDNS")
	}
	ttl := providerTTL(cfg.TTL)
	params := map[string]string{"RR": rr, "Type": kind, "Value": address, "TTL": fmt.Sprint(ttl)}
	if len(records) == 0 {
		params["DomainName"] = zone
		return true, c.aliyun(ctx, cfg, "AddDomainRecord", params, nil)
	}
	record := records[0]
	if record.RecordID == "" || len(record.RecordID) > 64 {
		return false, errors.New("阿里云 DNS 记录不匹配")
	}
	if strings.EqualFold(record.Status, "DISABLE") {
		return false, errors.New("阿里云 DNS 记录已暂停，请先启用")
	}
	if record.Value == address && record.TTL == ttl {
		return false, nil
	}
	params["RecordId"] = record.RecordID
	if record.Line != "" {
		params["Line"] = record.Line
	}
	return true, c.aliyun(ctx, cfg, "UpdateDomainRecord", params, nil)
}
