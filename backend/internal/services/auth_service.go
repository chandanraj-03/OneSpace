package services

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"time"

	"onespace/backend/internal/config"
	"onespace/backend/internal/database"
	"onespace/backend/internal/models"
	"onespace/backend/internal/utils"

	"github.com/google/uuid"
)

type AuthService struct {
	cfg *config.Config
	db  *database.Database
}

var Auth *AuthService

func InitAuth(cfg *config.Config, db *database.Database) {
	Auth = &AuthService{cfg: cfg, db: db}
}

func (s *AuthService) CreateSession(userID string) (*models.AuthSession, string) {
	tokenBytes := make([]byte, 32)
	_, _ = rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	tokenHash := utils.Sha256(fmt.Sprintf("%s:%s", s.cfg.AuthSecret, token))
	now := time.Now()
	expiresAt := now.Add(time.Duration(s.cfg.AuthSessionTTLHours) * time.Hour)

	session := &models.AuthSession{
		ID:         uuid.NewString(),
		UserID:     userID,
		TokenHash:  tokenHash,
		ExpiresAt:  expiresAt,
		CreatedAt:  now,
		LastUsedAt: now,
	}

	s.db.CreateSession(session)
	return session, token
}

func (s *AuthService) ResolveSession(token string) *models.User {
	if token == "" {
		return nil
	}

	tokenHash := utils.Sha256(fmt.Sprintf("%s:%s", s.cfg.AuthSecret, token))
	session, user := s.db.GetSessionByTokenHash(tokenHash)
	if session == nil || user == nil {
		return nil
	}

	s.db.TouchSession(session.ID)
	return user
}

func (s *AuthService) DestroySession(token string) {
	if token == "" {
		return
	}
	tokenHash := utils.Sha256(fmt.Sprintf("%s:%s", s.cfg.AuthSecret, token))
	s.db.DeleteSessionByTokenHash(tokenHash)
}

func (s *AuthService) GetAuthSummary(user *models.User) map[string]interface{} {
	requiresAuth := s.cfg.AppMode == "hosted"
	var userSummary interface{} = nil

	if user != nil {
		userSummary = map[string]interface{}{
			"id":       user.ID,
			"email":    user.Email,
			"is_local": user.IsLocal == 1,
		}
	}

	return map[string]interface{}{
		"mode":          s.cfg.AppMode,
		"requiresAuth":  requiresAuth,
		"authenticated": user != nil,
		"user":          userSummary,
	}
}

func (s *AuthService) SetAuthCookie(w http.ResponseWriter, token string) {
	isProd := os.Getenv("NODE_ENV") == "production" || os.Getenv("RENDER") != ""
	sameSite := http.SameSiteLaxMode
	if isProd {
		sameSite = http.SameSiteNoneMode
	}

	maxAge := s.cfg.AuthSessionTTLHours * 3600

	cookie := &http.Cookie{
		Name:     s.cfg.AuthCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   isProd,
		SameSite: sameSite,
	}

	http.SetCookie(w, cookie)
}

func (s *AuthService) ClearAuthCookie(w http.ResponseWriter) {
	isProd := os.Getenv("NODE_ENV") == "production" || os.Getenv("RENDER") != ""
	sameSite := http.SameSiteLaxMode
	if isProd {
		sameSite = http.SameSiteNoneMode
	}

	cookie := &http.Cookie{
		Name:     s.cfg.AuthCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isProd,
		SameSite: sameSite,
	}

	http.SetCookie(w, cookie)
}
