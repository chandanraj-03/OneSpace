package models

import "time"

type User struct {
	ID           string    `json:"id" bson:"id"`
	Email        string    `json:"email" bson:"email"`
	PasswordHash string    `json:"password_hash,omitempty" bson:"password_hash"`
	IsLocal      int       `json:"is_local" bson:"is_local"`
	CreatedAt    time.Time `json:"created_at" bson:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" bson:"updated_at"`
}

type AuthSession struct {
	ID         string    `json:"id" bson:"id"`
	UserID     string    `json:"user_id" bson:"user_id"`
	TokenHash  string    `json:"token_hash" bson:"token_hash"`
	ExpiresAt  time.Time `json:"expires_at" bson:"expires_at"`
	CreatedAt  time.Time `json:"created_at" bson:"created_at"`
	LastUsedAt time.Time `json:"last_used_at" bson:"last_used_at"`
}

type CloudAccount struct {
	ID                   string    `json:"id" bson:"id"`
	UserID               string    `json:"user_id" bson:"user_id"`
	Provider             string    `json:"provider" bson:"provider"`
	Email                string    `json:"email" bson:"email"`
	EncryptedCredentials string    `json:"encrypted_credentials" bson:"encrypted_credentials"`
	TotalSpace           int64     `json:"total_space" bson:"total_space"`
	UsedSpace            int64     `json:"used_space" bson:"used_space"`
	Status               string    `json:"status" bson:"status"`
	CreatedAt            time.Time `json:"created_at" bson:"created_at"`
	UpdatedAt            time.Time `json:"updated_at" bson:"updated_at"`
}

type FileMetadata struct {
	ID                 string    `json:"id" bson:"id"`
	UserID             string    `json:"user_id" bson:"user_id"`
	CloudAccountID     string    `json:"cloud_account_id" bson:"cloud_account_id"`
	RemoteFileID       string    `json:"remote_file_id" bson:"remote_file_id"`
	FileName           string    `json:"file_name" bson:"file_name"`
	FileSize           int64     `json:"file_size" bson:"file_size"`
	MimeType           string    `json:"mime_type" bson:"mime_type"`
	VirtualPath        string    `json:"virtual_path" bson:"virtual_path"`
	RemoteParentID     *string   `json:"remote_parent_id,omitempty" bson:"remote_parent_id"`
	IsFolder           bool      `json:"is_folder" bson:"is_folder"`
	IsStarred          bool      `json:"is_starred" bson:"is_starred"`
	RemoteCreatedTime  *string   `json:"remote_created_time,omitempty" bson:"remote_created_time"`
	RemoteModifiedTime *string   `json:"remote_modified_time,omitempty" bson:"remote_modified_time"`
	CreatedAt          time.Time `json:"created_at" bson:"created_at"`
	UpdatedAt          time.Time `json:"updated_at" bson:"updated_at"`

	// Joined fields
	Provider string `json:"provider,omitempty" bson:"-"`
	Email    string `json:"email,omitempty" bson:"-"`
}

type UserSetting struct {
	ID        string    `json:"id" bson:"id"`
	UserID    string    `json:"user_id" bson:"user_id"`
	Key       string    `json:"key" bson:"key"`
	Value     string    `json:"value" bson:"value"`
	UpdatedAt time.Time `json:"updated_at" bson:"updated_at"`
}

type UploadSession struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	Token          string    `json:"session_token"`
	FileName       string    `json:"file_name"`
	Size           int64     `json:"size"`
	MimeType       string    `json:"mime_type"`
	VirtualPath    string    `json:"virtual_path"`
	RemoteParentID *string   `json:"remote_parent_id"`
	CloudAccountID string    `json:"cloud_account_id"`
	FallbackChain  []string  `json:"fallback_chain"`
	CreatedAt      time.Time `json:"created_at"`
}
