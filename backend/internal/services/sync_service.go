package services

import (
	"context"
	"log"
	"sync"
	"time"

	"onespace/backend/internal/adapters"
	"onespace/backend/internal/config"
	"onespace/backend/internal/database"
)

type SyncReport struct {
	LastRunAt       *string `json:"lastRunAt"`
	UserID          *string `json:"userId"`
	ScannedAccounts int     `json:"scannedAccounts"`
	ChangesDetected int     `json:"changesDetected"`
	IsRunning       bool    `json:"isRunning"`
}

type SyncService struct {
	cfg        *config.Config
	db         *database.Database
	mu         sync.Mutex
	lastReport SyncReport
}

var Sync *SyncService

func InitSync(cfg *config.Config, db *database.Database) {
	Sync = &SyncService{
		cfg: cfg,
		db:  db,
		lastReport: SyncReport{
			IsRunning: false,
		},
	}
}

func (s *SyncService) GetLastReport() SyncReport {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastReport
}

func (s *SyncService) RunDeltaSync(ctx context.Context, userID string) (*SyncReport, error) {
	s.mu.Lock()
	if s.lastReport.IsRunning {
		r := s.lastReport
		s.mu.Unlock()
		return &r, nil
	}
	s.lastReport.IsRunning = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.lastReport.IsRunning = false
		s.mu.Unlock()
	}()

	accounts := s.db.ListActiveCloudAccounts(userID)
	changes := 0

	for _, acc := range accounts {
		adapter, err := adapters.CreateAdapter(&acc, s.cfg.EncryptionKey)
		if err != nil {
			log.Printf("[Sync] Error creating adapter for %s: %v\n", acc.Email, err)
			continue
		}

		files, err := adapter.FetchStructure(ctx)
		if err != nil {
			log.Printf("[Sync] Error fetching structure for %s: %v\n", acc.Email, err)
			continue
		}

		s.db.DeleteFilesByCloudAccount(userID, acc.ID)
		for i := range files {
			s.db.UpsertFile(&files[i])
		}
		changes += len(files)

		total, used, err := adapter.GetStorageSummary(ctx)
		if err == nil && total > 0 {
			acc.TotalSpace = total
			acc.UsedSpace = used
			s.db.UpsertCloudAccount(&acc)
		}
	}

	nowStr := time.Now().UTC().Format(time.RFC3339)
	s.mu.Lock()
	s.lastReport = SyncReport{
		LastRunAt:       &nowStr,
		UserID:          &userID,
		ScannedAccounts: len(accounts),
		ChangesDetected: changes,
		IsRunning:       false,
	}
	report := s.lastReport
	s.mu.Unlock()

	return &report, nil
}

func (s *SyncService) StartScheduler() {
	if s.cfg.AppMode != "local" {
		return
	}

	interval := time.Duration(s.cfg.SyncIntervalMinutes) * time.Minute
	if interval < time.Minute {
		interval = 5 * time.Minute
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for range ticker.C {
			_, _ = s.RunDeltaSync(context.Background(), database.LocalUserID)
		}
	}()
}
