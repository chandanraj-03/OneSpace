package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"onespace/backend/internal/models"
	"onespace/backend/internal/utils"

	"github.com/google/uuid"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

type GooglePhotosAdapter struct {
	account *models.CloudAccount
	key     []byte
}

func NewGooglePhotosAdapter(account *models.CloudAccount, key []byte) *GooglePhotosAdapter {
	return &GooglePhotosAdapter{account: account, key: key}
}

func (a *GooglePhotosAdapter) GetCapabilities() map[string]bool {
	return map[string]bool{
		"starred": false,
		"rename":  false,
		"delete":  false,
	}
}

func (a *GooglePhotosAdapter) getValidAccessToken(ctx context.Context) (string, error) {
	var creds GoogleDriveCredentials
	if err := utils.DecryptJSON(a.account.EncryptedCredentials, a.key, &creds); err != nil {
		return "", fmt.Errorf("failed to decrypt Google Photos credentials: %w", err)
	}

	conf := &oauth2.Config{
		ClientID:     creds.ClientID,
		ClientSecret: creds.ClientSecret,
		RedirectURL:  creds.RedirectURI,
		Endpoint:     google.Endpoint,
		Scopes: []string{
			"openid",
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/photoslibrary.readonly",
		},
	}

	token := &oauth2.Token{
		AccessToken:  creds.AccessToken,
		RefreshToken: creds.RefreshToken,
		Expiry:       time.UnixMilli(creds.ExpiryDate),
	}

	ts := conf.TokenSource(ctx, token)
	newToken, err := ts.Token()
	if err != nil {
		return "", err
	}

	return newToken.AccessToken, nil
}

func (a *GooglePhotosAdapter) FetchStructure(ctx context.Context) ([]models.FileMetadata, error) {
	token, err := a.getValidAccessToken(ctx)
	if err != nil {
		return nil, err
	}

	var results []models.FileMetadata
	reqURL := "https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=100"

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return results, nil // Photos library might be restricted or empty
	}

	var mediaResp struct {
		MediaItems []struct {
			ID          string `json:"id"`
			Filename    string `json:"filename"`
			MimeType    string `json:"mimeType"`
			BaseURL     string `json:"baseUrl"`
			MediaMetadata struct {
				CreationTime string `json:"creationTime"`
			} `json:"mediaMetadata"`
		} `json:"mediaItems"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&mediaResp); err != nil {
		return results, nil
	}

	now := time.Now()
	for _, m := range mediaResp.MediaItems {
		cTime := m.MediaMetadata.CreationTime
		results = append(results, models.FileMetadata{
			ID:                uuid.NewString(),
			UserID:            a.account.UserID,
			CloudAccountID:    a.account.ID,
			RemoteFileID:      m.ID,
			FileName:          m.Filename,
			FileSize:          0,
			MimeType:          m.MimeType,
			VirtualPath:       "/",
			IsFolder:          false,
			RemoteCreatedTime: &cTime,
			CreatedAt:         now,
			UpdatedAt:         now,
		})
	}

	return results, nil
}

func (a *GooglePhotosAdapter) GetStorageSummary(ctx context.Context) (int64, int64, error) {
	return 15 * 1024 * 1024 * 1024, 0, nil
}

func (a *GooglePhotosAdapter) UploadStream(ctx context.Context, req UploadStreamRequest) (*models.FileMetadata, error) {
	return nil, fmt.Errorf("direct photo upload not supported via readonly API")
}

func (a *GooglePhotosAdapter) DownloadStream(ctx context.Context, remoteID string) (io.ReadCloser, string, int64, error) {
	token, err := a.getValidAccessToken(ctx)
	if err != nil {
		return nil, "", 0, err
	}

	itemReq, err := http.NewRequestWithContext(ctx, "GET", "https://photoslibrary.googleapis.com/v1/mediaItems/"+remoteID, nil)
	if err != nil {
		return nil, "", 0, err
	}
	itemReq.Header.Set("Authorization", "Bearer "+token)

	itemResp, err := http.DefaultClient.Do(itemReq)
	if err != nil {
		return nil, "", 0, err
	}
	defer itemResp.Body.Close()

	var item struct {
		BaseURL  string `json:"baseUrl"`
		MimeType string `json:"mimeType"`
	}
	if err := json.NewDecoder(itemResp.Body).Decode(&item); err != nil {
		return nil, "", 0, err
	}

	downloadURL := item.BaseURL + "=d"
	dlResp, err := http.Get(downloadURL)
	if err != nil {
		return nil, "", 0, err
	}

	return dlResp.Body, item.MimeType, dlResp.ContentLength, nil
}

func (a *GooglePhotosAdapter) DeleteFile(ctx context.Context, remoteID string) error {
	return fmt.Errorf("deleting photos via readonly API is not supported")
}

func (a *GooglePhotosAdapter) RenameFile(ctx context.Context, remoteID, newName string) error {
	return fmt.Errorf("renaming photos via readonly API is not supported")
}
