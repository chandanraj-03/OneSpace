package adapters

import (
	"fmt"
	"onespace/backend/internal/models"
)

func CreateAdapter(account *models.CloudAccount, key []byte) (CloudAdapter, error) {
	switch account.Provider {
	case "google_drive":
		return NewGoogleDriveAdapter(account, key), nil
	case "google_photos":
		return NewGooglePhotosAdapter(account, key), nil
	case "dropbox":
		return NewDropboxAdapter(account, key), nil
	default:
		return nil, fmt.Errorf("unsupported provider: %s", account.Provider)
	}
}
