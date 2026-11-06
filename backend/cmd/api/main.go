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
	"github.com/Yose1001/taskflow/backend/internal/purge"
	"github.com/Yose1001/taskflow/backend/internal/repository"
	"github.com/Yose1001/taskflow/backend/internal/router"
	"github.com/Yose1001/taskflow/backend/internal/service"
)

const (
	purgeInterval  = 24 * time.Hour
	purgeBatchSize = 500
	// purgeLockKey is an arbitrary application-wide number for the PostgreSQL advisory lock.
	purgeLockKey int64 = 7_283_001
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
	projectRepo := repository.NewProjectRepo(pool)
	projectSvc := service.NewProjects(projectRepo, userRepo, cfg.TrashRetentionDays)
	taskSvc := service.NewTasks(repository.NewTaskRepo(pool), projectRepo, cfg.TrashRetentionDays)

	handler := router.New(router.Deps{
		DB:            pool,
		Auth:          handlerpkg.NewAuth(authSvc),
		Projects:      handlerpkg.NewProjects(projectSvc),
		Tasks:         handlerpkg.NewTasks(taskSvc),
		Authenticate:  middleware.Authenticate(authSvc),
		LoginLimit:    middleware.NewRateLimiter(cfg.LoginRateLimit, time.Minute).Middleware,
		RegisterLimit: middleware.NewRateLimiter(cfg.RegisterRateLimit, time.Minute).Middleware,
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Permanently delete trash older than the retention period: at startup, then once a day.
	// The advisory lock lets several server instances share one database without purging twice.
	purger, err := purge.New(repository.NewPurgeRepo(pool), cfg.TrashRetentionDays, purgeBatchSize)
	if err != nil {
		logger.Error("cannot start purge job", "error", err)
		os.Exit(1)
	}
	purgeDone := make(chan struct{})
	go func() {
		defer close(purgeDone)
		purge.Schedule(ctx, purgeInterval, database.NewLocker(pool, purgeLockKey), purger, logger)
	}()

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

	// Let a running purge finish its current batch before the database pool closes.
	select {
	case <-purgeDone:
	case <-shutdownCtx.Done():
		logger.Warn("purge job did not stop in time")
	}
}
