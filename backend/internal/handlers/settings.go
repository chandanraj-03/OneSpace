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

type SettingsHandler struct {
	db *database.Database
}

func NewSettingsHandler(db *database.Database) *SettingsHandler {
	return &SettingsHandler{db: db}
}

func (h *SettingsHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())
	settingsList := h.db.ListSettings(user.ID)

	data := map[string]interface{}{}
	for _, s := range settingsList {
		var val interface{}
		if err := json.Unmarshal([]byte(s.Value), &val); err == nil {
			data[s.Key] = val
		} else {
			data[s.Key] = s.Value
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"data": data,
	})
}

func (h *SettingsHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromContext(r.Context())

	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid settings payload", http.StatusBadRequest)
		return
	}

	for k, v := range body {
		valBytes, _ := json.Marshal(v)
		h.db.UpsertSetting(&models.UserSetting{
			ID:        uuid.NewString(),
			UserID:    user.ID,
			Key:       k,
			Value:     string(valBytes),
			UpdatedAt: time.Now(),
		})
	}

	h.GetSettings(w, r)
}
