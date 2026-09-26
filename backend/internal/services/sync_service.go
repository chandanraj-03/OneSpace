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
	cfg          *config.Config
	db           *database.Database
	mu           sync.Mutex
	runningUsers map[string]bool
	lastReport   map[string]SyncReport
}

var Sync *SyncService

func InitSync(cfg *config.Config, db *database.Database) {
	Sync = &SyncService{
		cfg:          cfg,
		db:           db,
		runningUsers: make(map[string]bool),
		lastReport:   make(map[string]SyncReport),
	}
}

func (s *SyncService) GetLastReport(userID string) SyncReport {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r, ok := s.lastReport[userID]; ok {
		return r
	}
	return SyncReport{IsRunning: false}
}

func (s *SyncService) RunDeltaSync(ctx context.Context, userID string) (*SyncReport, error) {
	s.mu.Lock()
	if s.runningUsers[userID] {
		r := s.lastReport[userID]
		s.mu.Unlock()
		return &r, nil
	}
	s.runningUsers[userID] = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.runningUsers[userID] = false
		s.mu.Unlock()
	}()

	accounts := s.db.ListActiveCloudAccounts(userID)
	changes := 0

	log.Printf("[Sync] Starting delta sync for user %s across %d accounts...\n", userID, len(accounts))

	for _, acc := range accounts {
		adapter, err := adapters.CreateAdapter(&acc, s.cfg.EncryptionKey)
		if err != nil {
			log.Printf("[Sync] Error creating adapter for %s (%s): %v\n", acc.Email, acc.Provider, err)
			continue
		}

		files, err := adapter.FetchStructure(ctx)
		if err != nil {
			log.Printf("[Sync] Error fetching structure for %s (%s): %v\n", acc.Email, acc.Provider, err)
			continue
		}

		s.db.DeleteFilesByCloudAccount(userID, acc.ID)
		for i := range files {
			s.db.UpsertFile(&files[i])
		}
		changes += len(files)
		log.Printf("[Sync] Indexed %d items from %s (%s)\n", len(files), acc.Email, acc.Provider)

		total, used, err := adapter.GetStorageSummary(ctx)
		if err == nil && total > 0 {
			acc.TotalSpace = total
			if used > 0 {
				acc.UsedSpace = used
			}
			s.db.UpsertCloudAccount(&acc)
		}
	}

	nowStr := time.Now().UTC().Format(time.RFC3339)
	s.mu.Lock()
	rep := SyncReport{
		LastRunAt:       &nowStr,
		UserID:          &userID,
		ScannedAccounts: len(accounts),
		ChangesDetected: changes,
		IsRunning:       false,
	}
	s.lastReport[userID] = rep
	s.mu.Unlock()

	log.Printf("[Sync] Sync completed for user %s: %d changes detected across %d accounts\n", userID, changes, len(accounts))
	return &rep, nil
}

func (s *SyncService) StartScheduler() {
	interval := time.Duration(s.cfg.SyncIntervalMinutes) * time.Minute
	if interval < time.Minute {
		interval = 5 * time.Minute
	}

	log.Printf("[Sync] Background sync scheduler active (Interval: %v)\n", interval)

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for range ticker.C {
			if s.cfg.AppMode == "local" {
				_, _ = s.RunDeltaSync(context.Background(), database.LocalUserID)
			} else {
				activeUsers := s.db.ListUsersWithActiveAccounts()
				for _, uid := range activeUsers {
					_, _ = s.RunDeltaSync(context.Background(), uid)
				}
			}
		}
	}()
}
