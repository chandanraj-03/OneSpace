package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"onespace/backend/internal/adapters"
	"onespace/backend/internal/config"
	"onespace/backend/internal/database"
	"onespace/backend/internal/middleware"
	"onespace/backend/internal/models"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type FileHandler struct {
	cfg *config.Config
	db  *database.Database
}

func NewFileHandler(cfg *config.Config, db *database.Database) *FileHandler {
	return &FileHandler{cfg: cfg, db: db}
}

func (h *FileHandler) ListFiles(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())
	q := r.URL.Query()

	path := q.Get("path")
	if path == "" {
		path = "/"
	}
	search := q.Get("search")
	starred := q.Get("starred") == "1" || q.Get("starred") == "true"
	recent := q.Get("recent") == "1" || q.Get("recent") == "true"

	limitStr := q.Get("limit")
	limit := 50
	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
		limit = l
	}

	var files []models.FileMetadata
	if search != "" {
		files = h.db.SearchFiles(user.ID, search, limit)
	} else if starred {
		files = h.db.ListStarredFiles(user.ID)
	} else if recent {
		files = h.db.ListRecentFiles(user.ID)
	} else {
		files = h.db.ListFilesByPath(user.ID, path)
	}

	if files == nil {
		files = []models.FileMetadata{}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": files,
	})
}

func (h *FileHandler) GetFileDetails(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())
	fileID := chi.URLParam(r, "id")

	file := h.db.GetFileByID(user.ID, fileID)
	if file == nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": file,
	})
}

func (h *FileHandler) CreateFolder(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())

	var body struct {
		Name        string `json:"name"`
		VirtualPath string `json:"virtual_path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		http.Error(w, "Folder name is required", http.StatusBadRequest)
		return
	}

	vPath := body.VirtualPath
	if vPath == "" {
		vPath = "/"
	}

	now := time.Now()
	folder := &models.FileMetadata{
		ID:             uuid.NewString(),
		UserID:         user.ID,
		CloudAccountID: "",
		RemoteFileID:   "",
		FileName:       body.Name,
		FileSize:       0,
		MimeType:       "application/vnd.google-apps.folder",
		VirtualPath:    vPath,
		IsFolder:       true,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	h.db.UpsertFile(folder)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": folder,
	})
}

func (h *FileHandler) RenameFile(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())
	fileID := chi.URLParam(r, "id")

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	file := h.db.GetFileByID(user.ID, fileID)
	if file == nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	if file.CloudAccountID != "" && file.RemoteFileID != "" {
		acc := h.db.GetCloudAccount(user.ID, file.CloudAccountID)
		if acc != nil {
			if adapter, err := adapters.CreateAdapter(acc, h.cfg.EncryptionKey); err == nil {
				_ = adapter.RenameFile(r.Context(), file.RemoteFileID, body.Name)
			}
		}
	}

	file.FileName = body.Name
	file.UpdatedAt = time.Now()
	h.db.UpsertFile(file)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": file,
	})
}

func (h *FileHandler) ToggleStar(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())
	fileID := chi.URLParam(r, "id")

	var body struct {
		IsStarred bool `json:"is_starred"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	file := h.db.GetFileByID(user.ID, fileID)
	if file == nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	file.IsStarred = body.IsStarred
	file.UpdatedAt = time.Now()
	h.db.UpsertFile(file)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": file,
	})
}

func (h *FileHandler) DeleteFile(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())
	fileID := chi.URLParam(r, "id")

	file := h.db.GetFileByID(user.ID, fileID)
	if file == nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	if file.IsFolder {
		exactPath := strings.TrimSuffix(file.VirtualPath, "/") + "/" + file.FileName
		prefixPath := exactPath + "/%"
		h.db.DeleteFilesByVirtualPath(user.ID, exactPath, prefixPath)
	} else if file.CloudAccountID != "" && file.RemoteFileID != "" {
		acc := h.db.GetCloudAccount(user.ID, file.CloudAccountID)
		if acc != nil {
			if adapter, err := adapters.CreateAdapter(acc, h.cfg.EncryptionKey); err == nil {
				_ = adapter.DeleteFile(r.Context(), file.RemoteFileID)
			}
		}
	}

	h.db.DeleteFile(user.ID, fileID)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": map[string]bool{"success": true},
	})
}

func (h *FileHandler) BulkDeleteFiles(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())

	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "IDs are required", http.StatusBadRequest)
		return
	}

	for _, id := range body.IDs {
		file := h.db.GetFileByID(user.ID, id)
		if file != nil {
			if file.CloudAccountID != "" && file.RemoteFileID != "" {
				acc := h.db.GetCloudAccount(user.ID, file.CloudAccountID)
				if acc != nil {
					if adapter, err := adapters.CreateAdapter(acc, h.cfg.EncryptionKey); err == nil {
						_ = adapter.DeleteFile(r.Context(), file.RemoteFileID)
					}
				}
			}
			h.db.DeleteFile(user.ID, id)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": map[string]bool{"success": true},
	})
}

func (h *FileHandler) DownloadFile(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())
	fileID := chi.URLParam(r, "id")

	file := h.db.GetFileByID(user.ID, fileID)
	if file == nil || file.CloudAccountID == "" || file.RemoteFileID == "" {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	acc := h.db.GetCloudAccount(user.ID, file.CloudAccountID)
	if acc == nil {
		http.Error(w, "Target storage account not connected", http.StatusBadRequest)
		return
	}

	adapter, err := adapters.CreateAdapter(acc, h.cfg.EncryptionKey)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	reader, mimeType, size, err := adapter.DownloadStream(r.Context(), file.RemoteFileID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, file.FileName))
	if size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	}

	// Zero-copy stream directly to client
	_, _ = io.Copy(w, reader)
}

func (h *FileHandler) PreviewFile(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())
	fileID := chi.URLParam(r, "id")

	file := h.db.GetFileByID(user.ID, fileID)
	if file == nil || file.CloudAccountID == "" || file.RemoteFileID == "" {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	acc := h.db.GetCloudAccount(user.ID, file.CloudAccountID)
	if acc == nil {
		http.Error(w, "Target storage account not connected", http.StatusBadRequest)
		return
	}

	adapter, err := adapters.CreateAdapter(acc, h.cfg.EncryptionKey)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	reader, mimeType, _, err := adapter.DownloadStream(context.Background(), file.RemoteFileID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, file.FileName))

	_, _ = io.Copy(w, reader)
}
