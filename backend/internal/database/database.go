package database

import (
	"context"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"onespace/backend/internal/models"
	"onespace/backend/internal/utils"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

const (
	LocalUserID    = "local-default-user"
	LocalUserEmail = "local@onespace.local"
)

type Database struct {
	mu           sync.RWMutex
	users        map[string]*models.User
	authSessions map[string]*models.AuthSession
	accounts     map[string]*models.CloudAccount
	files        map[string]*models.FileMetadata
	settings     map[string]*models.UserSetting

	mongoClient *mongo.Client
	mongoDb     *mongo.Database
	isConnected bool
}

var DB *Database

func init() {
	now := time.Now()
	DB = &Database{
		users:        make(map[string]*models.User),
		authSessions: make(map[string]*models.AuthSession),
		accounts:     make(map[string]*models.CloudAccount),
		files:        make(map[string]*models.FileMetadata),
		settings:     make(map[string]*models.UserSetting),
	}

	// Default local user
	DB.users[LocalUserID] = &models.User{
		ID:        LocalUserID,
		Email:     LocalUserEmail,
		IsLocal:   1,
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func (d *Database) InitMongo(uri string) {
	if uri == "" {
		log.Println("[MongoDB] MONGODB_URI not provided. Operating with in-memory persistence.")
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	clientOpts := options.Client().ApplyURI(uri).SetServerSelectionTimeout(8 * time.Second)
	client, err := mongo.Connect(ctx, clientOpts)
	if err != nil {
		log.Printf("[MongoDB] Failed to connect to MongoDB Atlas: %v\n", err)
		return
	}

	if err := client.Ping(ctx, nil); err != nil {
		log.Printf("[MongoDB] Ping failed to MongoDB Atlas: %v\n", err)
		return
	}

	d.mongoClient = client
	d.mongoDb = client.Database("onespace")
	d.isConnected = true
	log.Println("[MongoDB] Connected to MongoDB Atlas (onespace) successfully!")

	// Hydrate collections
	d.hydrate(context.Background())
}

func parseFlexibleTime(val interface{}) time.Time {
	switch v := val.(type) {
	case time.Time:
		return v
	case primitive.DateTime:
		return v.Time()
	case string:
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			return t
		}
		if t, err := time.Parse("2006-01-02 15:04:05", v); err == nil {
			return t
		}
		if t, err := time.Parse("2006-01-02T15:04:05.999Z07:00", v); err == nil {
			return t
		}
	}
	return time.Now()
}

func (d *Database) hydrate(ctx context.Context) {
	d.mu.Lock()
	defer d.mu.Unlock()

	// Users
	if cur, err := d.mongoDb.Collection("users").Find(ctx, bson.M{}); err == nil {
		var docs []models.User
		if err := cur.All(ctx, &docs); err == nil {
			for i := range docs {
				d.users[docs[i].ID] = &docs[i]
			}
			log.Printf("[MongoDB] Hydrated %d users\n", len(docs))
		} else {
			log.Printf("[MongoDB] Users standard hydration note: %v. Running resilient fallback parser...\n", err)
			cur2, err2 := d.mongoDb.Collection("users").Find(ctx, bson.M{})
			if err2 == nil {
				var rawDocs []bson.M
				if err3 := cur2.All(ctx, &rawDocs); err3 == nil {
					for _, raw := range rawDocs {
						id, _ := raw["id"].(string)
						email, _ := raw["email"].(string)
						if id != "" && email != "" {
							u := &models.User{
								ID:        id,
								Email:     email,
								CreatedAt: parseFlexibleTime(raw["created_at"]),
								UpdatedAt: parseFlexibleTime(raw["updated_at"]),
							}
							if localVal, ok := raw["is_local"].(int32); ok {
								u.IsLocal = int(localVal)
							} else if localVal, ok := raw["is_local"].(int); ok {
								u.IsLocal = localVal
							}
							d.users[id] = u
						}
					}
					log.Printf("[MongoDB] Hydrated %d users via resilient fallback parser\n", len(d.users))
				}
			}
		}
	}

	// Auth Sessions
	if cur, err := d.mongoDb.Collection("auth_sessions").Find(ctx, bson.M{}); err == nil {
		var docs []models.AuthSession
		if err := cur.All(ctx, &docs); err == nil {
			for i := range docs {
				d.authSessions[docs[i].ID] = &docs[i]
			}
			log.Printf("[MongoDB] Hydrated %d auth sessions\n", len(docs))
		}
	}

	// Cloud Accounts
	if cur, err := d.mongoDb.Collection("cloud_accounts").Find(ctx, bson.M{}); err == nil {
		var docs []models.CloudAccount
		if err := cur.All(ctx, &docs); err == nil {
			for i := range docs {
				d.accounts[docs[i].ID] = &docs[i]
			}
			log.Printf("[MongoDB] Hydrated %d cloud accounts\n", len(docs))
		}
	}

	// File Metadata
	if cur, err := d.mongoDb.Collection("file_metadata").Find(ctx, bson.M{}); err == nil {
		var docs []models.FileMetadata
		if err := cur.All(ctx, &docs); err == nil {
			for i := range docs {
				d.files[docs[i].ID] = &docs[i]
			}
			log.Printf("[MongoDB] Hydrated %d files\n", len(docs))
		}
	}

	// User Settings
	if cur, err := d.mongoDb.Collection("user_settings").Find(ctx, bson.M{}); err == nil {
		var docs []models.UserSetting
		if err := cur.All(ctx, &docs); err == nil {
			for i := range docs {
				d.settings[docs[i].ID] = &docs[i]
			}
			log.Printf("[MongoDB] Hydrated %d user settings\n", len(docs))
		}
	}
}

func (d *Database) asyncPersist(table string, id string, doc interface{}) {
	if !d.isConnected || d.mongoDb == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		opts := options.Update().SetUpsert(true)
		_, err := d.mongoDb.Collection(table).UpdateOne(ctx, bson.M{"id": id}, bson.M{"$set": doc}, opts)
		if err != nil {
			log.Printf("[MongoDB] Error writing %s/%s: %v\n", table, id, err)
		}
	}()
}

func (d *Database) asyncDelete(table string, filter bson.M) {
	if !d.isConnected || d.mongoDb == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := d.mongoDb.Collection(table).DeleteMany(ctx, filter)
		if err != nil {
			log.Printf("[MongoDB] Error deleting %s: %v\n", table, err)
		}
	}()
}

// -----------------------------------------------------------------------------
// Users
// -----------------------------------------------------------------------------

func (d *Database) GetUserByID(id string) *models.User {
	d.mu.RLock()
	u, ok := d.users[id]
	d.mu.RUnlock()
	if ok && u != nil {
		clone := *u
		return &clone
	}

	// Fallback direct query to MongoDB if not in memory
	if d.isConnected && d.mongoDb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		var dbUser models.User
		err := d.mongoDb.Collection("users").FindOne(ctx, bson.M{"id": id}).Decode(&dbUser)
		if err == nil && dbUser.ID != "" {
			d.mu.Lock()
			d.users[dbUser.ID] = &dbUser
			d.mu.Unlock()
			return &dbUser
		}
	}

	return nil
}

func (d *Database) GetUserByEmail(email string) *models.User {
	norm := strings.ToLower(strings.TrimSpace(email))
	d.mu.RLock()
	var bestMatch *models.User
	for _, u := range d.users {
		if strings.ToLower(strings.TrimSpace(u.Email)) == norm {
			if bestMatch == nil {
				bestMatch = u
			} else if bestMatch.IsLocal == 1 && u.IsLocal == 0 {
				bestMatch = u
			}
		}
	}
	d.mu.RUnlock()

	if bestMatch != nil {
		clone := *bestMatch
		return &clone
	}

	// Fallback direct query to MongoDB if not in memory
	if d.isConnected && d.mongoDb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		var dbUser models.User
		err := d.mongoDb.Collection("users").FindOne(ctx, bson.M{
			"email": bson.M{"$regex": fmt.Sprintf("^%s$", regexp.QuoteMeta(norm)), "$options": "i"},
		}).Decode(&dbUser)
		if err == nil && dbUser.ID != "" {
			d.mu.Lock()
			d.users[dbUser.ID] = &dbUser
			d.mu.Unlock()
			return &dbUser
		}
	}

	return nil
}

func (d *Database) CreateUser(u *models.User) {
	d.mu.Lock()
	defer d.mu.Unlock()
	// Ensure we don't create a duplicate user if email already exists
	norm := strings.ToLower(strings.TrimSpace(u.Email))
	for _, existing := range d.users {
		if strings.ToLower(strings.TrimSpace(existing.Email)) == norm {
			u.ID = existing.ID
			break
		}
	}
	d.users[u.ID] = u
	d.asyncPersist("users", u.ID, u)
}

// -----------------------------------------------------------------------------
// Auth Sessions
// -----------------------------------------------------------------------------

func (d *Database) CreateSession(s *models.AuthSession) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.authSessions[s.ID] = s
	d.asyncPersist("auth_sessions", s.ID, s)
}

func (d *Database) GetSessionByTokenHash(tokenHash string) (*models.AuthSession, *models.User) {
	d.mu.RLock()
	for _, s := range d.authSessions {
		if s.TokenHash == tokenHash {
			if s.ExpiresAt.Before(time.Now()) {
				d.mu.RUnlock()
				return nil, nil
			}
			user, ok := d.users[s.UserID]
			if !ok {
				// Safety fallback: if user wasn't in memory, query directly
				d.mu.RUnlock()
				if d.isConnected && d.mongoDb != nil {
					ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
					var dbUser models.User
					err := d.mongoDb.Collection("users").FindOne(ctx, bson.M{"id": s.UserID}).Decode(&dbUser)
					cancel()
					if err == nil && dbUser.ID != "" {
						d.mu.Lock()
						d.users[dbUser.ID] = &dbUser
						d.mu.Unlock()
						sClone := *s
						return &sClone, &dbUser
					}
				}
				return nil, nil
			}
			d.mu.RUnlock()
			sClone := *s
			uClone := *user
			return &sClone, &uClone
		}
	}
	d.mu.RUnlock()

	// Safety fallback if session is in Mongo but not in memory
	if d.isConnected && d.mongoDb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		var dbSession models.AuthSession
		err := d.mongoDb.Collection("auth_sessions").FindOne(ctx, bson.M{"token_hash": tokenHash}).Decode(&dbSession)
		if err == nil && dbSession.ID != "" && dbSession.ExpiresAt.After(time.Now()) {
			var dbUser models.User
			uErr := d.mongoDb.Collection("users").FindOne(ctx, bson.M{"id": dbSession.UserID}).Decode(&dbUser)
			if uErr == nil && dbUser.ID != "" {
				d.mu.Lock()
				d.authSessions[dbSession.ID] = &dbSession
				d.users[dbUser.ID] = &dbUser
				d.mu.Unlock()
				return &dbSession, &dbUser
			}
		}
	}

	return nil, nil
}

func (d *Database) TouchSession(id string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if s, ok := d.authSessions[id]; ok {
		s.LastUsedAt = time.Now()
		d.asyncPersist("auth_sessions", id, s)
	}
}

func (d *Database) DeleteSessionByTokenHash(tokenHash string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for id, s := range d.authSessions {
		if s.TokenHash == tokenHash {
			delete(d.authSessions, id)
			break
		}
	}
	d.asyncDelete("auth_sessions", bson.M{"token_hash": tokenHash})
}

// -----------------------------------------------------------------------------
// Cloud Accounts
// -----------------------------------------------------------------------------

func (d *Database) UpsertCloudAccount(acc *models.CloudAccount) {
	d.mu.Lock()
	defer d.mu.Unlock()

	// Check existing by user_id + provider + email (case insensitive)
	for _, a := range d.accounts {
		if a.UserID == acc.UserID && a.Provider == acc.Provider && strings.EqualFold(strings.TrimSpace(a.Email), strings.TrimSpace(acc.Email)) {
			acc.ID = a.ID
			acc.CreatedAt = a.CreatedAt
			break
		}
	}

	d.accounts[acc.ID] = acc
	d.asyncPersist("cloud_accounts", acc.ID, acc)
}

func (d *Database) GetCloudAccount(userID, id string) *models.CloudAccount {
	d.mu.RLock()
	defer d.mu.RUnlock()
	a, ok := d.accounts[id]
	if !ok || a.UserID != userID {
		return nil
	}
	clone := *a
	return &clone
}

func (d *Database) ListCloudAccounts(userID string) []models.CloudAccount {
	d.mu.RLock()
	var list []models.CloudAccount
	for _, a := range d.accounts {
		if a.UserID == userID {
			list = append(list, *a)
		}
	}
	d.mu.RUnlock()

	// Safety fallback: if 0 accounts in memory for this user, check Mongo directly
	if len(list) == 0 && d.isConnected && d.mongoDb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		cur, err := d.mongoDb.Collection("cloud_accounts").Find(ctx, bson.M{"user_id": userID})
		if err == nil {
			var dbAccounts []models.CloudAccount
			if err := cur.All(ctx, &dbAccounts); err == nil && len(dbAccounts) > 0 {
				d.mu.Lock()
				for i := range dbAccounts {
					d.accounts[dbAccounts[i].ID] = &dbAccounts[i]
					list = append(list, dbAccounts[i])
				}
				d.mu.Unlock()
			}
		}
	}

	sort.Slice(list, func(i, j int) bool {
		if list[i].Provider != list[j].Provider {
			return list[i].Provider < list[j].Provider
		}
		return list[i].Email < list[j].Email
	})
	return list
}

func (d *Database) ListActiveCloudAccounts(userID string) []models.CloudAccount {
	d.mu.RLock()
	defer d.mu.RUnlock()
	var list []models.CloudAccount
	for _, a := range d.accounts {
		if a.UserID == userID && a.Status == "active" {
			list = append(list, *a)
		}
	}
	return list
}

func (d *Database) DeleteCloudAccount(userID, id string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if a, ok := d.accounts[id]; ok && a.UserID == userID {
		delete(d.accounts, id)
		d.asyncDelete("cloud_accounts", bson.M{"id": id, "user_id": userID})
	}
}

// -----------------------------------------------------------------------------
// File Metadata
// -----------------------------------------------------------------------------

func (d *Database) UpsertFile(file *models.FileMetadata) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.files[file.ID] = file
	d.asyncPersist("file_metadata", file.ID, file)
}

func (d *Database) GetFileByID(userID, id string) *models.FileMetadata {
	d.mu.RLock()
	defer d.mu.RUnlock()
	f, ok := d.files[id]
	if !ok || f.UserID != userID {
		return nil
	}
	clone := *f
	if ca, ok := d.accounts[f.CloudAccountID]; ok && ca.Status == "active" {
		clone.Provider = ca.Provider
		clone.Email = ca.Email
	}
	return &clone
}

func (d *Database) GetFileByRemoteID(userID, accountID, remoteID string) *models.FileMetadata {
	d.mu.RLock()
	defer d.mu.RUnlock()
	for _, f := range d.files {
		if f.UserID == userID && f.CloudAccountID == accountID && f.RemoteFileID == remoteID {
			clone := *f
			if ca, ok := d.accounts[f.CloudAccountID]; ok && ca.Status == "active" {
				clone.Provider = ca.Provider
				clone.Email = ca.Email
			}
			return &clone
		}
	}
	return nil
}

func (d *Database) ListUsersWithActiveAccounts() []string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	seen := make(map[string]bool)
	var userIDs []string
	for _, a := range d.accounts {
		if a.Status == "active" && !seen[a.UserID] {
			seen[a.UserID] = true
			userIDs = append(userIDs, a.UserID)
		}
	}
	return userIDs
}

func (d *Database) CountFilesByUser(userID string) int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	count := 0
	for _, f := range d.files {
		if f.UserID == userID {
			count++
		}
	}
	return count
}

func (d *Database) ListFilesByPath(userID, virtualPath string) []models.FileMetadata {
	d.mu.RLock()
	defer d.mu.RUnlock()
	normPath := utils.NormalizePath(virtualPath)
	var list []models.FileMetadata
	for _, f := range d.files {
		if f.UserID == userID && utils.NormalizePath(f.VirtualPath) == normPath {
			clone := *f
			if f.CloudAccountID != "" {
				if ca, ok := d.accounts[f.CloudAccountID]; ok {
					if ca.Status != "active" {
						continue
					}
					clone.Provider = ca.Provider
					clone.Email = ca.Email
				}
			}
			if clone.Size == 0 && clone.FileSize > 0 {
				clone.Size = clone.FileSize
			}
			if clone.FileSize == 0 && clone.Size > 0 {
				clone.FileSize = clone.Size
			}
			list = append(list, clone)
		}
	}

	sort.Slice(list, func(i, j int) bool {
		if list[i].IsFolder != list[j].IsFolder {
			return list[i].IsFolder
		}
		return strings.ToLower(list[i].FileName) < strings.ToLower(list[j].FileName)
	})
	return list
}

func (d *Database) SearchFiles(userID, term string, limit int) []models.FileMetadata {
	d.mu.RLock()
	defer d.mu.RUnlock()
	clean := strings.ToLower(strings.TrimSpace(term))
	var list []models.FileMetadata
	for _, f := range d.files {
		if f.UserID == userID && strings.Contains(strings.ToLower(f.FileName), clean) {
			clone := *f
			if f.CloudAccountID != "" {
				if ca, ok := d.accounts[f.CloudAccountID]; ok {
					if ca.Status != "active" {
						continue
					}
					clone.Provider = ca.Provider
					clone.Email = ca.Email
				}
			}
			if clone.Size == 0 && clone.FileSize > 0 {
				clone.Size = clone.FileSize
			}
			if clone.FileSize == 0 && clone.Size > 0 {
				clone.FileSize = clone.Size
			}
			list = append(list, clone)
			if limit > 0 && len(list) >= limit {
				break
			}
		}
	}
	return list
}

func (d *Database) ListStarredFiles(userID string) []models.FileMetadata {
	d.mu.RLock()
	defer d.mu.RUnlock()
	var list []models.FileMetadata
	for _, f := range d.files {
		if f.UserID == userID && f.IsStarred {
			clone := *f
			if f.CloudAccountID != "" {
				if ca, ok := d.accounts[f.CloudAccountID]; ok {
					if ca.Status != "active" {
						continue
					}
					clone.Provider = ca.Provider
					clone.Email = ca.Email
				}
			}
			if clone.Size == 0 && clone.FileSize > 0 {
				clone.Size = clone.FileSize
			}
			if clone.FileSize == 0 && clone.Size > 0 {
				clone.FileSize = clone.Size
			}
			list = append(list, clone)
		}
	}
	return list
}

func (d *Database) ListRecentFiles(userID string) []models.FileMetadata {
	d.mu.RLock()
	defer d.mu.RUnlock()
	var list []models.FileMetadata
	for _, f := range d.files {
		if f.UserID == userID && !f.IsFolder {
			clone := *f
			if f.CloudAccountID != "" {
				if ca, ok := d.accounts[f.CloudAccountID]; ok {
					if ca.Status != "active" {
						continue
					}
					clone.Provider = ca.Provider
					clone.Email = ca.Email
				}
			}
			if clone.Size == 0 && clone.FileSize > 0 {
				clone.Size = clone.FileSize
			}
			if clone.FileSize == 0 && clone.Size > 0 {
				clone.FileSize = clone.Size
			}
			list = append(list, clone)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.After(list[j].CreatedAt)
	})
	if len(list) > 50 {
		list = list[:50]
	}
	return list
}

func (d *Database) DeleteFile(userID, id string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if f, ok := d.files[id]; ok && f.UserID == userID {
		delete(d.files, id)
		d.asyncDelete("file_metadata", bson.M{"id": id, "user_id": userID})
	}
}

func (d *Database) DeleteFilesByCloudAccount(userID, accountID string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for id, f := range d.files {
		if f.UserID == userID && f.CloudAccountID == accountID {
			delete(d.files, id)
		}
	}
	d.asyncDelete("file_metadata", bson.M{"user_id": userID, "cloud_account_id": accountID})
}

func (d *Database) ReplaceFilesForAccount(userID, accountID string, newFiles []models.FileMetadata) {
	d.mu.Lock()
	// 1. Remove old files from memory
	for id, f := range d.files {
		if f.UserID == userID && f.CloudAccountID == accountID {
			delete(d.files, id)
		}
	}
	// 2. Add new files to memory
	for i := range newFiles {
		d.files[newFiles[i].ID] = &newFiles[i]
	}
	d.mu.Unlock()

	// 3. Batch persist to MongoDB asynchronously
	if !d.isConnected || d.mongoDb == nil {
		return
	}
	go func(filesToPersist []models.FileMetadata) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()

		col := d.mongoDb.Collection("file_metadata")
		_, _ = col.DeleteMany(ctx, bson.M{"user_id": userID, "cloud_account_id": accountID})

		if len(filesToPersist) == 0 {
			return
		}

		// Insert in chunks of 2000
		chunkSize := 2000
		for i := 0; i < len(filesToPersist); i += chunkSize {
			end := i + chunkSize
			if end > len(filesToPersist) {
				end = len(filesToPersist)
			}
			chunk := filesToPersist[i:end]
			docs := make([]interface{}, len(chunk))
			for j := range chunk {
				docs[j] = chunk[j]
			}
			_, _ = col.InsertMany(ctx, docs)
		}
	}(newFiles)
}

func (d *Database) DeleteFilesByVirtualPath(userID, exactPath, prefixPath string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	prefix := strings.ReplaceAll(prefixPath, "%", "")
	for id, f := range d.files {
		if f.UserID == userID && (f.VirtualPath == exactPath || strings.HasPrefix(f.VirtualPath, prefix)) {
			delete(d.files, id)
		}
	}
	d.asyncDelete("file_metadata", bson.M{
		"user_id": userID,
		"$or": []bson.M{
			{"virtual_path": exactPath},
			{"virtual_path": bson.M{"$regex": "^" + prefix}},
		},
	})
}

// -----------------------------------------------------------------------------
// User Settings
// -----------------------------------------------------------------------------

func (d *Database) GetSetting(userID, key string) *models.UserSetting {
	d.mu.RLock()
	defer d.mu.RUnlock()
	for _, s := range d.settings {
		if s.UserID == userID && s.Key == key {
			clone := *s
			return &clone
		}
	}
	return nil
}

func (d *Database) UpsertSetting(s *models.UserSetting) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, existing := range d.settings {
		if existing.UserID == s.UserID && existing.Key == s.Key {
			s.ID = existing.ID
			break
		}
	}
	d.settings[s.ID] = s
	d.asyncPersist("user_settings", s.ID, s)
}

func (d *Database) ListSettings(userID string) []models.UserSetting {
	d.mu.RLock()
	defer d.mu.RUnlock()
	var list []models.UserSetting
	for _, s := range d.settings {
		if s.UserID == userID {
			list = append(list, *s)
		}
	}
	return list
}
