package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"onespace/backend/internal/database"
	"onespace/backend/internal/middleware"
	"onespace/backend/internal/models"

	"github.com/google/uuid"
)

type AllocationHandler struct {
	db *database.Database
}

func NewAllocationHandler(db *database.Database) *AllocationHandler {
	return &AllocationHandler{db: db}
}

func (h *AllocationHandler) GetAllocation(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())
	setting := h.db.GetSetting(user.ID, "allocation_strategy")

	strategy := "most_free"
	if setting != nil && setting.Value != "" {
		strategy = setting.Value
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": map[string]string{
			"strategy": strategy,
		},
	})
}

func (h *AllocationHandler) UpdateAllocation(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())

	var body struct {
		Strategy string `json:"strategy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Strategy == "" {
		http.Error(w, "strategy is required", http.StatusBadRequest)
		return
	}

	h.db.UpsertSetting(&models.UserSetting{
		ID:        uuid.NewString(),
		UserID:    user.ID,
		Key:       "allocation_strategy",
		Value:     body.Strategy,
		UpdatedAt: time.Now(),
	})

	h.GetAllocation(w, r)
}
