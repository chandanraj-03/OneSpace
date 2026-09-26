package adapters

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"onespace/backend/internal/config"
	"onespace/backend/internal/models"
	"onespace/backend/internal/utils"

	"github.com/google/uuid"
)

type DropboxCredentials struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	RedirectURI  string `json:"redirectUri"`
	RefreshToken string `json:"refreshToken"`
	AccessToken  string `json:"accessToken"`
	ExpiryDate   int64  `json:"expiryDate"`
}

type DropboxAdapter struct {
	account *models.CloudAccount
	key     []byte
}

func NewDropboxAdapter(account *models.CloudAccount, key []byte) *DropboxAdapter {
	return &DropboxAdapter{account: account, key: key}
}

func (a *DropboxAdapter) GetCapabilities() map[string]bool {
	return map[string]bool{
		"starred": false,
		"rename":  true,
		"delete":  true,
	}
}

func (a *DropboxAdapter) getValidAccessToken(ctx context.Context) (string, error) {
	var creds DropboxCredentials
	if err := utils.DecryptJSON(a.account.EncryptedCredentials, a.key, &creds); err != nil {
		return "", fmt.Errorf("failed to decrypt Dropbox credentials: %w", err)
	}

	if creds.AccessToken != "" && creds.ExpiryDate > time.Now().Add(5*time.Minute).UnixMilli() {
		return creds.AccessToken, nil
	}
	if creds.RefreshToken == "" && creds.AccessToken != "" {
		return creds.AccessToken, nil
	}

	clientID := creds.ClientID
	if clientID == "" && config.AppConfig != nil {
		clientID = config.AppConfig.DropboxClientID
	}
	clientSecret := creds.ClientSecret
	if clientSecret == "" && config.AppConfig != nil {
		clientSecret = config.AppConfig.DropboxClientSecret
	}

	// Refresh token
	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", creds.RefreshToken)
	data.Set("client_id", clientID)
	data.Set("client_secret", clientSecret)

	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.dropboxapi.com/oauth2/token", strings.NewReader(data.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("dropbox token refresh failed: %s", string(body))
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", err
	}

	return tokenResp.AccessToken, nil
}

func (a *DropboxAdapter) FetchStructure(ctx context.Context) ([]models.FileMetadata, error) {
	token, err := a.getValidAccessToken(ctx)
	if err != nil {
		return nil, err
	}

	var results []models.FileMetadata
	cursor := ""
	hasMore := true

	for hasMore {
		var reqURL string
		var reqBody []byte

		if cursor == "" {
			reqURL = "https://api.dropboxapi.com/2/files/list_folder"
			reqBody, _ = json.Marshal(map[string]interface{}{
				"path":      "",
				"recursive": true,
				"limit":     1000,
			})
		} else {
			reqURL = "https://api.dropboxapi.com/2/files/list_folder/continue"
			reqBody, _ = json.Marshal(map[string]interface{}{
				"cursor": cursor,
			})
		}

		req, err := http.NewRequestWithContext(ctx, "POST", reqURL, bytes.NewReader(reqBody))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()

		if resp.StatusCode >= 400 {
			body, _ := io.ReadAll(resp.Body)
			return nil, fmt.Errorf("dropbox list_folder failed: %s", string(body))
		}

		var listResp struct {
			Entries []struct {
				Tag          string `json:".tag"`
				ID           string `json:"id"`
				Name         string `json:"name"`
				PathLower    string `json:"path_lower"`
				PathDisplay  string `json:"path_display"`
				Size         int64  `json:"size"`
				ServerMod    string `json:"server_modified"`
				ClientMod    string `json:"client_modified"`
			} `json:"entries"`
			Cursor  string `json:"cursor"`
			HasMore bool   `json:"has_more"`
		}

		if err := json.NewDecoder(resp.Body).Decode(&listResp); err != nil {
			return nil, err
		}

		now := time.Now()
		for _, e := range listResp.Entries {
			isFolder := e.Tag == "folder"
			modTime := e.ServerMod
			virtualPath := "/"
			if lastSlash := strings.LastIndex(e.PathDisplay, "/"); lastSlash > 0 {
				virtualPath = e.PathDisplay[:lastSlash]
			}

			results = append(results, models.FileMetadata{
				ID:                 uuid.NewString(),
				UserID:             a.account.UserID,
				CloudAccountID:     a.account.ID,
				RemoteFileID:       e.PathLower,
				FileName:           e.Name,
				FileSize:           e.Size,
				MimeType:           "application/octet-stream",
				VirtualPath:        virtualPath,
				IsFolder:           isFolder,
				RemoteModifiedTime: &modTime,
				CreatedAt:          now,
				UpdatedAt:          now,
			})
		}

		cursor = listResp.Cursor
		hasMore = listResp.HasMore
	}

	return results, nil
}

func (a *DropboxAdapter) GetStorageSummary(ctx context.Context) (int64, int64, error) {
	token, err := a.getValidAccessToken(ctx)
	if err != nil {
		return 0, 0, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.dropboxapi.com/2/users/get_space_usage", bytes.NewReader([]byte("null")))
	if err != nil {
		return 0, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer resp.Body.Close()

	var usageResp struct {
		Used       int64 `json:"used"`
		Allocation struct {
			Allocated int64 `json:"allocated"`
		} `json:"allocation"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&usageResp); err != nil {
		return 0, 0, err
	}

	return usageResp.Allocation.Allocated, usageResp.Used, nil
}

func (a *DropboxAdapter) UploadStream(ctx context.Context, req UploadStreamRequest) (*models.FileMetadata, error) {
	token, err := a.getValidAccessToken(ctx)
	if err != nil {
		return nil, err
	}

	dropPath := "/" + strings.Trim(req.VirtualPath, "/") + "/" + req.FileName
	dropPath = strings.ReplaceAll(dropPath, "//", "/")

	argJSON, _ := json.Marshal(map[string]interface{}{
		"path":            dropPath,
		"mode":            "add",
		"autorename":      true,
		"mute":            false,
		"strict_conflict": false,
	})

	uploadReq, err := http.NewRequestWithContext(ctx, "POST", "https://content.dropboxapi.com/2/files/upload", req.Stream)
	if err != nil {
		return nil, err
	}
	uploadReq.Header.Set("Authorization", "Bearer "+token)
	uploadReq.Header.Set("Dropbox-API-Arg", string(argJSON))
	uploadReq.Header.Set("Content-Type", "application/octet-stream")

	resp, err := http.DefaultClient.Do(uploadReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("dropbox upload failed: %s", string(body))
	}

	var fileResp struct {
		ID        string `json:"id"`
		Name      string `json:"name"`
		PathLower string `json:"path_lower"`
		Size      int64  `json:"size"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&fileResp); err != nil {
		return nil, err
	}

	now := time.Now()
	meta := &models.FileMetadata{
		ID:             uuid.NewString(),
		UserID:         a.account.UserID,
		CloudAccountID: a.account.ID,
		RemoteFileID:   fileResp.PathLower,
		FileName:       fileResp.Name,
		FileSize:       fileResp.Size,
		MimeType:       req.MimeType,
		VirtualPath:    req.VirtualPath,
		IsFolder:       false,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	return meta, nil
}

func (a *DropboxAdapter) DownloadStream(ctx context.Context, remoteID string) (io.ReadCloser, string, int64, error) {
	token, err := a.getValidAccessToken(ctx)
	if err != nil {
		return nil, "", 0, err
	}

	argJSON, _ := json.Marshal(map[string]string{"path": remoteID})
	req, err := http.NewRequestWithContext(ctx, "POST", "https://content.dropboxapi.com/2/files/download", nil)
	if err != nil {
		return nil, "", 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Dropbox-API-Arg", string(argJSON))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", 0, err
	}

	return resp.Body, "application/octet-stream", resp.ContentLength, nil
}

func (a *DropboxAdapter) DeleteFile(ctx context.Context, remoteID string) error {
	token, err := a.getValidAccessToken(ctx)
	if err != nil {
		return err
	}

	body, _ := json.Marshal(map[string]string{"path": remoteID})
	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.dropboxapi.com/2/files/delete_v2", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

func (a *DropboxAdapter) RenameFile(ctx context.Context, remoteID, newName string) error {
	token, err := a.getValidAccessToken(ctx)
	if err != nil {
		return err
	}

	newPath := remoteID
	if lastSlash := strings.LastIndex(remoteID, "/"); lastSlash >= 0 {
		newPath = remoteID[:lastSlash+1] + newName
	}

	body, _ := json.Marshal(map[string]string{
		"from_path": remoteID,
		"to_path":   newPath,
	})
	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.dropboxapi.com/2/files/move_v2", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}
