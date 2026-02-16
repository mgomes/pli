package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/mgomes/pli/internal/app"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	addr := envOrDefault("PLI_ADDR", ":8080")
	dbPath := envOrDefault("PLI_DB_PATH", "data/pli.db")

	if err := app.Run(ctx, addr, dbPath); err != nil {
		log.Fatalf("pli failed: %v", err)
	}
}

func envOrDefault(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
