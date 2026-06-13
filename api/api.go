package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"webhook-orchestrator/auth"
	"webhook-orchestrator/config"
	"webhook-orchestrator/store"
)

type Handler struct {
	store *store.Store
	auth  *auth.Auth
}

func New(s *store.Store, a *auth.Auth) *Handler {
	return &Handler{store: s, auth: a}
}

func (h *Handler) Register(mux *http.ServeMux) {
	// public
	mux.HandleFunc("POST /auth/login", h.login)
	mux.HandleFunc("POST /auth/logout", h.logout)

	// protected
	mux.HandleFunc("GET /api/me", h.guard(h.me))

	mux.HandleFunc("GET /api/sources", h.guard(h.listSources))
	mux.HandleFunc("POST /api/sources", h.guard(h.upsertSource))
	mux.HandleFunc("PUT /api/sources/", h.guard(h.upsertSource))
	mux.HandleFunc("DELETE /api/sources/", h.guard(h.deleteSource))

	mux.HandleFunc("GET /api/targets", h.guard(h.listTargets))
	mux.HandleFunc("POST /api/targets", h.guard(h.upsertTarget))
	mux.HandleFunc("PUT /api/targets/", h.guard(h.upsertTarget))
	mux.HandleFunc("DELETE /api/targets/", h.guard(h.deleteTarget))
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		User string `json:"user"`
		Pass string `json:"pass"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	token, ok := h.auth.Login(body.User, body.Pass)
	if !ok {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	h.auth.SetCookie(w, token)
	writeJSON(w, map[string]bool{"ok": true})
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	h.auth.Logout(h.auth.TokenFromRequest(r))
	h.auth.ClearCookie(w)
	writeJSON(w, map[string]bool{"ok": true})
}

func (h *Handler) me(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, map[string]bool{"authed": true})
}

func (h *Handler) listSources(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, h.store.Sources())
}

func (h *Handler) upsertSource(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/sources/")
	if id == "/api/sources" || id == "" {
		id = ""
	}

	var src config.Source
	if err := json.NewDecoder(r.Body).Decode(&src); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if id != "" {
		src.ID = id
	}
	if err := h.store.SetSource(src); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		status = http.StatusCreated
	}
	w.WriteHeader(status)
	writeJSON(w, src)
}

func (h *Handler) deleteSource(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/sources/")
	if err := h.store.DeleteSource(id); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) listTargets(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, h.store.Targets())
}

func (h *Handler) upsertTarget(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/targets/")
	if id == "/api/targets" || id == "" {
		id = ""
	}

	var tgt config.Target
	if err := json.NewDecoder(r.Body).Decode(&tgt); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if id != "" {
		tgt.ID = id
	}
	if tgt.ID == "" {
		http.Error(w, "target id is required", http.StatusBadRequest)
		return
	}
	if err := h.store.SetTarget(tgt); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		status = http.StatusCreated
	}
	w.WriteHeader(status)
	writeJSON(w, tgt)
}

func (h *Handler) deleteTarget(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/targets/")
	if err := h.store.DeleteTarget(id); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) guard(fn http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !h.auth.IsAuthenticated(r) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		fn(w, r)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
