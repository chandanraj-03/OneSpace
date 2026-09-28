package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"onespace/backend/internal/adapters"
	"onespace/backend/internal/config"
	"onespace/backend/internal/database"
	"onespace/backend/internal/middleware"
	"onespace/backend/internal/models"
	"onespace/backend/internal/services"
	"onespace/backend/internal/utils"

	"github.com/google/uuid"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	googleOauth2 "google.golang.org/api/oauth2/v2"
	"google.golang.org/api/option"
)

type AuthHandler struct {
	cfg *config.Config
	db  *database.Database
}

func NewAuthHandler(cfg *config.Config, db *database.Database) *AuthHandler {
	return &AuthHandler{cfg: cfg, db: db}
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())
	data := services.Auth.GetAuthSummary(user)
	if user != nil {
		if cookie, err := r.Cookie(h.cfg.AuthCookieName); err == nil && cookie.Value != "" {
			data["token"] = cookie.Value
		} else {
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				data["token"] = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
			} else if custom := r.Header.Get("X-Session-Token"); custom != "" {
				data["token"] = strings.TrimSpace(custom)
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": data,
	})
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": "Email and password registration is disabled to prevent fake accounts and spam sign-ups. Please sign up or sign in using Google.",
	})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": "Email and password authentication is disabled. Please sign in using Google.",
	})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	token := ""
	if cookie, err := r.Cookie(h.cfg.AuthCookieName); err == nil && cookie.Value != "" {
		token = cookie.Value
	}
	if token == "" {
		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
		} else if custom := r.Header.Get("X-Session-Token"); custom != "" {
			token = strings.TrimSpace(custom)
		}
	}
	if token != "" {
		services.Auth.DestroySession(token)
	}

	services.Auth.ClearAuthCookie(w)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": services.Auth.GetAuthSummary(nil),
	})
}

func (h *AuthHandler) getGoogleOAuth2Config() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     h.cfg.GoogleClientID,
		ClientSecret: h.cfg.GoogleClientSecret,
		RedirectURL:  h.cfg.GoogleRedirectURI,
		Scopes: []string{
			"openid",
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/userinfo.profile",
			"https://www.googleapis.com/auth/drive",
			"https://www.googleapis.com/auth/drive.metadata",
		},
		Endpoint: google.Endpoint,
	}
}

func (h *AuthHandler) GoogleURL(w http.ResponseWriter, r *http.Request) {
	state, err := utils.SignOAuthState(map[string]interface{}{
		"type":  "login",
		"nonce": uuid.NewString(),
	}, h.cfg.AuthSecret)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	conf := h.getGoogleOAuth2Config()
	authURL := conf.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.SetAuthURLParam("prompt", "consent select_account"))

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": map[string]string{
			"authorizationUrl": authURL,
			"state":            state,
			"redirectUri":      h.cfg.GoogleRedirectURI,
		},
	})
}

func (h *AuthHandler) GoogleRedirect(w http.ResponseWriter, r *http.Request) {
	state, err := utils.SignOAuthState(map[string]interface{}{
		"type":  "login",
		"nonce": uuid.NewString(),
	}, h.cfg.AuthSecret)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	conf := h.getGoogleOAuth2Config()
	authURL := conf.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.SetAuthURLParam("prompt", "consent select_account"))
	http.Redirect(w, r, authURL, http.StatusFound)
}

func (h *AuthHandler) GoogleCallback(w http.ResponseWriter, r *http.Request) {
	frontendURL, err := url.Parse(h.cfg.FrontendURL)
	if err != nil {
		frontendURL, _ = url.Parse("https://onespace-web.onrender.com")
	}
	frontendURL.Path = "/"

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	errParam := r.URL.Query().Get("error")

	if errParam != "" {
		frontendURL.Fragment = "login"
		q := frontendURL.Query()
		q.Set("error", errParam)
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}

	statePayload, err := utils.VerifyOAuthState(state, h.cfg.AuthSecret)
	if err != nil || statePayload == nil || statePayload["type"] != "login" {
		frontendURL.Fragment = "login"
		q := frontendURL.Query()
		q.Set("error", "Invalid or expired Google OAuth state")
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}

	ctx := context.Background()
	conf := h.getGoogleOAuth2Config()
	token, err := conf.Exchange(ctx, code)
	if err != nil {
		frontendURL.Fragment = "login"
		q := frontendURL.Query()
		q.Set("error", err.Error())
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}

	oauth2Service, err := googleOauth2.NewService(ctx, option.WithTokenSource(conf.TokenSource(ctx, token)))
	if err != nil {
		frontendURL.Fragment = "login"
		q := frontendURL.Query()
		q.Set("error", err.Error())
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}

	userInfo, err := oauth2Service.Userinfo.Get().Do()
	if err != nil || userInfo.Email == "" {
		frontendURL.Fragment = "login"
		q := frontendURL.Query()
		q.Set("error", "Unable to read email from Google profile")
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}

	email := strings.ToLower(strings.TrimSpace(userInfo.Email))
	user := h.db.GetUserByEmail(email)
	if user == nil {
		now := time.Now()
		user = &models.User{
			ID:        uuid.NewString(),
			Email:     email,
			IsLocal:   0,
			CreatedAt: now,
			UpdatedAt: now,
		}
		h.db.CreateUser(user)
	}

	_, sessionToken := services.Auth.CreateSession(user.ID)
	services.Auth.SetAuthCookie(w, sessionToken)

	// Automatically set Google account as the first linked cloud drive
	refreshToken := token.RefreshToken
	if refreshToken == "" {
		for _, ea := range h.db.ListCloudAccounts(user.ID) {
			if ea.Provider == "google_drive" && strings.ToLower(ea.Email) == email {
				var oldCreds adapters.GoogleDriveCredentials
				if err := utils.DecryptJSON(ea.EncryptedCredentials, h.cfg.EncryptionKey, &oldCreds); err == nil && oldCreds.RefreshToken != "" {
					refreshToken = oldCreds.RefreshToken
					break
				}
			}
		}
	}

	creds := adapters.GoogleDriveCredentials{
		ClientID:     h.cfg.GoogleClientID,
		ClientSecret: h.cfg.GoogleClientSecret,
		RedirectURI:  h.cfg.GoogleRedirectURI,
		RefreshToken: refreshToken,
		AccessToken:  token.AccessToken,
		ExpiryDate:   token.Expiry.UnixMilli(),
	}
	encCreds, _ := utils.EncryptJSON(creds, h.cfg.EncryptionKey)

	var totalSpace int64 = 15 * 1024 * 1024 * 1024
	var usedSpace int64 = 0
	if driveSrv, err := drive.NewService(ctx, option.WithTokenSource(conf.TokenSource(ctx, token))); err == nil {
		if about, err := driveSrv.About.Get().Fields("storageQuota").Context(ctx).Do(); err == nil && about.StorageQuota != nil {
			if about.StorageQuota.Limit > 0 {
				totalSpace = about.StorageQuota.Limit
			}
			usedSpace = about.StorageQuota.Usage
		}
	}

	now := time.Now()
	acc := &models.CloudAccount{
		ID:                   uuid.NewString(),
		UserID:               user.ID,
		Provider:             "google_drive",
		Email:                email,
		EncryptedCredentials: encCreds,
		TotalSpace:           totalSpace,
		UsedSpace:            usedSpace,
		Status:               "active",
		CreatedAt:            now,
		UpdatedAt:            now,
	}
	h.db.UpsertCloudAccount(acc)

	go func(uid string) {
		_, _ = services.Sync.RunDeltaSync(context.Background(), uid)
	}(user.ID)

	frontendURL.Fragment = fmt.Sprintf("home?token=%s", sessionToken)
	http.Redirect(w, r, frontendURL.String(), http.StatusFound)
}

