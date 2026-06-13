package config

import "time"

type Config struct {
	Server  ServerConfig `json:"server"`
	Sources []Source     `json:"sources"`
	Targets []Target     `json:"targets"`
}

type ServerConfig struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

type Source struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Path         string   `json:"path"`
	Methods      []string `json:"methods"`
	SyncResponse bool     `json:"sync_response"`
	Rules        []Rule   `json:"rules"`
}

type Rule struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Logic      string      `json:"logic"`
	Conditions []Condition `json:"conditions"`
	TargetIDs  []string    `json:"targets"`
}

type Condition struct {
	Field    string   `json:"field"`
	AnyField []string `json:"any_field"`
	Op       string   `json:"op"`
	Value    string   `json:"value"`
	Values   []string `json:"values"`
}

type Target struct {
	ID        string            `json:"id"`
	URL       string            `json:"url"`
	Timeout   string            `json:"timeout"`
	Headers   map[string]string `json:"headers"`
	ForwardIP bool              `json:"forward_ip"`
	Primary   bool              `json:"primary"`
	Retry     RetryConfig       `json:"retry"`
}

type RetryConfig struct {
	Enabled               bool     `json:"enabled"`
	MaxAttempts           int      `json:"max_attempts"`
	Interval              string   `json:"interval"`
	Backoff               string   `json:"backoff"`
	DisableOnStatusCodes  []int    `json:"disable_on_status"`
	DisableOnBodyContains []string `json:"disable_on_body_contains"`
}

func (t *Target) TimeoutDuration() time.Duration {
	if d, err := time.ParseDuration(t.Timeout); err == nil {
		return d
	}
	return 30 * time.Second
}

func (r *RetryConfig) IntervalDuration() time.Duration {
	if d, err := time.ParseDuration(r.Interval); err == nil {
		return d
	}
	return 60 * time.Second
}
