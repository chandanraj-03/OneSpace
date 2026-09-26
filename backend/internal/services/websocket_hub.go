package services

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type WebSocketHub struct {
	mu      sync.RWMutex
	sockets map[string]*websocket.Conn
}

var Hub *WebSocketHub

func init() {
	Hub = &WebSocketHub{
		sockets: make(map[string]*websocket.Conn),
	}
}

func (h *WebSocketHub) HandleConnection(w http.ResponseWriter, r *http.Request) {
	uploadID := r.URL.Query().Get("uploadId")
	if uploadID == "" {
		http.Error(w, "uploadId is required", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WebSocket] Upgrade error: %v\n", err)
		return
	}

	h.mu.Lock()
	h.sockets[uploadID] = conn
	h.mu.Unlock()

	_ = conn.WriteJSON(map[string]interface{}{
		"type":     "socket:ready",
		"uploadId": uploadID,
		"status":   "connected",
	})

	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.sockets, uploadID)
			h.mu.Unlock()
			_ = conn.Close()
		}()

		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				break
			}
		}
	}()
}

func (h *WebSocketHub) Emit(uploadID string, event map[string]interface{}) {
	h.mu.RLock()
	conn, ok := h.sockets[uploadID]
	h.mu.RUnlock()

	if ok && conn != nil {
		raw, _ := json.Marshal(event)
		_ = conn.WriteMessage(websocket.TextMessage, raw)
	}
}
