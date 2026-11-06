package testutil

import (
	"bytes"
	"context"
	"sync"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/model"
)

type memSession struct {
	userID        string
	hash          []byte
	previous      []byte
	previousUntil time.Time
	expires       time.Time
}

// MemSessionStore is an in-memory service.SessionStore with the same rules as repository.SessionRepo.
type MemSessionStore struct {
	mu       sync.Mutex
	sessions []*memSession
}

// NewMemSessionStore returns an empty store.
func NewMemSessionStore() *MemSessionStore { return &MemSessionStore{} }

// CreateSession stores a session.
func (s *MemSessionStore) CreateSession(_ context.Context, userID string, hash []byte, expiresAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions = append(s.sessions, &memSession{userID: userID, hash: hash, expires: expiresAt})
	return nil
}

// RotateSession mirrors repository.SessionRepo.RotateSession.
func (s *MemSessionStore) RotateSession(_ context.Context, oldHash, newHash []byte, now, expiresAt, graceUntil time.Time) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, x := range s.sessions {
		if bytes.Equal(x.hash, oldHash) && x.expires.After(now) {
			x.previous, x.previousUntil = x.hash, graceUntil
			x.hash, x.expires = newHash, expiresAt
			return x.userID, true, nil
		}
	}
	for i, x := range s.sessions {
		if x.previous != nil && bytes.Equal(x.previous, oldHash) && x.expires.After(now) {
			if x.previousUntil.After(now) {
				return x.userID, false, nil
			}
			s.sessions = append(s.sessions[:i], s.sessions[i+1:]...) // replayed old token: end the session
			return "", false, model.ErrNotFound
		}
	}
	return "", false, model.ErrNotFound
}

// DeleteSession removes the session whose current or previous token matches.
func (s *MemSessionStore) DeleteSession(_ context.Context, hash []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := s.sessions[:0]
	for _, x := range s.sessions {
		if !bytes.Equal(x.hash, hash) && !bytes.Equal(x.previous, hash) {
			kept = append(kept, x)
		}
	}
	s.sessions = kept
	return nil
}

// Count returns how many sessions exist.
func (s *MemSessionStore) Count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sessions)
}
