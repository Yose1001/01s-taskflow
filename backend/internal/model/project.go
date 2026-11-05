package model

import (
	"errors"
	"time"
)

// ErrAlreadyMember is returned when adding a user who already belongs to the project.
var ErrAlreadyMember = errors.New("already a member")

// Project member roles (must match the CHECK constraint in the schema).
const (
	RoleOwner  = "owner"
	RoleMember = "member"
)

// Project is a workspace for tasks. MyRole is the requesting user's role in it.
type Project struct {
	ID          string
	Name        string
	Description string
	OwnerID     string
	MyRole      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	DeletedAt   *time.Time // set while the project is in the trash
	PurgeAt     *time.Time // when it will be deleted for good (DeletedAt + retention)
}

// ProjectPatch updates a project; nil fields are left unchanged.
type ProjectPatch struct {
	Name        *string
	Description *string
}

// Member is a user belonging to a project.
type Member struct {
	UserID      string
	Email       string
	DisplayName string
	Role        string
	JoinedAt    time.Time
}
