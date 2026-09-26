package adapters

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"onespace/backend/internal/models"
	"onespace/backend/internal/utils"

	"github.com/google/uuid"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

type GoogleDriveCredentials struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	RedirectURI  string `json:"redirectUri"`
	RefreshToken string `json:"refreshToken"`
	AccessToken  string `json:"accessToken"`
	ExpiryDate   int64  `json:"expiryDate"`
}

type GoogleDriveAdapter struct {
	account *models.CloudAccount
	key     []byte
}

func NewGoogleDriveAdapter(account *models.CloudAccount, key []byte) *GoogleDriveAdapter {
	return &GoogleDriveAdapter{account: account, key: key}
}

func (a *GoogleDriveAdapter) GetCapabilities() map[string]bool {
	return map[string]bool{
		"starred": true,
		"rename":  true,
		"delete":  true,
	}
}

func (a *GoogleDriveAdapter) getDriveService(ctx context.Context) (*drive.Service, error) {
	var creds GoogleDriveCredentials
	if err := utils.DecryptJSON(a.account.EncryptedCredentials, a.key, &creds); err != nil {
		return nil, fmt.Errorf("failed to decrypt Google credentials: %w", err)
	}

	conf := &oauth2.Config{
		ClientID:     creds.ClientID,
		ClientSecret: creds.ClientSecret,
		RedirectURL:  creds.RedirectURI,
		Endpoint:     google.Endpoint,
		Scopes: []string{
			"openid",
			"https://www.googleapis.com/auth/drive",
			"https://www.googleapis.com/auth/drive.metadata",
		},
	}

	token := &oauth2.Token{
		AccessToken:  creds.AccessToken,
		RefreshToken: creds.RefreshToken,
		Expiry:       time.UnixMilli(creds.ExpiryDate),
	}

	ts := conf.TokenSource(ctx, token)
	return drive.NewService(ctx, option.WithTokenSource(ts))
}

func (a *GoogleDriveAdapter) FetchStructure(ctx context.Context) ([]models.FileMetadata, error) {
	srv, err := a.getDriveService(ctx)
	if err != nil {
		return nil, err
	}

	var results []models.FileMetadata
	pageToken := ""

	for {
		call := srv.Files.List().
			Q("trashed = false").
			Fields("nextPageToken, files(id, name, mimeType, size, parents, createdTime, modifiedTime)").
			PageSize(100)

		if pageToken != "" {
			call = call.PageToken(pageToken)
		}

		resp, err := call.Context(ctx).Do()
		if err != nil {
			return nil, err
		}

		for _, f := range resp.Files {
			isFolder := f.MimeType == "application/vnd.google-apps.folder"
			var parentID *string
			if len(f.Parents) > 0 {
				p := f.Parents[0]
				parentID = &p
			}

			cTime := f.CreatedTime
			mTime := f.ModifiedTime

			results = append(results, models.FileMetadata{
				ID:                 uuid.NewString(),
				UserID:             a.account.UserID,
				CloudAccountID:     a.account.ID,
				RemoteFileID:       f.Id,
				FileName:           f.Name,
				FileSize:           f.Size,
				MimeType:           f.MimeType,
				VirtualPath:        "/",
				RemoteParentID:     parentID,
				IsFolder:           isFolder,
				RemoteCreatedTime:  &cTime,
				RemoteModifiedTime: &mTime,
				CreatedAt:          time.Now(),
				UpdatedAt:          time.Now(),
			})
		}

		pageToken = resp.NextPageToken
		if pageToken == "" {
			break
		}
	}

	return results, nil
}

func (a *GoogleDriveAdapter) GetStorageSummary(ctx context.Context) (int64, int64, error) {
	srv, err := a.getDriveService(ctx)
	if err != nil {
		return 0, 0, err
	}

	about, err := srv.About.Get().Fields("storageQuota").Context(ctx).Do()
	if err != nil {
		return 0, 0, err
	}

	if about.StorageQuota != nil {
		return about.StorageQuota.Limit, about.StorageQuota.Usage, nil
	}
	return 0, 0, nil
}

func (a *GoogleDriveAdapter) UploadStream(ctx context.Context, req UploadStreamRequest) (*models.FileMetadata, error) {
	srv, err := a.getDriveService(ctx)
	if err != nil {
		return nil, err
	}

	fileMeta := &drive.File{
		Name: req.FileName,
	}
	if req.RemoteParentID != nil && *req.RemoteParentID != "" && *req.RemoteParentID != "root" {
		fileMeta.Parents = []string{*req.RemoteParentID}
	}

	created, err := srv.Files.Create(fileMeta).Media(req.Stream).Context(ctx).Do()
	if err != nil {
		return nil, err
	}

	now := time.Now()
	meta := &models.FileMetadata{
		ID:             uuid.NewString(),
		UserID:         a.account.UserID,
		CloudAccountID: a.account.ID,
		RemoteFileID:   created.Id,
		FileName:       created.Name,
		FileSize:       created.Size,
		MimeType:       created.MimeType,
		VirtualPath:    req.VirtualPath,
		RemoteParentID: req.RemoteParentID,
		IsFolder:       false,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	return meta, nil
}

func (a *GoogleDriveAdapter) DownloadStream(ctx context.Context, remoteID string) (io.ReadCloser, string, int64, error) {
	srv, err := a.getDriveService(ctx)
	if err != nil {
		return nil, "", 0, err
	}

	fileInfo, err := srv.Files.Get(remoteID).Fields("name, mimeType, size").Context(ctx).Do()
	if err != nil {
		return nil, "", 0, err
	}

	resp, err := srv.Files.Get(remoteID).Download()
	if err != nil {
		return nil, "", 0, err
	}

	return resp.Body, fileInfo.MimeType, fileInfo.Size, nil
}

func (a *GoogleDriveAdapter) DeleteFile(ctx context.Context, remoteID string) error {
	srv, err := a.getDriveService(ctx)
	if err != nil {
		return err
	}
	return srv.Files.Delete(remoteID).Context(ctx).Do()
}

func (a *GoogleDriveAdapter) RenameFile(ctx context.Context, remoteID, newName string) error {
	srv, err := a.getDriveService(ctx)
	if err != nil {
		return err
	}
	_, err = srv.Files.Update(remoteID, &drive.File{Name: newName}).Context(ctx).Do()
	return err
}

func (a *GoogleDriveAdapter) CreateFolder(ctx context.Context, name string, parentID *string) (*drive.File, error) {
	srv, err := a.getDriveService(ctx)
	if err != nil {
		return nil, err
	}

	f := &drive.File{
		Name:     name,
		MimeType: "application/vnd.google-apps.folder",
	}
	if parentID != nil && *parentID != "" {
		f.Parents = []string{*parentID}
	}

	return srv.Files.Create(f).Context(ctx).Do()
}

func (a *GoogleDriveAdapter) EnsureRemotePath(ctx context.Context, virtualPath string) (string, error) {
	clean := strings.Trim(virtualPath, "/")
	if clean == "" {
		return "root", nil
	}

	srv, err := a.getDriveService(ctx)
	if err != nil {
		return "", err
	}

	segments := strings.Split(clean, "/")
	parentID := "root"

	for _, seg := range segments {
		q := fmt.Sprintf("trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = '%s' and '%s' in parents",
			strings.ReplaceAll(seg, "'", "\\'"), parentID)

		list, err := srv.Files.List().Q(q).Fields("files(id)").Context(ctx).Do()
		if err != nil {
			return "", err
		}

		if len(list.Files) > 0 {
			parentID = list.Files[0].Id
		} else {
			folder, err := a.CreateFolder(ctx, seg, &parentID)
			if err != nil {
				return "", err
			}
			parentID = folder.Id
		}
	}

	return parentID, nil
}
