import type { Role, Task, User } from '../api/types'
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

const STATUS_ORDER = ['todo', 'in_progress', 'review', 'done']

/** Builds a task. Positions follow the creation order unless given. */
export function task(
  id: string,
  title: string,
  opts: Partial<Omit<Task, 'id' | 'title'>> & { project?: string } = {},
): Task {
  const { project, ...rest } = opts
  return {
    id,
    projectId: project ?? opts.projectId ?? 'p1',
    title,
    description: '',
    status: 'todo',
    priority: 'medium',
    assigneeId: null,
    createdBy: ME.id,
    dueDate: null,
    position: 1024,
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    deletedAt: null,
    purgeAt: null,
    ...rest,
  }
}

interface Options {
  /** Who is signed in. */
  me?: User
  projects?: FakeProject[]
  tasks?: Task[]
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
  const tasks = options.tasks ?? []
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
      // Like the real API: their tasks stay, but nobody is responsible for them any more.
      for (const t of tasks)
        if (t.projectId === p.id && t.assigneeId === target.userId) t.assigneeId = null
      return { status: 204 }
    },
    ...taskRoutes(),
    ...options.routes,
  }

  // ---- tasks: any member of the project may do anything; everyone else gets 404 ----
  function taskRoutes(): Record<string, Handler> {
    const taskView = (t: Task): Task => ({
      ...t,
      purgeAt: t.deletedAt ? new Date(Date.parse(t.deletedAt) + 30 * DAY).toISOString() : null,
    })
    const memberOf = (projectId: string) => active(projectId)
    const activeTask = (id: string) => {
      const t = tasks.find((x) => x.id === id)
      return t && !t.deletedAt && memberOf(t.projectId) ? t : undefined
    }
    const isMember = (projectId: string, userId: string) =>
      projects.find((p) => p.id === projectId)?.members.some((m) => m.userId === userId) ?? false
    const columnOf = (projectId: string, status: string, exceptId?: string) =>
      tasks
        .filter(
          (t) =>
            t.projectId === projectId && t.status === status && !t.deletedAt && t.id !== exceptId,
        )
        .sort((a, b) => a.position - b.position)

    function checkFields(
      projectId: string,
      body: Record<string, unknown>,
      creating: boolean,
    ): Record<string, string> {
      const fields: Record<string, string> = {}
      if (creating || body.title !== undefined) {
        const title = String(body.title ?? '').trim()
        const len = Array.from(title).length
        // eslint-disable-next-line no-control-regex
        if (len < 1 || len > 200 || /[\u0000-\u001f\u007f]/.test(title))
          fields.title = 'invalid_title'
      }
      if (body.description !== undefined && Array.from(String(body.description)).length > 5000)
        fields.description = 'description_too_long'
      if (body.status !== undefined && !STATUS_ORDER.includes(String(body.status)))
        fields.status = 'invalid_status'
      if (body.priority !== undefined && !['low', 'medium', 'high'].includes(String(body.priority)))
        fields.priority = 'invalid_priority'
      if (body.assigneeId !== undefined && body.assigneeId !== null) {
        if (!isMember(projectId, String(body.assigneeId))) fields.assigneeId = 'not_a_member'
      }
      if (body.dueDate !== undefined && body.dueDate !== null) {
        const d = String(body.dueDate)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))
          fields.dueDate = 'invalid_date'
      }
      return fields
    }

    return {
      'GET /projects/:id/tasks': (req) => {
        const p = active(req.params.id!)
        if (!p) return err(404, 'not_found')
        const q = req.query
        const trashed = q.get('trashed') === 'true'
        const size = Math.min(100, Math.max(1, Number(q.get('pageSize') ?? 20)))
        const page = Math.max(1, Number(q.get('page') ?? 1))
        const needle = (q.get('q') ?? '').toLowerCase()
        let list = tasks.filter((t) => t.projectId === p.id && (t.deletedAt !== null) === trashed)
        if (q.get('status')) list = list.filter((t) => t.status === q.get('status'))
        if (q.get('priority')) list = list.filter((t) => t.priority === q.get('priority'))
        if (q.get('assigneeId')) list = list.filter((t) => t.assigneeId === q.get('assigneeId'))
        if (needle) list = list.filter((t) => t.title.toLowerCase().includes(needle))
        list = trashed
          ? list.sort((a, b) => Date.parse(b.deletedAt!) - Date.parse(a.deletedAt!))
          : list.sort(
              (a, b) =>
                STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
                a.position - b.position,
            )
        return {
          body: {
            items: list.slice((page - 1) * size, page * size).map(taskView),
            total: list.length,
          },
        }
      },
      'POST /projects/:id/tasks': (req) => {
        const p = active(req.params.id!)
        if (!p) return err(404, 'not_found')
        const body = req.body as Record<string, unknown>
        const fields = checkFields(p.id, body, true)
        if (Object.keys(fields).length) return err(422, 'validation_failed', fields)
        const status = (body.status as Task['status'] | undefined) ?? 'todo'
        const last = columnOf(p.id, status).at(-1)
        const created = task(`t${nextId++}`, String(body.title).trim(), {
          project: p.id,
          status,
          description: (body.description as string | undefined) ?? '',
          priority: (body.priority as Task['priority'] | undefined) ?? 'medium',
          assigneeId: (body.assigneeId as string | null | undefined) ?? null,
          dueDate: (body.dueDate as string | null | undefined) ?? null,
          position: last ? last.position + 1024 : 1024,
          createdBy: me.id,
        })
        tasks.push(created)
        return { status: 201, body: taskView(created) }
      },
      'GET /tasks/:id': (req) => {
        const t = activeTask(req.params.id!)
        return t ? { body: taskView(t) } : err(404, 'not_found')
      },
      'PATCH /tasks/:id': (req) => {
        const t = activeTask(req.params.id!)
        if (!t) return err(404, 'not_found')
        const body = req.body as Record<string, unknown>
        if ('status' in body || 'position' in body) return err(400, 'bad_request') // only /move changes these
        const known = ['title', 'description', 'priority', 'assigneeId', 'dueDate'].filter(
          (k) => k in body,
        )
        if (known.length === 0) return err(422, 'validation_failed', { body: 'nothing_to_update' })
        const fields = checkFields(t.projectId, body, false)
        if (Object.keys(fields).length) return err(422, 'validation_failed', fields)
        if (body.title !== undefined) t.title = String(body.title).trim()
        if (body.description !== undefined) t.description = String(body.description)
        if (body.priority !== undefined) t.priority = body.priority as Task['priority']
        if (body.assigneeId !== undefined) t.assigneeId = body.assigneeId as string | null
        if (body.dueDate !== undefined) t.dueDate = body.dueDate as string | null
        return { body: taskView(t) }
      },
      'DELETE /tasks/:id': (req) => {
        const t = activeTask(req.params.id!)
        if (!t) return err(404, 'not_found')
        t.deletedAt = new Date().toISOString()
        return { status: 204 }
      },
      'POST /tasks/:id/restore': (req) => {
        const t = tasks.find((x) => x.id === req.params.id && x.deletedAt && memberOf(x.projectId))
        if (!t) return err(404, 'not_found')
        t.deletedAt = null
        if (t.assigneeId && !isMember(t.projectId, t.assigneeId)) t.assigneeId = null
        return { body: taskView(t) }
      },
      'POST /tasks/:id/move': (req) => {
        const t = activeTask(req.params.id!)
        if (!t) return err(404, 'not_found')
        const body = req.body as { status?: string; beforeTaskId?: string | null }
        if (!STATUS_ORDER.includes(String(body.status)))
          return err(422, 'validation_failed', { status: 'invalid_status' })
        const status = body.status as Task['status']
        const others = columnOf(t.projectId, status, t.id)
        let position: number
        if (body.beforeTaskId == null) {
          position = others.length ? others.at(-1)!.position + 1024 : 1024
        } else {
          const before = others.find((x) => x.id === body.beforeTaskId)
          if (!before || body.beforeTaskId === t.id)
            return err(422, 'validation_failed', { beforeTaskId: 'invalid_before_task' })
          const prev = others[others.indexOf(before) - 1]
          position = ((prev?.position ?? 0) + before.position) / 2
        }
        t.status = status
        t.position = position
        return { body: taskView(t) }
      },
    }
  }

  const api = mockApi(routes)
  return { ...api, projects, tasks, me }
}
