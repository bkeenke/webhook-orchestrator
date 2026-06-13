package server

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"webhook-orchestrator/api"
	"webhook-orchestrator/auth"
	"webhook-orchestrator/config"
	"webhook-orchestrator/dispatcher"
	"webhook-orchestrator/matcher"
	"webhook-orchestrator/store"
)

//go:embed web/dist
var staticFiles embed.FS

const maxBody = 10 << 20 // 10 MB

type Server struct {
	store  *store.Store
	auth   *auth.Auth
	disp   *dispatcher.Dispatcher
	mux    *http.ServeMux
	logSeq atomic.Uint64
}

func New(st *store.Store, au *auth.Auth) *Server {
	s := &Server{
		store: st,
		auth:  au,
		disp:  dispatcher.New(st.Targets),
		mux:   http.NewServeMux(),
	}

	api.New(st, au).Register(s.mux)

	s.mux.HandleFunc("GET /api/logs", s.guard(s.handleGetLogs))
	s.mux.HandleFunc("GET /api/logs/filters", s.guard(s.handleGetLogFilters))
	s.mux.HandleFunc("GET /api/logs/{id}", s.guard(s.handleGetLog))
	s.mux.HandleFunc("DELETE /api/logs", s.guard(s.handleClearLogs))

	s.mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	staticSub, _ := fs.Sub(staticFiles, "web/dist")
	s.mux.HandleFunc("/", s.handleRoot(http.FileServer(http.FS(staticSub))))

	return s
}

func (s *Server) Start() error {
	cfg := s.store.ServerConfig()
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	slog.Info("starting webhook-orchestrator", "addr", addr)
	srv := &http.Server{
		Addr:         addr,
		Handler:      s.mux,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 90 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
	return srv.ListenAndServe()
}

func (s *Server) guard(fn http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.auth.IsAuthenticated(r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		fn(w, r)
	}
}

func (s *Server) handleRoot(static http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		for _, src := range s.store.Sources() {
			if src.Path == r.URL.Path {
				if len(src.Methods) > 0 && !methodAllowed(r.Method, src.Methods) {
					w.Header().Set("Allow", strings.Join(src.Methods, ", "))
					http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
					return
				}
				s.processWebhook(w, r, &src)
				return
			}
		}
		if strings.Contains(r.URL.Path, ".") && r.URL.Path != "/" {
			static.ServeHTTP(w, r)
			return
		}
		f, err := staticFiles.Open("web/dist/index.html")
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		defer f.Close()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.Copy(w, f)
	}
}

func (s *Server) processWebhook(w http.ResponseWriter, r *http.Request, src *config.Source) {
	clientIP := realIP(r)

	body, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}
	r.Body.Close()

	targetIDs := matcher.MatchSource(src, body)

	logID := s.nextID()
	reqHeaders := flattenHeaders(r.Header)
	s.store.InsertLog(store.LogEntry{
		ID:         logID,
		Timestamp:  time.Now().UTC(),
		Method:     r.Method,
		Path:       r.URL.Path,
		ClientIP:   clientIP,
		SourceName: src.Name,
		Headers:    reqHeaders,
		Body:       string(body),
		BodySize:   len(body),
		Targets:    targetIDs,
	})

	if len(targetIDs) == 0 {
		slog.Info("no matching rules", "source", src.Name, "ip", clientIP)
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true,"matched":0}`))
		return
	}

	slog.Info("routing", "source", src.Name, "targets", targetIDs, "ip", clientIP)

	onResp := func(targetID string, resp *dispatcher.Response, err error) {
		tr := store.TargetResponse{}
		if err != nil {
			tr.Error = err.Error()
		} else if resp != nil {
			tr.Status = resp.StatusCode
			body := string(resp.Body)
			if len(body) > 10*1024 {
				body = body[:10*1024]
			}
			tr.Body = body
		}
		s.store.AddLogTargetResponse(logID, targetID, tr)
	}

	resp := s.disp.Dispatch(r.Context(), targetIDs, r.Method, r.Header, body, clientIP, src.SyncResponse, onResp)

	if src.SyncResponse && resp != nil {
		hop := map[string]bool{"connection": true, "transfer-encoding": true, "keep-alive": true}
		for k, vals := range resp.Header {
			if hop[strings.ToLower(k)] {
				continue
			}
			for _, v := range vals {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		w.Write(resp.Body)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

func (s *Server) handleGetLogs(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 50)
	offset := queryInt(r, "offset", 0)
	terms := strings.Fields(r.URL.Query().Get("q"))
	source := r.URL.Query().Get("source")
	target := r.URL.Query().Get("target")

	page, err := s.store.GetLogs(limit, offset, terms, source, target)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(page)
}

func (s *Server) handleGetLogFilters(w http.ResponseWriter, r *http.Request) {
	f, err := s.store.GetLogFilters()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(f)
}

func (s *Server) handleGetLog(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	entry, err := s.store.GetLog(id)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entry)
}

func (s *Server) handleClearLogs(w http.ResponseWriter, _ *http.Request) {
	if err := s.store.ClearLogs(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) nextID() string {
	n := s.logSeq.Add(1)
	return fmt.Sprintf("%d-%d", time.Now().UnixNano(), n)
}

func realIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return strings.TrimSpace(ip)
	}
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return strings.TrimSpace(strings.SplitN(fwd, ",", 2)[0])
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	return ip
}

func flattenHeaders(h http.Header) map[string]string {
	out := make(map[string]string, len(h))
	for k, vals := range h {
		out[k] = strings.Join(vals, ", ")
	}
	return out
}

func methodAllowed(method string, allowed []string) bool {
	for _, m := range allowed {
		if strings.EqualFold(m, method) {
			return true
		}
	}
	return false
}

func queryInt(r *http.Request, key string, def int) int {
	if v := r.URL.Query().Get(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}
