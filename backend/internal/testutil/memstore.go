// Package testutil provides in-memory fakes. Import it from tests only.
package testutil

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/Yose1001/taskflow/backend/internal/model"
)

// MemUserStore is an in-memory service.UserStore that enforces the same rules as the database.
type MemUserStore struct {
	mu    sync.Mutex
	users map[string]model.User // by id
	seq   int
}

// NewMemUserStore returns an empty store.
func NewMemUserStore() *MemUserStore { return &MemUserStore{users: map[string]model.User{}} }

// Create mimics the unique-email constraint.
func (s *MemUserStore) Create(_ context.Context, email, hash, name string) (model.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.users {
		if u.Email == email {
			return model.User{}, model.ErrEmailTaken
		}
	}
	s.seq++
	u := model.User{
		ID: fmt.Sprintf("00000000-0000-0000-0000-%012d", s.seq), Email: email, PasswordHash: hash,
		DisplayName: name, Locale: "en", Theme: "system", CreatedAt: time.Now().UTC(),
	}
	s.users[u.ID] = u
	return u, nil
}

// GetByEmail returns model.ErrNotFound when absent.
func (s *MemUserStore) GetByEmail(_ context.Context, email string) (model.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.users {
		if u.Email == email {
			return u, nil
		}
	}
	return model.User{}, model.ErrNotFound
}

// GetByID returns model.ErrNotFound when absent.
func (s *MemUserStore) GetByID(_ context.Context, id string) (model.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if u, ok := s.users[id]; ok {
		return u, nil
	}
	return model.User{}, model.ErrNotFound
}

// UpdateSettings applies non-nil patch fields.
func (s *MemUserStore) UpdateSettings(_ context.Context, id string, p model.SettingsPatch) (model.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return model.User{}, model.ErrNotFound
	}
	if p.DisplayName != nil {
		u.DisplayName = *p.DisplayName
	}
	if p.Locale != nil {
		u.Locale = *p.Locale
	}
	if p.Theme != nil {
		u.Theme = *p.Theme
	}
	s.users[id] = u
	return u, nil
}

// Delete removes a user (to test tokens for deleted accounts).
func (s *MemUserStore) Delete(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.users, id)
}
