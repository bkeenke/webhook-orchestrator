package main

import (
	"bufio"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"webhook-orchestrator/auth"
	"webhook-orchestrator/server"
	"webhook-orchestrator/store"
)

func main() {
	loadDotEnv(".env")

	adminUser := getEnv("ADMIN_USER", "admin")
	adminPass := getEnv("ADMIN_PASSWORD", "")
	if adminPass == "" {
		slog.Error("ADMIN_PASSWORD is not set — set it in .env or as an environment variable")
		os.Exit(1)
	}

	dsn := getEnv("DATABASE_URL", "data/orchestrator.db")
	port := 8080

	st, err := store.Open(dsn, port)
	if err != nil {
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}

	au := auth.New(adminUser, adminPass)
	srv := server.New(st, au)

	if days, err := strconv.Atoi(getEnv("LOG_RETENTION_DAYS", "0")); err == nil && days > 0 {
		slog.Info("log retention enabled", "days", days)
		st.DeleteOldLogs(days)
		go func() {
			for range time.Tick(6 * time.Hour) {
				st.DeleteOldLogs(days)
			}
		}()
	}

	errCh := make(chan error, 1)
	go func() { errCh <- srv.Start() }()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		slog.Error("server error", "error", err)
		os.Exit(1)
	case sig := <-quit:
		slog.Info("shutdown", "signal", sig)
	}
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		if os.Getenv(k) == "" {
			os.Setenv(k, v)
		}
	}
	_ = sc.Err()
}
