package utils

import "strings"

// NormalizePath ensures paths have a leading and trailing slash, e.g. "/Docs/" or "/"
func NormalizePath(input string) string {
	clean := strings.TrimSpace(input)
	if clean == "" || clean == "/" {
		return "/"
	}
	if !strings.HasPrefix(clean, "/") {
		clean = "/" + clean
	}
	if !strings.HasSuffix(clean, "/") {
		clean = clean + "/"
	}
	return clean
}
