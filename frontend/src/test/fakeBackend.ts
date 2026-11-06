import type { Role, User } from '../api/types'
import { LOGIN_OK, ME, TOKEN, mockApi, type Handler, type RecordedRequest } from './mockApi'

// A small in-memory stand-in for the real API with the same rules the Go backend enforces
// (404 for outsiders, 403 for members on owner-only actions, soft delete, field error codes...).
// The real backend is tested in Go; this lets the UI be tested without it.

const DAY = 86_400_000

export interface FakeMember {
  userId: string
  email: string
  displayName: string
  role: Role
  joinedAt: string
}

export interface FakeProject {
  id: string
  name: string
  description: string
  ownerId: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  members: FakeMember[]
}

export const BOB = {
  userId: '22222222-2222-2222-2222-222222222222',
  email: 'bob@example.com',
  displayName: 'Bob',
}
export const CAROL = {
  userId: '33333333-3333-3333-3333-333333333333',
  email: 'carol@example.com',
  displayName: 'Carol',
}

/** Builds a project owned by `ownerId`, with extra members. */
export function project(
  id: string,
  name: string,
  opts: {
    owner?: User
    description?: string
    members?: Array<typeof BOB>
    deletedAt?: string | null
    role?: Role
  } = {},
): FakeProject {
  const owner = opts.owner ?? ME
  const me: FakeMember = {
    userId: owner.id,
    email: owner.email,
    displayName: owner.displayName,
    role: 'owner',
    joinedAt: '2026-01-15T00:00:00Z',
  }
  return {
    id,
    name,
    description: opts.description ?? '',
    ownerId: owner.id,
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    deletedAt: opts.deletedAt ?? null,
    members: [
      me,
      ...(opts.members ?? []).map((m) => ({
        ...m,
        role: 'member' as Role,
        joinedAt: '2026-02-01T00:00:00Z',
      })),
    ],
  }
}

interface Options {
  /** Who is signed in. */
  me?: User
  projects?: FakeProject[]
  /** Accounts that exist and can be invited by email. */
  knownUsers?: Array<typeof BOB>
  /** Extra or replacement routes (for example to force an error). */
  routes?: Record<string, Handler>
}

const err = (status: number, code: string, fields?: Record<string, string>) => ({
  status,
  body: { code, message: code, ...(fields && { fields }) },
})

export function fakeBackend(options: Options = {}) {
  const me = options.me ?? ME
  const projects = options.projects ?? []
  const knownUsers = options.knownUsers ?? [BOB, CAROL]
  let nextId = 100

  const roleOf = (p: FakeProject): Role | undefined =>
    p.members.find((m) => m.userId === me.id)?.role
  const view = (p: FakeProject) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    ownerId: p.ownerId,
    myRole: roleOf(p),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    deletedAt: p.deletedAt,
    purgeAt: p.deletedAt ? new Date(Date.parse(p.deletedAt) + 30 * DAY).toISOString() : null,
  })
  // The API answers 404 for "does not exist" and for "you are not a member": it never says which.
  const find = (id: string) => projects.find((p) => p.id === id && roleOf(p) !== undefined)
  const active = (id: string) => {
    const p = find(id)
    return p && !p.deletedAt ? p : undefined
  }

  function validate(body: { name?: unknown; description?: unknown }, requireName: boolean) {
    const fields: Record<string, string> = {}
    if (requireName || body.name !== undefined) {
      const len = Array.from(String(body.name ?? '').trim()).length
      if (len < 1 || len > 120) fields.name = 'invalid_name'
    }
    if (body.description !== undefined && Array.from(String(body.description)).length > 2000)
      fields.description = 'description_too_long'
    return fields
  }

  const routes: Record<string, Handler> = {
    'POST /auth/login': () => LOGIN_OK,
    'GET /me': (req: RecordedRequest) =>
      req.headers.get('Authorization') === `Bearer ${TOKEN}`
        ? { body: me }
        : err(401, 'unauthorized'),
    'PATCH /me': (req) => ({ body: { ...me, ...(req.body as object) } }),

    'GET /projects': (req) => {
      const trashed = req.query.get('trashed') === 'true'
      const page = Number(req.query.get('page') ?? 1)
      const size = Number(req.query.get('pageSize') ?? 20)
      const all = projects.filter((p) => {
        const r = roleOf(p)
        if (!r) return false
        return trashed ? r === 'owner' && p.deletedAt !== null : p.deletedAt === null
      })
      return {
        body: { items: all.slice((page - 1) * size, page * size).map(view), total: all.length },
      }
    },
    'POST /projects': (req) => {
      const body = req.body as { name: string; description?: string }
      const fields = validate(body, true)
      if (Object.keys(fields).length) return err(422, 'validation_failed', fields)
      const p = project(`p${nextId++}`, body.name.trim(), { description: body.description ?? '' })
      projects.unshift(p)
      return { status: 201, body: view(p) }
    },
    'GET /projects/:id': (req) => {
      const p = active(req.params.id!)
      return p ? { body: view(p) } : err(404, 'not_found')
    },
    'PATCH /projects/:id': (req) => {
      const p = active(req.params.id!)
      if (!p) return err(404, 'not_found')
      if (roleOf(p) !== 'owner') return err(403, 'forbidden')
      const body = req.body as { name?: string; description?: string }
      const fields = validate(body, false)
      if (Object.keys(fields).length) return err(422, 'validation_failed', fields)
      if (body.name !== undefined) p.name = body.name.trim()
      if (body.description !== undefined) p.description = body.description
      return { body: view(p) }
    },
    'DELETE /projects/:id': (req) => {
      const p = active(req.params.id!)
      if (!p) return err(404, 'not_found')
      if (roleOf(p) !== 'owner') return err(403, 'forbidden')
      p.deletedAt = new Date().toISOString()
      return { status: 204 }
    },
    'POST /projects/:id/restore': (req) => {
      const p = find(req.params.id!)
      if (!p || !p.deletedAt) return err(404, 'not_found')
      if (roleOf(p) !== 'owner') return err(403, 'forbidden')
      p.deletedAt = null
      return { body: view(p) }
    },

    'GET /projects/:id/members': (req) => {
      const p = active(req.params.id!)
      return p ? { body: p.members } : err(404, 'not_found')
    },
    'POST /projects/:id/members': (req) => {
      const p = active(req.params.id!)
      if (!p) return err(404, 'not_found')
      if (roleOf(p) !== 'owner') return err(403, 'forbidden')
      const email = String((req.body as { email: string }).email)
        .trim()
        .toLowerCase()
      const user = knownUsers.find((u) => u.email === email)
      if (!user) return err(404, 'not_found')
      if (p.members.some((m) => m.userId === user.userId)) return err(409, 'already_member')
      const member: FakeMember = { ...user, role: 'member', joinedAt: '2026-03-01T00:00:00Z' }
      p.members.push(member)
      return { status: 201, body: member }
    },
    'DELETE /projects/:id/members/:userId': (req) => {
      const p = active(req.params.id!)
      if (!p) return err(404, 'not_found')
      if (roleOf(p) !== 'owner') return err(403, 'forbidden')
      const target = p.members.find((m) => m.userId === req.params.userId)
      if (!target) return err(404, 'not_found')
      if (target.role === 'owner')
        return err(422, 'validation_failed', { userId: 'cannot_remove_owner' })
      p.members = p.members.filter((m) => m !== target)
      return { status: 204 }
    },
    ...options.routes,
  }

  const api = mockApi(routes)
  return { ...api, projects, me }
}
