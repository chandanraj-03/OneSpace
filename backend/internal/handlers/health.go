package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"onespace/backend/internal/config"
	"onespace/backend/internal/database"
	"onespace/backend/internal/middleware"
	"onespace/backend/internal/services"
)

type HealthHandler struct {
	cfg *config.Config
	db  *database.Database
}

func NewHealthHandler(cfg *config.Config, db *database.Database) *HealthHandler {
	return &HealthHandler{cfg: cfg, db: db}
}

func (h *HealthHandler) Root(w http.ResponseWriter, r *http.Request) {
	if strings.Contains(r.Header.Get("Accept"), "text/html") {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OneSpace API &bull; Operational</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(17, 24, 39, 0.78);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent-gradient: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%);
      --text-main: #f9fafb;
      --text-muted: #9ca3af;
      --green: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      background: radial-gradient(circle at 50% 0%, #1e1b4b 0%, #090d16 70%);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .container {
      max-width: 540px;
      width: 100%;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 24px;
      padding: 36px;
      backdrop-filter: blur(16px);
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px -10px rgba(99, 102, 241, 0.15);
      text-align: center;
    }
    .badge-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 9999px;
      color: #34d399;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 10px var(--green);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { transform: scale(1); box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }
    h1 {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 8px;
      background: linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p.lead {
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 28px;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 28px;
    }
    @media (min-width: 480px) {
      .actions { flex-direction: row; }
    }
    .btn {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 18px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 14px;
      text-decoration: none;
      transition: all 0.2s ease;
    }
    .btn-primary {
      background: var(--accent-gradient);
      color: #fff;
      box-shadow: 0 4px 14px 0 rgba(99, 102, 241, 0.39);
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5);
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #e5e7eb;
    }
    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.2);
      transform: translateY(-2px);
    }
    .meta-card {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 14px;
      padding: 14px 18px;
      text-align: left;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #94a3b8;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    }
    .meta-row:last-child { border-bottom: none; }
    .meta-val { color: #f1f5f9; font-weight: 500; }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge-pill">
      <span class="pulse-dot"></span>
      Backend Service Operational (Go Native)
    </div>
    <h1>OneSpace API Server</h1>
    <p class="lead">The high-performance multi-cloud aggregator backend API is active and ready to service frontend requests.</p>
    
    <div class="actions">
      <a href="%s" class="btn btn-primary" target="_blank" rel="noopener">
        <span>Open OneSpace Web App</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>
      <a href="/api/health" class="btn btn-secondary">
        <span>View /api/health</span>
      </a>
    </div>

    <div class="meta-card">
      <div class="meta-row"><span>Service:</span><span class="meta-val">onespace-api (Go)</span></div>
      <div class="meta-row"><span>Status:</span><span class="meta-val" style="color:#34d399">HTTP 200 OK</span></div>
      <div class="meta-row"><span>App Mode:</span><span class="meta-val">%s</span></div>
      <div class="meta-row"><span>Frontend:</span><span class="meta-val">%s</span></div>
    </div>
  </div>
</body>
</html>`, h.cfg.FrontendURL, h.cfg.AppMode, h.cfg.FrontendURL)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"service":   "onespace-api",
		"runtime":   "go",
		"status":    "ok",
		"message":   "OneSpace API backend is active and healthy.",
		"mode":      h.cfg.AppMode,
		"frontend":  h.cfg.FrontendURL,
		"health":    "/api/health",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *HealthHandler) Health(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())

	authSummary := map[string]interface{}{}
	if services.Auth != nil {
		authSummary = services.Auth.GetAuthSummary(user)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "ok",
		"service":   "onespace-api",
		"runtime":   "go",
		"config":    h.cfg.Redact(),
		"auth":      authSummary,
		"sync":      map[string]interface{}{"lastRunAt": nil, "isRunning": false},
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *HealthHandler) NotFound(w http.ResponseWriter, r *http.Request) {
	if strings.Contains(r.Header.Get("Accept"), "text/html") {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprintf(w, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>404 Not Found &bull; OneSpace API</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #090d16; color: #f9fafb; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { text-align: center; max-width: 440px; padding: 32px; background: rgba(17, 24, 39, 0.8); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; }
    h2 { margin: 0 0 8px; font-size: 20px; }
    p { color: #9ca3af; font-size: 14px; margin-bottom: 20px; word-break: break-all; }
    a { color: #818cf8; text-decoration: none; font-weight: 600; font-size: 14px; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <h2>404 &bull; Route Not Found</h2>
    <p>Endpoint <code>%s</code> does not exist on this API server.</p>
    <a href="/">&larr; Return to API Home</a>
  </div>
</body>
</html>`, r.URL.Path)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotFound)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"error":    "Not Found",
		"message":  fmt.Sprintf("Cannot %s %s", r.Method, r.URL.Path),
		"health":   "/api/health",
		"frontend": h.cfg.FrontendURL,
	})
}
