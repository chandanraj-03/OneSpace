package middleware

import (
	"net/http"
	"strings"

	"onespace/backend/internal/config"

	"github.com/go-chi/cors"
)

func NewCORS(cfg *config.Config) func(next http.Handler) http.Handler {
	return cors.Handler(cors.Options{
		AllowOriginFunc: func(r *http.Request, origin string) bool {
			if origin == "" {
				return true
			}
			if origin == cfg.CorsOrigin || origin == cfg.FrontendURL {
				return true
			}
			if origin == "http://localhost:5173" || origin == "http://localhost:4173" || origin == "http://127.0.0.1:5173" {
				return true
			}
			if strings.HasSuffix(origin, ".onrender.com") || strings.HasSuffix(origin, ".vercel.app") {
				return true
			}
			return true
		},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-Session-Token"},
		ExposedHeaders:   []string{"Link", "Set-Cookie"},
		AllowCredentials: true,
		MaxAge:           300,
	})
}
