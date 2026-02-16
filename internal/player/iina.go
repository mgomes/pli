package player

import (
	"fmt"
	"os/exec"
)

const iinaAppCLI = "/Applications/IINA.app/Contents/MacOS/iina-cli"

func FindIINA() (string, error) {
	// Check the standard macOS app bundle location first.
	if path, err := exec.LookPath(iinaAppCLI); err == nil {
		return path, nil
	}
	// Fall back to PATH lookup (e.g. Homebrew symlink).
	if path, err := exec.LookPath("iina-cli"); err == nil {
		return path, nil
	}
	return "", fmt.Errorf("iina-cli not found: install IINA from https://iina.io")
}
