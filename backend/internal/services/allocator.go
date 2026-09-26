package services

import (
	"errors"
	"sort"

	"onespace/backend/internal/database"
	"onespace/backend/internal/models"
)

type AllocationResult struct {
	Selected      *models.CloudAccount   `json:"selected"`
	FallbackChain []*models.CloudAccount `json:"fallbackChain"`
}

type AllocatorService struct {
	db *database.Database
}

var Allocator *AllocatorService

func InitAllocator(db *database.Database) {
	Allocator = &AllocatorService{db: db}
}

func (s *AllocatorService) SelectBestAccount(userID string, requiredBytes int64) (*AllocationResult, error) {
	accounts := s.db.ListActiveCloudAccounts(userID)
	if len(accounts) == 0 {
		return nil, errors.New("no active cloud accounts connected")
	}

	type accCandidate struct {
		account   models.CloudAccount
		freeSpace int64
	}

	var candidates []accCandidate
	for _, acc := range accounts {
		if acc.Provider == "google_photos" {
			continue // Readonly
		}
		free := acc.TotalSpace - acc.UsedSpace
		if free >= requiredBytes || acc.TotalSpace == 0 {
			candidates = append(candidates, accCandidate{
				account:   acc,
				freeSpace: free,
			})
		}
	}

	if len(candidates) == 0 {
		// Return any writable account if strict space check fails
		for _, acc := range accounts {
			if acc.Provider != "google_photos" {
				candidates = append(candidates, accCandidate{
					account:   acc,
					freeSpace: acc.TotalSpace - acc.UsedSpace,
				})
			}
		}
	}

	if len(candidates) == 0 {
		return nil, errors.New("no writable cloud accounts available")
	}

	// Sort by most free space
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].freeSpace > candidates[j].freeSpace
	})

	selected := candidates[0].account
	var fallback []*models.CloudAccount
	for i := 1; i < len(candidates); i++ {
		acc := candidates[i].account
		fallback = append(fallback, &acc)
	}

	return &AllocationResult{
		Selected:      &selected,
		FallbackChain: fallback,
	}, nil
}
