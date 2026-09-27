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

	sealed := gcm.Seal(nil, nonce, plaintext, nil)
	tagSize := gcm.Overhead()
	ciphertext := sealed[:len(sealed)-tagSize]
	tag := sealed[len(sealed)-tagSize:]

	// Binary layout: iv[12] + authTag[16] + ciphertext[N]
	combined := append(nonce, tag...)
	combined = append(combined, ciphertext...)
	return base64.StdEncoding.EncodeToString(combined), nil
}

func tryOpenGCM(key, nonce, ciphertext, tag []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	sealed := append(ciphertext, tag...)
	return gcm.Open(nil, nonce, sealed, nil)
}

func DecryptJSON(encryptedStr string, key []byte, target interface{}) error {
	// 3-part hex format (nonce:ciphertext:tag)
	if strings.Contains(encryptedStr, ":") {
		parts := strings.Split(encryptedStr, ":")
		if len(parts) == 3 {
			nonce, err1 := hex.DecodeString(parts[0])
			ciphertext, err2 := hex.DecodeString(parts[1])
			tag, err3 := hex.DecodeString(parts[2])
			if err1 == nil && err2 == nil && err3 == nil {
				if pt, err := tryOpenGCM(key, nonce, ciphertext, tag); err == nil {
					return json.Unmarshal(pt, target)
				}
			}
		}
	}

	// Base64 format: iv[12] + authTag[16] + ciphertext[N]
	raw, err := base64.StdEncoding.DecodeString(encryptedStr)
	if err != nil {
		raw, err = base64.RawURLEncoding.DecodeString(encryptedStr)
	}

	if err == nil && len(raw) >= 28 {
		nonce := raw[:12]
		tag := raw[12:28]
		ciphertext := raw[28:]

		if pt, err := tryOpenGCM(key, nonce, ciphertext, tag); err == nil {
			return json.Unmarshal(pt, target)
		}

		// Standard GCM seal order: iv[12] + (ciphertext + tag)
		block, bErr := aes.NewCipher(key)
		if bErr == nil {
			if gcm, gErr := cipher.NewGCM(block); gErr == nil {
				if pt, err := gcm.Open(nil, raw[:12], raw[12:], nil); err == nil {
					return json.Unmarshal(pt, target)
				}
			}
		}
	}

	return errors.New("unable to decrypt credentials: authentication failed")
}
