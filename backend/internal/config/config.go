package config

import (
	"crypto/sha256"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port                int
	AppMode             string
	CorsOrigin          string
	FrontendURL         string
	MongoDBURI          string
	AuthSecret          string
	AuthCookieName      string
	AuthSessionTTLHours int
	SyncIntervalMinutes int
	GoogleClientID      string
	GoogleClientSecret  string
	GoogleRedirectURI   string
	DropboxClientID     string
	DropboxClientSecret string
	DropboxRedirectURI  string
	EncryptionKey       []byte
}

var AppConfig *Config

func LoadConfig() *Config {
	// Try loading .env from current directory, parent directory, or root
	_ = godotenv.Load(".env", "../.env", "../../.env")

	portStr := getEnv("PORT", "8787")
	port, err := strconv.Atoi(portStr)
	if err != nil {
		port = 8787
	}

	sessionTTLStr := getEnv("AUTH_SESSION_TTL_HOURS", "336")
	sessionTTL, err := strconv.Atoi(sessionTTLStr)
	if err != nil {
		sessionTTL = 336
	}

	syncIntervalStr := getEnv("SYNC_INTERVAL_MINUTES", "5")
	syncInterval, err := strconv.Atoi(syncIntervalStr)
	if err != nil {
		syncInterval = 5
	}

	appMode := getEnv("APP_MODE", "hosted")
	if appMode != "hosted" && appMode != "local" {
		appMode = "hosted"
	}

	corsOrigin := getEnv("CORS_ORIGIN", "http://localhost:5173")
	frontendURL := getEnv("FRONTEND_URL", corsOrigin)

	authSecret := getEnv("AUTH_SECRET", "")
	if authSecret == "" {
		authSecret = getEnv("ONESPACE_SECRET_HALF", "onespace-dev-auth-secret")
	}

	envHalf := getEnv("ONESPACE_SECRET_HALF", "onespace-dev-secret-half")
	// Deterministic, persistent key derived from static environment secrets
	derivedMaterial := fmt.Sprintf("%s:%s", envHalf, authSecret)
	encKey := sha256.Sum256([]byte(derivedMaterial))

	AppConfig = &Config{
		Port:                port,
		AppMode:             appMode,
		CorsOrigin:          corsOrigin,
		FrontendURL:         frontendURL,
		MongoDBURI:          getEnv("MONGODB_URI", ""),
		AuthSecret:          authSecret,
		AuthCookieName:      getEnv("AUTH_COOKIE_NAME", "onespace_session"),
		AuthSessionTTLHours: sessionTTL,
		SyncIntervalMinutes: syncInterval,
		GoogleClientID:      getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:  getEnv("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirectURI:   getEnv("GOOGLE_REDIRECT_URI", "http://localhost:8787/api/accounts/google/callback"),
		DropboxClientID:     getEnv("DROPBOX_CLIENT_ID", ""),
		DropboxClientSecret: getEnv("DROPBOX_CLIENT_SECRET", ""),
		DropboxRedirectURI:  getEnv("DROPBOX_REDIRECT_URI", "http://localhost:8787/api/accounts/dropbox/callback"),
		EncryptionKey:       encKey[:],
	}

	return AppConfig
}

func (c *Config) Redact() map[string]interface{} {
	googleID := "[missing]"
	if c.GoogleClientID != "" {
		googleID = "[configured]"
	}
	dropboxID := "[missing]"
	if c.DropboxClientID != "" {
		dropboxID = "[configured]"
	}

	return map[string]interface{}{
		"port":                c.Port,
		"appMode":             c.AppMode,
		"corsOrigin":          c.CorsOrigin,
		"syncIntervalMinutes": c.SyncIntervalMinutes,
		"authCookieName":      c.AuthCookieName,
		"authSessionTtlHours": c.AuthSessionTTLHours,
		"frontendUrl":         c.FrontendURL,
		"googleClientId":      googleID,
		"googleRedirectUri":   c.GoogleRedirectURI,
		"dropboxClientId":     dropboxID,
		"dropboxRedirectUri":  c.DropboxRedirectURI,
	}
}

func getEnv(key, fallback string) string {
	val := os.Getenv(key)
	if strings.TrimSpace(val) == "" {
		return fallback
	}
	return strings.TrimSpace(val)
}
