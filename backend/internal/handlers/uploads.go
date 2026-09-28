package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"onespace/backend/internal/adapters"
	"onespace/backend/internal/config"
	"onespace/backend/internal/database"
	"onespace/backend/internal/middleware"
	"onespace/backend/internal/models"
	"onespace/backend/internal/services"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type UploadHandler struct {
	cfg      *config.Config
	db       *database.Database
	sessions map[string]*models.UploadSession
	mu       sync.RWMutex
}

func NewUploadHandler(cfg *config.Config, db *database.Database) *UploadHandler {
	return &UploadHandler{
		cfg:      cfg,
		db:       db,
		sessions: make(map[string]*models.UploadSession),
	}
}

func (h *UploadHandler) InitiateUpload(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())

	var body struct {
		FileName       string  `json:"file_name"`
		Size           int64   `json:"size"`
		FileSize       int64   `json:"file_size"`
		MimeType       string  `json:"mime_type"`
		VirtualPath    string  `json:"virtual_path"`
		RemoteParentID *string `json:"remote_parent_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.FileName == "" {
		http.Error(w, "file_name is required", http.StatusBadRequest)
		return
	}

	if body.Size == 0 && body.FileSize > 0 {
		body.Size = body.FileSize
	}

	alloc, err := services.Allocator.SelectBestAccount(user.ID, body.Size)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	vPath := body.VirtualPath
	if vPath == "" {
		vPath = "/"
	}

	token := uuid.NewString()
	sessionID := uuid.NewString()

	var fallbackIDs []string
	for _, a := range alloc.FallbackChain {
		fallbackIDs = append(fallbackIDs, a.ID)
	}

	session := &models.UploadSession{
		ID:             sessionID,
		UserID:         user.ID,
		Token:          token,
		FileName:       body.FileName,
		Size:           body.Size,
		MimeType:       body.MimeType,
		VirtualPath:    vPath,
		RemoteParentID: body.RemoteParentID,
		CloudAccountID: alloc.Selected.ID,
		FallbackChain:  fallbackIDs,
		CreatedAt:      time.Now(),
	}

	h.mu.Lock()
	h.sessions[sessionID] = session
	h.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"upload_id":     session.ID,
		"session_token": session.Token,
		"data": map[string]interface{}{
			"upload_id":     session.ID,
			"session_token": session.Token,
			"target_account": map[string]string{
				"id":       alloc.Selected.ID,
				"provider": alloc.Selected.Provider,
				"email":    alloc.Selected.Email,
			},
		},
	})
}

// Progress-tracking reader wrapper
type progressReader struct {
	reader     io.Reader
	totalBytes int64
	readBytes  int64
	uploadID   string
	lastEmit   time.Time
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.reader.Read(p)
	pr.readBytes += int64(n)

	now := time.Now()
	if now.Sub(pr.lastEmit) > 150*time.Millisecond || err == io.EOF {
		pr.lastEmit = now
		percent := 0
		if pr.totalBytes > 0 {
			percent = int((pr.readBytes * 100) / pr.totalBytes)
			if percent > 100 {
				percent = 100
			}
		}
		services.Hub.Emit(pr.uploadID, map[string]interface{}{
			"type":     "upload:progress",
			"uploadId": pr.uploadID,
			"bytes":    pr.readBytes,
			"percent":  percent,
			"status":   "uploading",
		})
	}

	return n, err
}

func (h *UploadHandler) StreamUpload(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())
	uploadID := chi.URLParam(r, "uploadId")

	h.mu.Lock()
	session, ok := h.sessions[uploadID]
	if ok {
		delete(h.sessions, uploadID)
	}
	h.mu.Unlock()

	if !ok || session.UserID != user.ID {
		http.Error(w, "Upload session not found or expired", http.StatusNotFound)
		return
	}

	// Parse multipart reader directly without buffering files in memory!
	mr, err := r.MultipartReader()
	if err != nil {
		http.Error(w, "Failed to read multipart data: "+err.Error(), http.StatusBadRequest)
		return
	}

	part, err := mr.NextPart()
	if err != nil {
		http.Error(w, "No file found in upload", http.StatusBadRequest)
		return
	}
	defer part.Close()

	acc := h.db.GetCloudAccount(user.ID, session.CloudAccountID)
	if acc == nil {
		http.Error(w, "Target cloud storage account not found", http.StatusBadRequest)
		return
	}

	adapter, err := adapters.CreateAdapter(acc, h.cfg.EncryptionKey)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	pr := &progressReader{
		reader:     part,
		totalBytes: session.Size,
		uploadID:   session.ID,
		lastEmit:   time.Now(),
	}

	fileName := session.FileName
	if part.FileName() != "" {
		fileName = part.FileName()
	}

	meta, err := adapter.UploadStream(r.Context(), adapters.UploadStreamRequest{
		Stream:         pr,
		Size:           session.Size,
		FileName:       fileName,
		MimeType:       session.MimeType,
		VirtualPath:    session.VirtualPath,
		RemoteParentID: session.RemoteParentID,
	})
	if err != nil {
		services.Hub.Emit(session.ID, map[string]interface{}{
			"type":     "upload:error",
			"uploadId": session.ID,
			"error":    err.Error(),
		})
		http.Error(w, fmt.Sprintf("Cloud upload failed: %v", err), http.StatusInternalServerError)
		return
	}

	h.db.UpsertFile(meta)
	acc.UsedSpace += session.Size
	h.db.UpsertCloudAccount(acc)

	services.Hub.Emit(session.ID, map[string]interface{}{
		"type":     "upload:complete",
		"uploadId": session.ID,
		"file":     meta,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": meta,
	})
}
