package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"onespace/backend/internal/config"
	"onespace/backend/internal/database"
	"onespace/backend/internal/handlers"
	"onespace/backend/internal/middleware"
	"onespace/backend/internal/services"

	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
)

func main() {
	cfg := config.LoadConfig()
	log.Printf("[OneSpace] Initializing Go Backend (Mode: %s)...\n", cfg.AppMode)

	// Initialize MongoDB
	database.DB.InitMongo(cfg.MongoDBURI)

	// Initialize Services
	services.InitAuth(cfg, database.DB)
	services.InitAllocator(database.DB)
	services.InitSync(cfg, database.DB)
	services.Sync.StartScheduler()

	// Initial sync for local mode
	if cfg.AppMode == "local" {
		go func() {
			_, _ = services.Sync.RunDeltaSync(context.Background(), database.LocalUserID)
		}()
	}

	// Router setup
	r := chi.NewRouter()

	// Global middleware
	r.Use(chiMiddleware.RequestID)
	r.Use(chiMiddleware.RealIP)
	r.Use(chiMiddleware.Recoverer)
	r.Use(middleware.NewCORS(cfg))
	r.Use(middleware.AttachAuthContext(cfg, database.DB))

	// Instantiate Handlers
	healthH := handlers.NewHealthHandler(cfg, database.DB)
	authH := handlers.NewAuthHandler(cfg, database.DB)
	accountH := handlers.NewAccountHandler(cfg, database.DB)
	fileH := handlers.NewFileHandler(cfg, database.DB)
	uploadH := handlers.NewUploadHandler(cfg, database.DB)
	settingsH := handlers.NewSettingsHandler(database.DB)
	allocH := handlers.NewAllocationHandler(database.DB)

	// Root routes
	r.Get("/", healthH.Root)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/api/health", http.StatusMovedPermanently)
	})

	// WebSockets
	r.Get("/ws/uploads", services.Hub.HandleConnection)

	// API Subrouter
	r.Route("/api", func(api chi.Router) {
		// Health & Sync
		api.Get("/health", healthH.Health)
		api.With(middleware.RequireAppUser).Post("/sync/run", func(w http.ResponseWriter, r *http.Request) {
			user := middleware.GetUserFromContext(r.Context())
			report, err := services.Sync.RunDeltaSync(r.Context(), user.ID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": report})
		})
		api.With(middleware.RequireAppUser).Get("/sync/status", func(w http.ResponseWriter, r *http.Request) {
			user := middleware.GetUserFromContext(r.Context())
			report := services.Sync.GetLastReport(user.ID)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": report})
		})

		// Auth
		api.Get("/auth/me", authH.Me)
		api.Post("/auth/login", authH.Login)
		api.Post("/auth/register", authH.Register)
		api.Post("/auth/logout", authH.Logout)
		api.Get("/auth/google/url", authH.GoogleURL)
		api.Get("/auth/google", authH.GoogleRedirect)
		api.Get("/auth/google/callback", authH.GoogleCallback)

		// Public OAuth Callbacks
		api.Get("/accounts/google/callback", accountH.GoogleCallback)
		api.Get("/accounts/dropbox/callback", accountH.DropboxCallback)

		// Accounts (Protected)
		api.Group(func(acc chi.Router) {
			acc.Use(middleware.RequireAppUser)
			acc.Get("/accounts", accountH.ListAccounts)
			acc.Delete("/accounts/{id}", accountH.DisconnectAccount)
			acc.Get("/accounts/google/status", accountH.GoogleStatus)
			acc.Get("/accounts/google/connect", accountH.GoogleConnect)
			acc.Get("/accounts/dropbox/status", accountH.DropboxStatus)
			acc.Get("/accounts/dropbox/connect", accountH.DropboxConnect)
			acc.Get("/accounts/mega/status", accountH.MegaStatus)
			acc.Post("/accounts/mega/connect", accountH.MegaConnect)
		})

		// Files (Protected)
		api.Group(func(files chi.Router) {
			files.Use(middleware.RequireAppUser)
			files.Get("/files", fileH.ListFiles)
			files.Post("/files/folders", fileH.CreateFolder)
			files.Post("/files/bulk/delete", fileH.BulkDeleteFiles)
			files.Get("/files/{id}", fileH.GetFileDetails)
			files.Patch("/files/{id}/rename", fileH.RenameFile)
			files.Patch("/files/{id}/star", fileH.ToggleStar)
			files.Delete("/files/{id}", fileH.DeleteFile)
			files.Get("/files/{id}/download", fileH.DownloadFile)
			files.Get("/files/{id}/preview", fileH.PreviewFile)
		})

		// Uploads (Protected)
		api.Group(func(uploads chi.Router) {
			uploads.Use(middleware.RequireAppUser)
			uploads.Post("/uploads/initiate", uploadH.InitiateUpload)
			uploads.Post("/uploads/{uploadId}/stream", uploadH.StreamUpload)
		})

		// Settings & Allocation (Protected)
		api.Group(func(prot chi.Router) {
			prot.Use(middleware.RequireAppUser)
			prot.Get("/settings", settingsH.GetSettings)
			prot.Patch("/settings", settingsH.UpdateSettings)
			prot.Get("/allocation", allocH.GetAllocation)
			prot.Patch("/allocation", allocH.UpdateAllocation)
		})
	})

	// 404 Handler
	r.NotFound(healthH.NotFound)

	serverAddr := fmt.Sprintf(":%d", cfg.Port)
	srv := &http.Server{
		Addr:         serverAddr,
		Handler:      r,
		ReadTimeout:  120 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Server start
	go func() {
		log.Printf("[OneSpace] Native Go API listening on http://localhost:%d\n", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[OneSpace] Listen error: %v\n", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("[OneSpace] Shutting down Go server gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	log.Println("[OneSpace] Server exiting.")
}
