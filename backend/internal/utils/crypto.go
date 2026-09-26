package utils

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"
)

func Sha256(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

func SignOAuthState(payload map[string]interface{}, secret string) (string, error) {
	payload["exp"] = time.Now().Add(30 * time.Minute).UnixMilli()
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(raw)
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	rawB64 := base64.RawURLEncoding.EncodeToString(raw)

	return fmt.Sprintf("%s.%s", rawB64, sig), nil
}

func VerifyOAuthState(token string, secret string) (map[string]interface{}, error) {
	if token == "" {
		return nil, errors.New("empty token")
	}

	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, errors.New("invalid token format")
	}

	rawB64, sig := parts[0], parts[1]
	raw, err := base64.RawURLEncoding.DecodeString(rawB64)
	if err != nil {
		return nil, err
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(raw)
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	if subtle.ConstantTimeCompare([]byte(sig), []byte(expectedSig)) != 1 {
		return nil, errors.New("invalid signature")
	}

	var data map[string]interface{}
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, err
	}

	if expFloat, ok := data["exp"].(float64); ok {
		if int64(expFloat) < time.Now().UnixMilli() {
			return nil, errors.New("expired token")
		}
	}

	return data, nil
}

func EncryptJSON(data interface{}, key []byte) (string, error) {
	plaintext, err := json.Marshal(data)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	// In Node.js: cipher.update(plaintext), cipher.final(), cipher.getAuthTag()
	// In Go GCM: gcm.Seal appends tag (16 bytes) to ciphertext
	sealed := gcm.Seal(nil, nonce, plaintext, nil)
	tagSize := gcm.Overhead()
	ciphertext := sealed[:len(sealed)-tagSize]
	tag := sealed[len(sealed)-tagSize:]

	return fmt.Sprintf("%s:%s:%s",
		hex.EncodeToString(nonce),
		hex.EncodeToString(ciphertext),
		hex.EncodeToString(tag),
	), nil
}

func DecryptJSON(encryptedStr string, key []byte, target interface{}) error {
	parts := strings.Split(encryptedStr, ":")
	if len(parts) != 3 {
		return errors.New("invalid encrypted data format")
	}

	nonce, err := hex.DecodeString(parts[0])
	if err != nil {
		return err
	}
	ciphertext, err := hex.DecodeString(parts[1])
	if err != nil {
		return err
	}
	tag, err := hex.DecodeString(parts[2])
	if err != nil {
		return err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}

	sealed := append(ciphertext, tag...)
	plaintext, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return err
	}

	return json.Unmarshal(plaintext, target)
}

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return "", err
	}

	hash, err := scrypt.Key([]byte(password), salt, 16384, 8, 1, 64)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%x:%x", salt, hash), nil
}

func VerifyPassword(password, storedHash string) bool {
	parts := strings.Split(storedHash, ":")
	if len(parts) != 2 {
		return false
	}

	salt, err := hex.DecodeString(parts[0])
	if err != nil {
		return false
	}
	expectedHash, err := hex.DecodeString(parts[1])
	if err != nil {
		return false
	}

	actualHash, err := scrypt.Key([]byte(password), salt, 16384, 8, 1, 64)
	if err != nil {
		return false
	}

	return subtle.ConstantTimeCompare(actualHash, expectedHash) == 1
}
