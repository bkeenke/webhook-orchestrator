package dispatcher

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"

	"webhook-orchestrator/config"
)

type Response struct {
	StatusCode int
	Header     http.Header
	Body       []byte
}

type GetTargets func() []config.Target

type Dispatcher struct {
	getTargets GetTargets
	client     *http.Client
}

func New(getTargets GetTargets) *Dispatcher {
	return &Dispatcher{
		getTargets: getTargets,
		client: &http.Client{
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 5 {
					return http.ErrUseLastResponse
				}
				return nil
			},
		},
	}
}

func (d *Dispatcher) Dispatch(
	ctx context.Context,
	targetIDs []string,
	method string,
	inHeaders http.Header,
	body []byte,
	clientIP string,
	syncPrimary bool,
	onResponse func(targetID string, resp *Response, err error),
) *Response {
	if len(targetIDs) == 0 {
		return nil
	}

	primaryID := d.primaryID(targetIDs)
	var primaryResp *Response

	for _, id := range targetIDs {
		t := d.findTarget(id)
		if t == nil {
			slog.Warn("unknown target skipped", "id", id)
			continue
		}

		if id == primaryID && syncPrimary {
			resp, err := d.send(ctx, t, method, inHeaders, body, clientIP)
			if err != nil {
				slog.Error("deliver failed", "target", id, "error", err)
			} else {
				primaryResp = resp
			}
			if onResponse != nil {
				onResponse(id, resp, err)
			}
			if needsRetry(t, resp, err) {
				go d.retryLoop(t, method, inHeaders, body, clientIP)
			}
		} else {
			tCopy := *t
			go func() {
				resp, err := d.send(context.Background(), &tCopy, method, inHeaders, body, clientIP)
				if err != nil {
					slog.Error("deliver failed", "target", tCopy.ID, "error", err)
				}
				if onResponse != nil {
					onResponse(tCopy.ID, resp, err)
				}
				if needsRetry(&tCopy, resp, err) {
					d.retryLoop(&tCopy, method, inHeaders, body, clientIP)
				}
			}()
		}
	}

	return primaryResp
}

func (d *Dispatcher) send(
	ctx context.Context,
	t *config.Target,
	method string,
	inHeaders http.Header,
	body []byte,
	clientIP string,
) (*Response, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, t.TimeoutDuration())
	defer cancel()

	req, err := http.NewRequestWithContext(timeoutCtx, method, t.URL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	hop := hopHeaders()
	for k, vals := range inHeaders {
		if hop[strings.ToLower(k)] {
			continue
		}
		for _, v := range vals {
			req.Header.Add(k, v)
		}
	}

	if t.ForwardIP && clientIP != "" {
		if existing := req.Header.Get("X-Forwarded-For"); existing != "" {
			req.Header.Set("X-Forwarded-For", existing+", "+clientIP)
		} else {
			req.Header.Set("X-Forwarded-For", clientIP)
		}
		if req.Header.Get("X-Real-IP") == "" {
			req.Header.Set("X-Real-IP", clientIP)
		}
	}

	for k, v := range t.Headers {
		req.Header.Set(k, v)
	}

	resp, err := d.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}

	slog.Info("delivered", "target", t.ID, "status", resp.StatusCode, "bytes", len(respBody))

	return &Response{
		StatusCode: resp.StatusCode,
		Header:     resp.Header.Clone(),
		Body:       respBody,
	}, nil
}

func (d *Dispatcher) retryLoop(t *config.Target, method string, inHeaders http.Header, body []byte, clientIP string) {
	interval := t.Retry.IntervalDuration()
	max := t.Retry.MaxAttempts
	if max <= 0 {
		max = 3
	}

	for attempt := 1; attempt <= max; attempt++ {
		delay := interval
		if strings.EqualFold(t.Retry.Backoff, "exponential") {
			delay = time.Duration(float64(interval) * math.Pow(2, float64(attempt-1)))
		}

		slog.Info("retry scheduled", "target", t.ID, "attempt", attempt, "max", max, "delay", delay)
		time.Sleep(delay)

		fresh := d.findTarget(t.ID)
		if fresh == nil {
			slog.Warn("target removed, aborting retry", "id", t.ID)
			return
		}
		if !fresh.Retry.Enabled {
			slog.Info("retry disabled on target, aborting", "id", t.ID)
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), fresh.TimeoutDuration())
		resp, err := d.send(ctx, fresh, method, inHeaders, body, clientIP)
		cancel()

		if err != nil {
			slog.Error("retry failed", "target", t.ID, "attempt", attempt, "error", err)
			continue
		}
		if !needsRetry(fresh, resp, err) {
			slog.Info("retry succeeded", "target", t.ID, "attempt", attempt, "status", resp.StatusCode)
			return
		}
	}
	slog.Error("all retries exhausted", "target", t.ID, "attempts", max)
}

func (d *Dispatcher) findTarget(id string) *config.Target {
	for _, t := range d.getTargets() {
		if t.ID == id {
			tCopy := t
			return &tCopy
		}
	}
	return nil
}

func (d *Dispatcher) primaryID(ids []string) string {
	for _, id := range ids {
		if t := d.findTarget(id); t != nil && t.Primary {
			return id
		}
	}
	return ids[0]
}

func needsRetry(t *config.Target, resp *Response, err error) bool {
	if !t.Retry.Enabled || t.Retry.MaxAttempts <= 0 {
		return false
	}
	if err != nil {
		return true
	}
	if resp == nil {
		return true
	}
	for _, code := range t.Retry.DisableOnStatusCodes {
		if resp.StatusCode == code {
			return false
		}
	}
	for _, phrase := range t.Retry.DisableOnBodyContains {
		if strings.Contains(string(resp.Body), phrase) {
			return false
		}
	}
	return resp.StatusCode < 200 || resp.StatusCode >= 300
}

func hopHeaders() map[string]bool {
	return map[string]bool{
		"connection": true, "keep-alive": true,
		"proxy-authenticate": true, "proxy-authorization": true,
		"te": true, "trailers": true, "transfer-encoding": true, "upgrade": true,
	}
}
