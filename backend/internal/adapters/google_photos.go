package adapters

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"onespace/backend/internal/config"
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

	clientID := creds.ClientID
	if clientID == "" && config.AppConfig != nil {
		clientID = config.AppConfig.GoogleClientID
	}
	clientSecret := creds.ClientSecret
	if clientSecret == "" && config.AppConfig != nil {
		clientSecret = config.AppConfig.GoogleClientSecret
	}
	redirectURI := creds.RedirectURI
	if redirectURI == "" && config.AppConfig != nil {
		redirectURI = config.AppConfig.GoogleRedirectURI
	}

	conf := &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURI,
		Endpoint:     google.Endpoint,
		Scopes: []string{
			"openid",
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/photoslibrary.readonly",
		},
	}

	var expiry time.Time
	if creds.ExpiryDate > 0 {
		expiry = time.UnixMilli(creds.ExpiryDate)
	} else if creds.RefreshToken == "" {
		expiry = time.Now().Add(1 * time.Hour)
	}

	if creds.AccessToken != "" && (creds.RefreshToken == "" || expiry.After(time.Now().Add(2*time.Minute))) {
		return creds.AccessToken, nil
	}

	token := &oauth2.Token{
		AccessToken:  creds.AccessToken,
		RefreshToken: creds.RefreshToken,
		Expiry:       expiry,
	}

	ts := conf.TokenSource(ctx, token)
	newToken, err := ts.Token()
	if err != nil {
		if creds.AccessToken != "" {
			return creds.AccessToken, nil
		}
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
	now := time.Now()
	nowStr := now.UTC().Format(time.RFC3339)
	rootParentID := "root"
	photosRootID := "google_photos_root"

	// 1. Root Google Photos virtual directory
	results = append(results, models.FileMetadata{
		ID:                 uuid.NewString(),
		UserID:             a.account.UserID,
		CloudAccountID:     a.account.ID,
		RemoteFileID:       photosRootID,
		FileName:           "Google Photos",
		Size:               0,
		FileSize:           0,
		MimeType:           "application/vnd.google-apps.folder",
		VirtualPath:        "/",
		RemoteParentID:     &rootParentID,
		IsFolder:           true,
		RemoteCreatedTime:  &nowStr,
		RemoteModifiedTime: &nowStr,
		CreatedAt:          now,
		UpdatedAt:          now,
		Provider:           a.account.Provider,
		Email:              a.account.Email,
	})

	seenMedia := make(map[string]bool)

	// 2. Fetch Albums
	albumsReq, err := http.NewRequestWithContext(ctx, "GET", "https://photoslibrary.googleapis.com/v1/albums?pageSize=50", nil)
	if err == nil {
		albumsReq.Header.Set("Authorization", "Bearer "+token)
		if albumsResp, err := http.DefaultClient.Do(albumsReq); err == nil {
			var albumsData struct {
				Albums []struct {
					ID    string `json:"id"`
					Title string `json:"title"`
				} `json:"albums"`
			}
			if err := json.NewDecoder(albumsResp.Body).Decode(&albumsData); err == nil {
				albumsResp.Body.Close()
				for _, alb := range albumsData.Albums {
					if alb.Title == "" {
						continue
					}
					albParent := photosRootID
					results = append(results, models.FileMetadata{
						ID:                 uuid.NewString(),
						UserID:             a.account.UserID,
						CloudAccountID:     a.account.ID,
						RemoteFileID:       alb.ID,
						FileName:           alb.Title,
						Size:               0,
						FileSize:           0,
						MimeType:           "application/vnd.google-apps.folder",
						VirtualPath:        "/Google Photos/",
						RemoteParentID:     &albParent,
						IsFolder:           true,
						RemoteCreatedTime:  &nowStr,
						RemoteModifiedTime: &nowStr,
						CreatedAt:          now,
						UpdatedAt:          now,
						Provider:           a.account.Provider,
						Email:              a.account.Email,
					})

					// Search items in this album
					searchBody, _ := json.Marshal(map[string]interface{}{
						"albumId":  alb.ID,
						"pageSize": 50,
					})
					searchReq, err := http.NewRequestWithContext(ctx, "POST", "https://photoslibrary.googleapis.com/v1/mediaItems:search", bytes.NewReader(searchBody))
					if err == nil {
						searchReq.Header.Set("Authorization", "Bearer "+token)
						searchReq.Header.Set("Content-Type", "application/json")
						if searchResp, err := http.DefaultClient.Do(searchReq); err == nil {
							var itemData struct {
								MediaItems []struct {
									ID          string `json:"id"`
									Filename    string `json:"filename"`
									MimeType    string `json:"mimeType"`
									MediaMetadata struct {
										CreationTime string `json:"creationTime"`
										Width        string `json:"width"`
										Height       string `json:"height"`
									} `json:"mediaMetadata"`
								} `json:"mediaItems"`
							}
							if err := json.NewDecoder(searchResp.Body).Decode(&itemData); err == nil {
								searchResp.Body.Close()
								for _, m := range itemData.MediaItems {
									seenMedia[m.ID] = true
									w, _ := strconv.ParseInt(m.MediaMetadata.Width, 10, 64)
									h, _ := strconv.ParseInt(m.MediaMetadata.Height, 10, 64)
									if w == 0 { w = 1920 }
									if h == 0 { h = 1080 }
									estSize := int64(float64(w*h) * 0.45)

									cTime := m.MediaMetadata.CreationTime
									fn := m.Filename
									if fn == "" {
										fn = fmt.Sprintf("Photo_%s.jpg", m.ID[:8])
									}
									albID := alb.ID
									results = append(results, models.FileMetadata{
										ID:                 uuid.NewString(),
										UserID:             a.account.UserID,
										CloudAccountID:     a.account.ID,
										RemoteFileID:       m.ID,
										FileName:           fn,
										Size:               estSize,
										FileSize:           estSize,
										MimeType:           m.MimeType,
										VirtualPath:        "/Google Photos/" + alb.Title + "/",
										RemoteParentID:     &albID,
										IsFolder:           false,
										RemoteCreatedTime:  &cTime,
										RemoteModifiedTime: &cTime,
										CreatedAt:          now,
										UpdatedAt:          now,
										Provider:           a.account.Provider,
										Email:              a.account.Email,
									})
								}
							} else {
								searchResp.Body.Close()
							}
						}
					}
				}
			} else {
				albumsResp.Body.Close()
			}
		}
	}

	// 3. Fetch Recent Media Items (Google Photos Library Root)
	reqURL := "https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=100"
	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err == nil {
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			defer resp.Body.Close()
			if resp.StatusCode < 400 {
				var mediaResp struct {
					MediaItems []struct {
						ID          string `json:"id"`
						Filename    string `json:"filename"`
						MimeType    string `json:"mimeType"`
						BaseURL     string `json:"baseUrl"`
						MediaMetadata struct {
							CreationTime string `json:"creationTime"`
							Width        string `json:"width"`
							Height       string `json:"height"`
						} `json:"mediaMetadata"`
					} `json:"mediaItems"`
				}

				if err := json.NewDecoder(resp.Body).Decode(&mediaResp); err == nil {
					for _, m := range mediaResp.MediaItems {
						if seenMedia[m.ID] {
							continue
						}
						w, _ := strconv.ParseInt(m.MediaMetadata.Width, 10, 64)
						h, _ := strconv.ParseInt(m.MediaMetadata.Height, 10, 64)
						if w == 0 { w = 1920 }
						if h == 0 { h = 1080 }
						estSize := int64(float64(w*h) * 0.45)

						cTime := m.MediaMetadata.CreationTime
						fn := m.Filename
						if fn == "" {
							fn = fmt.Sprintf("Photo_%s.jpg", m.ID[:8])
						}
						results = append(results, models.FileMetadata{
							ID:                 uuid.NewString(),
							UserID:             a.account.UserID,
							CloudAccountID:     a.account.ID,
							RemoteFileID:       m.ID,
							FileName:           fn,
							Size:               estSize,
							FileSize:           estSize,
							MimeType:           m.MimeType,
							VirtualPath:        "/Google Photos/",
							RemoteParentID:     &photosRootID,
							IsFolder:           false,
							RemoteCreatedTime:  &cTime,
							RemoteModifiedTime: &cTime,
							CreatedAt:          now,
							UpdatedAt:          now,
							Provider:           a.account.Provider,
							Email:              a.account.Email,
						})
					}
				}
			} else {
				log.Printf("[GooglePhotos] Fetch media items returned status %d\n", resp.StatusCode)
			}
		}
	}

	return results, nil
}

func (a *GooglePhotosAdapter) GetStorageSummary(ctx context.Context) (int64, int64, error) {
	return 15 * 1024 * 1024 * 1024, a.account.UsedSpace, nil
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
