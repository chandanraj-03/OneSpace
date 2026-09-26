package adapters

import (
	"context"
	"io"

	"onespace/backend/internal/models"
)

type UploadStreamRequest struct {
	Stream         io.Reader
	Size           int64
	FileName       string
	MimeType       string
	VirtualPath    string
	RemoteParentID *string
	OnProgress     func(bytes int64)
}

type CloudAdapter interface {
	GetCapabilities() map[string]bool
	FetchStructure(ctx context.Context) ([]models.FileMetadata, error)
	GetStorageSummary(ctx context.Context) (total int64, used int64, err error)
	UploadStream(ctx context.Context, req UploadStreamRequest) (*models.FileMetadata, error)
	DownloadStream(ctx context.Context, remoteID string) (io.ReadCloser, string, int64, error)
	DeleteFile(ctx context.Context, remoteID string) error
	RenameFile(ctx context.Context, remoteID, newName string) error
}
