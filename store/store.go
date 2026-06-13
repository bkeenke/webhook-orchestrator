package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"

	_ "github.com/lib/pq"

	"webhook-orchestrator/config"
)

type TargetResponse struct {
	Status int    `json:"status"`
	Body   string `json:"body"`
	Error  string `json:"error,omitempty"`
}

type LogEntry struct {
	ID              string                    `json:"id"`
	Timestamp       time.Time                 `json:"timestamp"`
	Method          string                    `json:"method"`
	Path            string                    `json:"path"`
	ClientIP        string                    `json:"client_ip"`
	SourceName      string                    `json:"source_name"`
	Headers         map[string]string         `json:"headers"`
	Body            string                    `json:"body"`
	BodySize        int                       `json:"body_size"`
	Targets         []string                  `json:"targets"`
	TargetResponses map[string]TargetResponse `json:"target_responses"`
}

type LogSummary struct {
	ID         string    `json:"id"`
	Timestamp  time.Time `json:"timestamp"`
	Method     string    `json:"method"`
	Path       string    `json:"path"`
	ClientIP   string    `json:"client_ip"`
	SourceName string    `json:"source_name"`
	BodySize   int       `json:"body_size"`
	Targets    []string  `json:"targets"`
}

type LogsPage struct {
	Total int          `json:"total"`
	Items []LogSummary `json:"items"`
}

type LogFilters struct {
	Sources []string `json:"sources"`
	Targets []string `json:"targets"`
}

type Store struct {
	db   *sql.DB
	port int

	mu      sync.RWMutex
	sources []config.Source
	targets []config.Target
}

func Open(dsn string, port int) (*Store, error) {
	dsn = normalizeDSN(dsn)

	sqlDB, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	s := &Store{db: sqlDB, port: port}

	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	if err := s.loadCache(); err != nil {
		return nil, fmt.Errorf("load cache: %w", err)
	}
	slog.Info("database ready", "dsn", dsn)
	return s, nil
}

func (s *Store) ServerConfig() config.ServerConfig {
	return config.ServerConfig{Host: "0.0.0.0", Port: s.port}
}

func (s *Store) Sources() []config.Source {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]config.Source, len(s.sources))
	copy(out, s.sources)
	return out
}

func (s *Store) Targets() []config.Target {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]config.Target, len(s.targets))
	copy(out, s.targets)
	return out
}

func (s *Store) SetSource(src config.Source) error {
	if src.ID == "" {
		src.ID = newID()
	}
	for i := range src.Rules {
		if src.Rules[i].ID == "" {
			src.Rules[i].ID = newID()
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	mjson, _ := json.Marshal(src.Methods)
	_, err = tx.Exec(s.q(`
		INSERT INTO sources (id, name, path, methods, sync_response, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET
			name=excluded.name, path=excluded.path, methods=excluded.methods,
			sync_response=excluded.sync_response, updated_at=excluded.updated_at
	`), src.ID, src.Name, src.Path, string(mjson), boolInt(src.SyncResponse), now, now)
	if err != nil {
		return fmt.Errorf("upsert source: %w", err)
	}

	if _, err := tx.Exec(s.q(`DELETE FROM rules WHERE source_id = ?`), src.ID); err != nil {
		return err
	}
	for i, rule := range src.Rules {
		tjson, _ := json.Marshal(rule.TargetIDs)
		cjson, _ := json.Marshal(rule.Conditions)
		_, err := tx.Exec(s.q(`
			INSERT INTO rules (id, source_id, name, logic, position, targets, conditions)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`), rule.ID, src.ID, rule.Name, rule.Logic, i, string(tjson), string(cjson))
		if err != nil {
			return fmt.Errorf("insert rule: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for i, existing := range s.sources {
		if existing.ID == src.ID {
			s.sources[i] = src
			return nil
		}
	}
	s.sources = append(s.sources, src)
	return nil
}

func (s *Store) DeleteSource(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(s.q(`DELETE FROM rules WHERE source_id = ?`), id); err != nil {
		return err
	}
	res, err := tx.Exec(s.q(`DELETE FROM sources WHERE id = ?`), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("source %q not found", id)
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for i, src := range s.sources {
		if src.ID == id {
			s.sources = append(s.sources[:i], s.sources[i+1:]...)
			return nil
		}
	}
	return nil
}

func (s *Store) SetTarget(tgt config.Target) error {
	if tgt.ID == "" {
		return fmt.Errorf("target id is required")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	hjson, _ := json.Marshal(tgt.Headers)
	sjson, _ := json.Marshal(tgt.Retry.DisableOnStatusCodes)
	bjson, _ := json.Marshal(tgt.Retry.DisableOnBodyContains)

	_, err := s.db.Exec(s.q(`
		INSERT INTO targets (
			id, url, timeout, forward_ip, is_primary, headers,
			retry_enabled, retry_max_attempts, retry_interval, retry_backoff,
			retry_disable_on_status, retry_disable_on_body_contains,
			created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET
			url=excluded.url, timeout=excluded.timeout,
			forward_ip=excluded.forward_ip, is_primary=excluded.is_primary,
			headers=excluded.headers,
			retry_enabled=excluded.retry_enabled,
			retry_max_attempts=excluded.retry_max_attempts,
			retry_interval=excluded.retry_interval,
			retry_backoff=excluded.retry_backoff,
			retry_disable_on_status=excluded.retry_disable_on_status,
			retry_disable_on_body_contains=excluded.retry_disable_on_body_contains,
			updated_at=excluded.updated_at
	`),
		tgt.ID, tgt.URL, tgt.Timeout,
		boolInt(tgt.ForwardIP), boolInt(tgt.Primary), string(hjson),
		boolInt(tgt.Retry.Enabled), tgt.Retry.MaxAttempts,
		tgt.Retry.Interval, tgt.Retry.Backoff,
		string(sjson), string(bjson),
		now, now,
	)
	if err != nil {
		return fmt.Errorf("upsert target: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for i, existing := range s.targets {
		if existing.ID == tgt.ID {
			s.targets[i] = tgt
			return nil
		}
	}
	s.targets = append(s.targets, tgt)
	return nil
}

func (s *Store) DeleteTarget(id string) error {
	res, err := s.db.Exec(s.q(`DELETE FROM targets WHERE id = ?`), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("target %q not found", id)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for i, tgt := range s.targets {
		if tgt.ID == id {
			s.targets = append(s.targets[:i], s.targets[i+1:]...)
			return nil
		}
	}
	return nil
}

func (s *Store) InsertLog(e LogEntry) error {
	tjson, _ := json.Marshal(e.Targets)
	hjson, _ := json.Marshal(e.Headers)
	_, err := s.db.Exec(s.q(`
		INSERT INTO request_logs (id, ts, method, path, client_ip, source_name, headers, body, body_size, matched_targets, target_responses)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
	`),
		e.ID, e.Timestamp.UTC().Format(time.RFC3339Nano),
		e.Method, e.Path, e.ClientIP, e.SourceName,
		string(hjson), e.Body, e.BodySize, string(tjson), "{}",
	)
	return err
}

func (s *Store) AddLogTargetResponse(logID, targetID string, tr TargetResponse) {
	data, _ := json.Marshal(tr)
	s.db.Exec(s.q(`
		UPDATE request_logs
		SET target_responses = target_responses || jsonb_build_object(?::text, ?::jsonb)
		WHERE id = ?
	`), targetID, string(data), logID) //nolint:errcheck
}

func (s *Store) GetLogs(limit, offset int, terms []string, source, target string) (LogsPage, error) {
	if limit <= 0 || limit > 1000 {
		limit = 50
	}

	where, filterArgs := s.buildSearchWhere(terms, source, target)

	var total int
	if err := s.db.QueryRow(s.q("SELECT COUNT(*) FROM request_logs"+where), filterArgs...).Scan(&total); err != nil {
		return LogsPage{}, err
	}

	queryArgs := append(filterArgs, limit, offset)
	rows, err := s.db.Query(s.q("SELECT id, ts, method, path, client_ip, source_name, body_size, matched_targets FROM request_logs"+where+" ORDER BY ts DESC LIMIT ? OFFSET ?"), queryArgs...)
	if err != nil {
		return LogsPage{}, err
	}
	defer rows.Close()

	items := []LogSummary{}
	for rows.Next() {
		var e LogSummary
		var ts, tjson string
		if err := rows.Scan(&e.ID, &ts, &e.Method, &e.Path, &e.ClientIP, &e.SourceName, &e.BodySize, &tjson); err != nil {
			return LogsPage{}, err
		}
		e.Timestamp, _ = time.Parse(time.RFC3339Nano, ts)
		json.Unmarshal([]byte(tjson), &e.Targets)
		items = append(items, e)
	}
	if err := rows.Err(); err != nil {
		return LogsPage{}, err
	}
	return LogsPage{Total: total, Items: items}, nil
}

func (s *Store) buildSearchWhere(terms []string, source, target string) (string, []interface{}) {
	var parts []string
	var args []interface{}
	for _, term := range terms {
		parts = append(parts, "body ILIKE ?")
		args = append(args, "%"+term+"%")
	}
	if source != "" {
		parts = append(parts, "source_name = ?")
		args = append(args, source)
	}
	if target != "" {
		parts = append(parts, "matched_targets::jsonb @> to_jsonb(?::text)")
		args = append(args, target)
	}
	if len(parts) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(parts, " AND "), args
}

func (s *Store) GetLogFilters() (LogFilters, error) {
	f := LogFilters{Sources: []string{}, Targets: []string{}}

	rows, err := s.db.Query(`SELECT DISTINCT source_name FROM request_logs WHERE source_name != '' ORDER BY source_name`)
	if err != nil {
		return f, err
	}
	defer rows.Close()
	for rows.Next() {
		var v string
		rows.Scan(&v)
		f.Sources = append(f.Sources, v)
	}

	rows2, err := s.db.Query(`SELECT DISTINCT jsonb_array_elements_text(matched_targets::jsonb) AS t FROM request_logs WHERE matched_targets != '[]' AND jsonb_typeof(matched_targets::jsonb) = 'array' ORDER BY t`)
	if err != nil {
		return f, err
	}
	defer rows2.Close()
	for rows2.Next() {
		var v string
		rows2.Scan(&v)
		f.Targets = append(f.Targets, v)
	}

	return f, nil
}

func (s *Store) GetLog(id string) (*LogEntry, error) {
	var e LogEntry
	var ts, hjson, tjson, trjson string
	err := s.db.QueryRow(s.q(`
		SELECT id, ts, method, path, client_ip, source_name, headers, body, body_size, matched_targets, target_responses
		FROM request_logs WHERE id = ?
	`), id).Scan(&e.ID, &ts, &e.Method, &e.Path, &e.ClientIP, &e.SourceName, &hjson, &e.Body, &e.BodySize, &tjson, &trjson)
	if err != nil {
		return nil, err
	}
	e.Timestamp, _ = time.Parse(time.RFC3339Nano, ts)
	json.Unmarshal([]byte(hjson), &e.Headers)
	json.Unmarshal([]byte(tjson), &e.Targets)
	json.Unmarshal([]byte(trjson), &e.TargetResponses)
	return &e, nil
}

func (s *Store) ClearLogs() error {
	_, err := s.db.Exec(`DELETE FROM request_logs`)
	return err
}

func (s *Store) DeleteOldLogs(days int) error {
	if days <= 0 {
		return nil
	}
	res, err := s.db.Exec(s.q(`DELETE FROM request_logs WHERE ts < ?`),
		time.Now().UTC().AddDate(0, 0, -days).Format(time.RFC3339Nano))
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		slog.Info("log retention cleanup", "deleted", n, "days", days)
	}
	return err
}

var schemaStatements = []string{
	`CREATE TABLE IF NOT EXISTS sources (
		id          TEXT PRIMARY KEY,
		name        TEXT NOT NULL DEFAULT '',
		path        TEXT NOT NULL DEFAULT '',
		sync_response INTEGER NOT NULL DEFAULT 0,
		created_at  TEXT NOT NULL DEFAULT '',
		updated_at  TEXT NOT NULL DEFAULT ''
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_path ON sources(path)`,

	`CREATE TABLE IF NOT EXISTS rules (
		id         TEXT PRIMARY KEY,
		source_id  TEXT NOT NULL,
		name       TEXT NOT NULL DEFAULT '',
		logic      TEXT NOT NULL DEFAULT 'AND',
		position   INTEGER NOT NULL DEFAULT 0,
		targets    TEXT NOT NULL DEFAULT '[]',
		conditions TEXT NOT NULL DEFAULT '[]'
	)`,
	`CREATE INDEX IF NOT EXISTS idx_rules_source_id ON rules(source_id)`,

	`CREATE TABLE IF NOT EXISTS targets (
		id                           TEXT PRIMARY KEY,
		url                          TEXT NOT NULL DEFAULT '',
		timeout                      TEXT NOT NULL DEFAULT '30s',
		forward_ip                   INTEGER NOT NULL DEFAULT 0,
		is_primary                   INTEGER NOT NULL DEFAULT 0,
		headers                      TEXT NOT NULL DEFAULT '{}',
		retry_enabled                INTEGER NOT NULL DEFAULT 0,
		retry_max_attempts           INTEGER NOT NULL DEFAULT 3,
		retry_interval               TEXT NOT NULL DEFAULT '60s',
		retry_backoff                TEXT NOT NULL DEFAULT 'fixed',
		retry_disable_on_status      TEXT NOT NULL DEFAULT '[]',
		retry_disable_on_body_contains TEXT NOT NULL DEFAULT '[]',
		created_at                   TEXT NOT NULL DEFAULT '',
		updated_at                   TEXT NOT NULL DEFAULT ''
	)`,

	`CREATE TABLE IF NOT EXISTS request_logs (
		id           TEXT PRIMARY KEY,
		ts           TEXT NOT NULL,
		method       TEXT NOT NULL DEFAULT '',
		path         TEXT NOT NULL DEFAULT '',
		client_ip    TEXT NOT NULL DEFAULT '',
		source_name  TEXT NOT NULL DEFAULT '',
		headers      TEXT NOT NULL DEFAULT '{}',
		body         TEXT NOT NULL DEFAULT '',
		body_size    INTEGER NOT NULL DEFAULT 0,
		matched_targets TEXT NOT NULL DEFAULT '[]'
	)`,
	`CREATE INDEX IF NOT EXISTS idx_request_logs_ts ON request_logs(ts)`,
}

func (s *Store) migrate() error {
	for _, stmt := range schemaStatements {
		if _, err := s.db.Exec(stmt); err != nil {
			short := stmt
			if len(short) > 60 {
				short = short[:60] + "..."
			}
			return fmt.Errorf("migrate %q: %w", short, err)
		}
	}
	s.tryExec(`ALTER TABLE sources ADD COLUMN IF NOT EXISTS methods TEXT NOT NULL DEFAULT '[]'`)
	s.tryExec(`ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS headers TEXT NOT NULL DEFAULT '{}'`)
	s.tryExec(`ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS body TEXT NOT NULL DEFAULT ''`)
	s.tryExec(`ALTER TABLE request_logs ADD COLUMN IF NOT EXISTS target_responses JSONB NOT NULL DEFAULT '{}'`)
	return nil
}

func (s *Store) tryExec(stmt string) {
	s.db.Exec(stmt) //nolint:errcheck
}

func (s *Store) loadCache() error {
	srcs, err := s.dbSources()
	if err != nil {
		return err
	}
	tgts, err := s.dbTargets()
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.sources = srcs
	s.targets = tgts
	s.mu.Unlock()
	return nil
}

func (s *Store) dbSources() ([]config.Source, error) {
	rows, err := s.db.Query(`SELECT id, name, path, methods, sync_response FROM sources ORDER BY created_at, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []config.Source
	for rows.Next() {
		var src config.Source
		var sr int
		var mjson string
		if err := rows.Scan(&src.ID, &src.Name, &src.Path, &mjson, &sr); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(mjson), &src.Methods)
		src.SyncResponse = sr == 1
		rules, err := s.dbRules(src.ID)
		if err != nil {
			return nil, err
		}
		src.Rules = rules
		out = append(out, src)
	}
	return out, rows.Err()
}

func (s *Store) dbRules(sourceID string) ([]config.Rule, error) {
	rows, err := s.db.Query(s.q(`
		SELECT id, name, logic, targets, conditions
		FROM rules WHERE source_id = ? ORDER BY position, id
	`), sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []config.Rule
	for rows.Next() {
		var r config.Rule
		var tjson, cjson string
		if err := rows.Scan(&r.ID, &r.Name, &r.Logic, &tjson, &cjson); err != nil {
			return nil, err
		}
		json.Unmarshal([]byte(tjson), &r.TargetIDs)
		json.Unmarshal([]byte(cjson), &r.Conditions)
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) dbTargets() ([]config.Target, error) {
	rows, err := s.db.Query(`
		SELECT id, url, timeout, forward_ip, is_primary, headers,
		       retry_enabled, retry_max_attempts, retry_interval, retry_backoff,
		       retry_disable_on_status, retry_disable_on_body_contains
		FROM targets ORDER BY created_at, id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []config.Target
	for rows.Next() {
		var t config.Target
		var fwdIP, isPrimary, retryEnabled int
		var hjson, sjson, bjson string
		if err := rows.Scan(
			&t.ID, &t.URL, &t.Timeout, &fwdIP, &isPrimary, &hjson,
			&retryEnabled, &t.Retry.MaxAttempts, &t.Retry.Interval, &t.Retry.Backoff,
			&sjson, &bjson,
		); err != nil {
			return nil, err
		}
		t.ForwardIP = fwdIP == 1
		t.Primary = isPrimary == 1
		t.Retry.Enabled = retryEnabled == 1
		json.Unmarshal([]byte(hjson), &t.Headers)
		json.Unmarshal([]byte(sjson), &t.Retry.DisableOnStatusCodes)
		json.Unmarshal([]byte(bjson), &t.Retry.DisableOnBodyContains)
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) q(query string) string {
	i := 0
	return regexp.MustCompile(`\?`).ReplaceAllStringFunc(query, func(_ string) string {
		i++
		return fmt.Sprintf("$%d", i)
	})
}

func normalizeDSN(dsn string) string {
	if !strings.Contains(dsn, "sslmode=") {
		if strings.Contains(dsn, "?") {
			dsn += "&sslmode=disable"
		} else {
			dsn += "?sslmode=disable"
		}
	}
	return dsn
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}
