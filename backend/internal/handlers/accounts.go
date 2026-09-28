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

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	googleOauth2 "google.golang.org/api/oauth2/v2"
	"google.golang.org/api/option"
)

type AccountHandler struct {
	cfg *config.Config
	db  *database.Database
}

func NewAccountHandler(cfg *config.Config, db *database.Database) *AccountHandler {
	return &AccountHandler{cfg: cfg, db: db}
}

func (h *AccountHandler) ListAccounts(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())
	accounts := h.db.ListCloudAccounts(user.ID)

	type accountItem struct {
		ID         string `json:"id"`
		Provider   string `json:"provider"`
		Email      string `json:"email"`
		TotalSpace int64  `json:"total_space"`
		UsedSpace  int64  `json:"used_space"`
		Status     string `json:"status"`
	}

	var data []accountItem
	for _, a := range accounts {
		data = append(data, accountItem{
			ID:         a.ID,
			Provider:   a.Provider,
			Email:      a.Email,
			TotalSpace: a.TotalSpace,
			UsedSpace:  a.UsedSpace,
			Status:     a.Status,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": data,
	})
}

func (h *AccountHandler) DisconnectAccount(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())
	accountID := chi.URLParam(r, "id")

	h.db.DeleteFilesByCloudAccount(user.ID, accountID)
	h.db.DeleteCloudAccount(user.ID, accountID)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": map[string]bool{"success": true},
	})
}

func (h *AccountHandler) GoogleStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": map[string]interface{}{
			"configured":  h.cfg.GoogleClientID != "" && h.cfg.GoogleClientSecret != "",
			"redirectUri": h.cfg.GoogleRedirectURI,
		},
	})
}

func (h *AccountHandler) GoogleConnect(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())

	state, err := utils.SignOAuthState(map[string]interface{}{
		"userId":   user.ID,
		"provider": "google_drive",
		"nonce":    uuid.NewString(),
	}, h.cfg.AuthSecret)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	conf := &oauth2.Config{
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

	authURL := conf.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.SetAuthURLParam("prompt", "consent"))

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": map[string]string{
			"authorizationUrl": authURL,
			"state":            state,
			"redirectUri":      h.cfg.GoogleRedirectURI,
		},
	})
}



func (h *AccountHandler) DropboxStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": map[string]interface{}{
			"configured":  h.cfg.DropboxClientID != "" && h.cfg.DropboxClientSecret != "",
			"redirectUri": h.cfg.DropboxRedirectURI,
		},
	})
}

func (h *AccountHandler) DropboxConnect(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())

	state, err := utils.SignOAuthState(map[string]interface{}{
		"userId":   user.ID,
		"provider": "dropbox",
		"nonce":    uuid.NewString(),
	}, h.cfg.AuthSecret)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	authURL := fmt.Sprintf("https://www.dropbox.com/oauth2/authorize?client_id=%s&response_type=code&redirect_uri=%s&token_access_type=offline&scope=account_info.read+files.metadata.read+files.content.read+files.content.write&state=%s",
		url.QueryEscape(h.cfg.DropboxClientID),
		url.QueryEscape(h.cfg.DropboxRedirectURI),
		url.QueryEscape(state),
	)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": map[string]string{
			"authorizationUrl": authURL,
			"state":            state,
			"redirectUri":      h.cfg.DropboxRedirectURI,
		},
	})
}

func (h *AccountHandler) MegaStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": map[string]interface{}{
			"configured": true,
		},
	})
}

func (h *AccountHandler) MegaConnect(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())

	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Email == "" || body.Password == "" {
		http.Error(w, "Email and password are required", http.StatusBadRequest)
		return
	}

	email := strings.ToLower(strings.TrimSpace(body.Email))
	creds := map[string]string{
		"email":    email,
		"password": body.Password,
	}
	encCreds, err := utils.EncryptJSON(creds, h.cfg.EncryptionKey)
	if err != nil {
		http.Error(w, "Failed to encrypt credentials", http.StatusInternalServerError)
		return
	}

	now := time.Now()
	acc := &models.CloudAccount{
		ID:                   uuid.NewString(),
		UserID:               user.ID,
		Provider:             "mega",
		Email:                email,
		EncryptedCredentials: encCreds,
		TotalSpace:           20 * 1024 * 1024 * 1024,
		UsedSpace:            0,
		Status:               "active",
		CreatedAt:            now,
		UpdatedAt:            now,
	}

	h.db.UpsertCloudAccount(acc)
	go func(uid string) {
		_, _ = services.Sync.RunDeltaSync(context.Background(), uid)
	}(user.ID)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": acc,
	})
}

func (h *AccountHandler) GoogleCallback(w http.ResponseWriter, r *http.Request) {
	frontendURL, err := url.Parse(h.cfg.FrontendURL)
	if err != nil {
		frontendURL, _ = url.Parse("https://onespace-web.onrender.com")
	}
	frontendURL.Path = "/"

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	errParam := r.URL.Query().Get("error")

	statePayload, _ := utils.VerifyOAuthState(state, h.cfg.AuthSecret)
	isLogin := statePayload != nil && statePayload["type"] == "login"

	if errParam != "" {
		if isLogin {
			frontendURL.Fragment = "login"
		} else {
			frontendURL.Fragment = "storage"
		}
		q := frontendURL.Query()
		q.Set("error", errParam)
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}

	if statePayload == nil {
		frontendURL.Fragment = "storage"
		q := frontendURL.Query()
		q.Set("error", "Invalid or expired Google OAuth state")
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}

	ctx := context.Background()

	// 1. User Sign In flow
	if isLogin {
		conf := &oauth2.Config{
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

		token, err := conf.Exchange(ctx, code)
		if err != nil {
			frontendURL.Fragment = "login"
			q := frontendURL.Query()
			q.Set("error", err.Error())
			frontendURL.RawQuery = q.Encode()
			http.Redirect(w, r, frontendURL.String(), http.StatusFound)
			return
		}

		oauth2Service, _ := googleOauth2.NewService(ctx, option.WithTokenSource(conf.TokenSource(ctx, token)))
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

		// Automatically link this Google account as the first connected cloud drive
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
		return
	}



	// 3. Google Drive Link flow
	userID, _ := statePayload["userId"].(string)
	conf := &oauth2.Config{
		ClientID:     h.cfg.GoogleClientID,
		ClientSecret: h.cfg.GoogleClientSecret,
		RedirectURL:  h.cfg.GoogleRedirectURI,
		Scopes: []string{
			"openid",
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/drive",
			"https://www.googleapis.com/auth/drive.metadata",
		},
		Endpoint: google.Endpoint,
	}

	token, err := conf.Exchange(ctx, code)
	if err != nil {
		frontendURL.Fragment = "storage"
		q := frontendURL.Query()
		q.Set("error", err.Error())
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}

	srv, err := drive.NewService(ctx, option.WithTokenSource(conf.TokenSource(ctx, token)))
	if err != nil {
		frontendURL.Fragment = "storage"
		q := frontendURL.Query()
		q.Set("error", err.Error())
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}

	about, err := srv.About.Get().Fields("user(emailAddress), storageQuota").Context(ctx).Do()
	if err != nil || about.User == nil || about.User.EmailAddress == "" {
		frontendURL.Fragment = "storage"
		q := frontendURL.Query()
		q.Set("error", "Unable to read Google account email")
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}

	email := strings.ToLower(strings.TrimSpace(about.User.EmailAddress))
	creds := adapters.GoogleDriveCredentials{
		ClientID:     h.cfg.GoogleClientID,
		ClientSecret: h.cfg.GoogleClientSecret,
		RedirectURI:  h.cfg.GoogleRedirectURI,
		RefreshToken: token.RefreshToken,
		AccessToken:  token.AccessToken,
		ExpiryDate:   token.Expiry.UnixMilli(),
	}
	encCreds, _ := utils.EncryptJSON(creds, h.cfg.EncryptionKey)

	var total, used int64
	if about.StorageQuota != nil {
		total = about.StorageQuota.Limit
		used = about.StorageQuota.Usage
	}

	now := time.Now()
	acc := &models.CloudAccount{
		ID:                   uuid.NewString(),
		UserID:               userID,
		Provider:             "google_drive",
		Email:                email,
		EncryptedCredentials: encCreds,
		TotalSpace:           total,
		UsedSpace:            used,
		Status:               "active",
		CreatedAt:            now,
		UpdatedAt:            now,
	}
	h.db.UpsertCloudAccount(acc)
	go func(uid string) {
		_, _ = services.Sync.RunDeltaSync(context.Background(), uid)
	}(userID)

	frontendURL.Fragment = "storage"
	q := frontendURL.Query()
	q.Set("google", "connected")
	frontendURL.RawQuery = q.Encode()
	http.Redirect(w, r, frontendURL.String(), http.StatusFound)
}

func (h *AccountHandler) DropboxCallback(w http.ResponseWriter, r *http.Request) {
	frontendURL, err := url.Parse(h.cfg.FrontendURL)
	if err != nil {
		frontendURL, _ = url.Parse("https://onespace-web.onrender.com")
	}
	frontendURL.Path = "/"

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	errParam := r.URL.Query().Get("error")

	if errParam != "" {
		frontendURL.Fragment = "storage"
		q := frontendURL.Query()
		q.Set("error", errParam)
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}

	statePayload, err := utils.VerifyOAuthState(state, h.cfg.AuthSecret)
	if err != nil || statePayload == nil {
		frontendURL.Fragment = "storage"
		q := frontendURL.Query()
		q.Set("error", "Invalid or expired Dropbox OAuth state")
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}

	userID, _ := statePayload["userId"].(string)

	// Exchange code
	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("code", code)
	data.Set("client_id", h.cfg.DropboxClientID)
	data.Set("client_secret", h.cfg.DropboxClientSecret)
	data.Set("redirect_uri", h.cfg.DropboxRedirectURI)

	resp, err := http.PostForm("https://api.dropboxapi.com/oauth2/token", data)
	if err != nil {
		frontendURL.Fragment = "storage"
		q := frontendURL.Query()
		q.Set("error", err.Error())
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}
	defer resp.Body.Close()

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
		AccountID    string `json:"account_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		frontendURL.Fragment = "storage"
		q := frontendURL.Query()
		q.Set("error", "Failed to parse Dropbox token response")
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}

	// Fetch current account email
	accReq, _ := http.NewRequest("POST", "https://api.dropboxapi.com/2/users/get_current_account", nil)
	accReq.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)
	accResp, err := http.DefaultClient.Do(accReq)
	if err != nil {
		frontendURL.Fragment = "storage"
		q := frontendURL.Query()
		q.Set("error", "Failed to fetch Dropbox account details")
		frontendURL.RawQuery = q.Encode()
		http.Redirect(w, r, frontendURL.String(), http.StatusFound)
		return
	}
	defer accResp.Body.Close()

	var curAcc struct {
		Email string `json:"email"`
	}
	_ = json.NewDecoder(accResp.Body).Decode(&curAcc)

	email := strings.ToLower(strings.TrimSpace(curAcc.Email))
	creds := adapters.DropboxCredentials{
		ClientID:     h.cfg.DropboxClientID,
		ClientSecret: h.cfg.DropboxClientSecret,
		RedirectURI:  h.cfg.DropboxRedirectURI,
		RefreshToken: tokenResp.RefreshToken,
		AccessToken:  tokenResp.AccessToken,
		ExpiryDate:   time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second).UnixMilli(),
	}
	encCreds, _ := utils.EncryptJSON(creds, h.cfg.EncryptionKey)

	now := time.Now()
	acc := &models.CloudAccount{
		ID:                   uuid.NewString(),
		UserID:               userID,
		Provider:             "dropbox",
		Email:                email,
		EncryptedCredentials: encCreds,
		TotalSpace:           2 * 1024 * 1024 * 1024,
		UsedSpace:            0,
		Status:               "active",
		CreatedAt:            now,
		UpdatedAt:            now,
	}
	h.db.UpsertCloudAccount(acc)
	go func(uid string) {
		_, _ = services.Sync.RunDeltaSync(context.Background(), uid)
	}(userID)

	frontendURL.Fragment = "storage"
	q := frontendURL.Query()
	q.Set("dropbox", "connected")
	frontendURL.RawQuery = q.Encode()
	http.Redirect(w, r, frontendURL.String(), http.StatusFound)
}
