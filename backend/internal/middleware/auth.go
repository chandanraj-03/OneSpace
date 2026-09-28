package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"onespace/backend/internal/config"
	"onespace/backend/internal/database"
	"onespace/backend/internal/models"
	"onespace/backend/internal/services"
)

type contextKey string

const (
	UserContextKey contextKey = "currentUser"
)

func AttachAuthContext(cfg *config.Config, db *database.Database) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if cfg.AppMode == "local" {
				localUser := db.GetUserByID(database.LocalUserID)
				ctx := context.WithValue(r.Context(), UserContextKey, localUser)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			var token string
			if cookie, err := r.Cookie(cfg.AuthCookieName); err == nil {
				token = cookie.Value
			}
			if token == "" {
				authHeader := r.Header.Get("Authorization")
				if strings.HasPrefix(authHeader, "Bearer ") {
					token = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
				} else if custom := r.Header.Get("X-Session-Token"); custom != "" {
					token = strings.TrimSpace(custom)
				} else if queryToken := r.URL.Query().Get("token"); queryToken != "" {
					token = strings.TrimSpace(queryToken)
				}
			}

			var user *models.User
			if token != "" && services.Auth != nil {
				user = services.Auth.ResolveSession(token)
			}

			ctx := context.WithValue(r.Context(), UserContextKey, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireAppUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, _ := r.Context().Value(UserContextKey).(*models.User)
		if user == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error": "Authentication required",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func GetUserFromContext(ctx context.Context) *models.User {
	user, _ := ctx.Value(UserContextKey).(*models.User)
	return user
}
