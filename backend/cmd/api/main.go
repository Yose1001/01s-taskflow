// Command api starts the TaskFlow HTTP server.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/config"
	"github.com/Yose1001/taskflow/backend/internal/database"
	handlerpkg "github.com/Yose1001/taskflow/backend/internal/handler"
	"github.com/Yose1001/taskflow/backend/internal/middleware"
	"github.com/Yose1001/taskflow/backend/internal/repository"
	"github.com/Yose1001/taskflow/backend/internal/router"
	"github.com/Yose1001/taskflow/backend/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := database.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database unavailable", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	authSvc, err := service.NewAuth(repository.NewUserRepo(pool), cfg.JWTSecret, cfg.JWTTTL)
	if err != nil {
		logger.Error("cannot start auth service", "error", err)
		os.Exit(1)
	}

	userRepo := repository.NewUserRepo(pool)
	projectSvc := service.NewProjects(repository.NewProjectRepo(pool), userRepo, cfg.TrashRetentionDays)

	handler := router.New(router.Deps{
		DB:            pool,
		Auth:          handlerpkg.NewAuth(authSvc),
		Projects:      handlerpkg.NewProjects(projectSvc),
		Authenticate:  middleware.Authenticate(authSvc),
		LoginLimit:    middleware.NewRateLimiter(10, time.Minute).Middleware,
		RegisterLimit: middleware.NewRateLimiter(5, time.Minute).Middleware,
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		logger.Info("server starting", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	logger.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
		os.Exit(1)
	}
}
