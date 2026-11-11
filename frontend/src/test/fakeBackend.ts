import type { AppNotification, CalendarEvent, Role, Task, User } from '../api/types'
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

const STATUS_ORDER = ['todo', 'in_progress', 'review', 'on_hold', 'done']

/** Builds an important day: the signed-in person's own unless a project is given. */
export function calendarEvent(
  id: string,
  title: string,
  day: string,
  opts: Partial<Omit<CalendarEvent, 'id' | 'title' | 'day'>> = {},
): CalendarEvent {
  return {
    id,
    title,
    note: '',
    day,
    projectId: null,
    projectName: null,
    ownerId: ME.id,
    createdBy: ME.id,
    remindDays: [],
    atTime: null,
    remindMinutes: [],
    sharedWith: [],
    sharedBy: null,
    canEdit: true,
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    ...opts,
  }
}

/** Builds a reminder about an important day. */
export function notification(
  id: string,
  title: string,
  day: string,
  opts: Partial<Omit<AppNotification, 'id' | 'title' | 'day'>> = {},
): AppNotification {
  return {
    id,
    eventId: `event-${id}`,
    title,
    day,
    projectId: null,
    projectName: null,
    sharedBy: null,
    daysBefore: 1,
    minutesBefore: 0,
    atTime: null,
    createdAt: '2026-02-01T00:00:00Z',
    readAt: null,
    ...opts,
  }
}

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
    holdReason: null,
    assigneeIds: [],
    subtasks: [],
    createdBy: ME.id,
    startDate: null,
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
  /** Important days the signed-in person can see. */
  events?: CalendarEvent[]
  /** The signed-in person's reminders. */
  notifications?: AppNotification[]
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
  const events = options.events ?? []
  const notifications = options.notifications ?? []
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
    taskCount: tasks.filter((t) => t.projectId === p.id && !t.deletedAt).length,
    doneCount: tasks.filter((t) => t.projectId === p.id && !t.deletedAt && t.status === 'done')
      .length,
    // Like the real API: everyone counted, the first five named, the owner first.
    memberCount: p.members.length,
    members: p.members
      .slice(0, 5)
      .map((m) => ({ userId: m.userId, displayName: m.displayName, email: m.email })),
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
    'POST /auth/refresh': () => err(401, 'unauthorized'),
    'POST /auth/logout': () => ({ status: 204 }),
    'GET /notifications': () => ({
      body: { items: notifications, unread: notifications.filter((n) => !n.readAt).length },
    }),
    'POST /notifications/read': (req) => {
      const ids = (req.body as { ids?: string[] }).ids
      for (const n of notifications)
        if (!n.readAt && (!ids || ids.includes(n.id))) n.readAt = '2026-03-01T00:00:00Z'
      return { status: 204 }
    },
    'GET /people': () => {
      // Everyone in an active project with me, once each, not me.
      const seen = new Map<string, { userId: string; displayName: string; email: string }>()
      for (const p of projects)
        if (roleOf(p) && !p.deletedAt)
          for (const m of p.members)
            if (m.userId !== me.id)
              seen.set(m.userId, { userId: m.userId, displayName: m.displayName, email: m.email })
      return { body: { items: [...seen.values()] } }
    },
    'GET /calendar': (req) => {
      const from = req.query.get('from') ?? ''
      const to = req.query.get('to') ?? ''
      const inRange = (day: string | null) => day !== null && day >= from && day <= to
      return {
        body: {
          events: events.filter((e) => inRange(e.day)),
          tasks: tasks
            .filter((t) => !t.deletedAt && active(t.projectId))
            .filter((t) => inRange(t.startDate) || inRange(t.dueDate))
            .map((t) => ({
              id: t.id,
              projectId: t.projectId,
              projectName: active(t.projectId)!.name,
              title: t.title,
              status: t.status,
              startDate: t.startDate,
              dueDate: t.dueDate,
              assigneeIds: t.assigneeIds,
            })),
        },
      }
    },
    'POST /events': (req) => {
      const body = req.body as {
        title?: string
        note?: string
        day?: string
        projectId?: string
        sharedWith?: string[]
        remindDays?: number[]
        atTime?: string
        remindMinutes?: number[]
      }
      const fields: Record<string, string> = {}
      const people = new Map(
        projects
          .filter((p) => roleOf(p) && !p.deletedAt)
          .flatMap((p) => p.members)
          .filter((m) => m.userId !== me.id)
          .map((m) => [m.userId, { userId: m.userId, displayName: m.displayName, email: m.email }]),
      )
      const shared = body.sharedWith ?? []
      if (shared.length && body.projectId) fields.sharedWith = 'personal_only'
      else if (shared.some((id) => !people.has(id))) fields.sharedWith = 'not_a_member'
      const title = String(body.title ?? '').trim()
      if (!title) fields.title = 'required'
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.day))) fields.day = 'invalid_date'
      if ((body.remindDays ?? []).some((d) => ![0, 1, 3, 7].includes(d)))
        fields.remindDays = 'invalid_remind_day'
      const p = body.projectId ? active(body.projectId) : undefined
      if (body.projectId && !p) fields.projectId = 'not_a_member'
      if (Object.keys(fields).length) return err(422, 'validation_failed', fields)
      const created = calendarEvent(`e${nextId++}`, title, String(body.day), {
        note: String(body.note ?? '').trim(),
        projectId: p?.id ?? null,
        projectName: p?.name ?? null,
        ownerId: p ? null : ME.id,
        remindDays: (body.remindDays ?? []) as CalendarEvent['remindDays'],
        atTime: body.atTime || null,
        remindMinutes: (body.remindMinutes ?? []) as CalendarEvent['remindMinutes'],
        sharedWith: p ? [] : shared.map((id) => people.get(id)!),
      })
      events.push(created)
      return { status: 201, body: created }
    },
    'PATCH /events/:id': (req) => {
      const e = events.find((x) => x.id === req.params.id)
      if (!e) return err(404, 'not_found')
      if (!e.canEdit) return err(403, 'forbidden')
      // Like the real API: people come as ids and go back as people; "" takes the time (and its reminders) away.
      const { sharedWith, atTime, ...rest } = req.body as Omit<
        Partial<CalendarEvent>,
        'sharedWith' | 'atTime'
      > & {
        sharedWith?: string[]
        atTime?: string
      }
      Object.assign(e, rest)
      if (atTime !== undefined) {
        e.atTime = atTime || null
        if (!atTime) e.remindMinutes = []
      }
      if (sharedWith !== undefined) {
        const everyone = projects.flatMap((p) => p.members)
        e.sharedWith = sharedWith.map((id) => {
          const m = everyone.find((x) => x.userId === id)!
          return { userId: m.userId, displayName: m.displayName, email: m.email }
        })
      }
      return { body: e }
    },
    'DELETE /events/:id': (req) => {
      const i = events.findIndex((x) => x.id === req.params.id)
      if (i < 0) return err(404, 'not_found')
      if (!events[i]!.canEdit) return err(403, 'forbidden')
      events.splice(i, 1)
      return { status: 204 }
    },
    'GET /me': (req: RecordedRequest) =>
      req.headers.get('Authorization') === `Bearer ${TOKEN}`
        ? { body: me }
        : err(401, 'unauthorized'),
    'PATCH /me': (req) => ({ body: { ...me, ...(req.body as object) } }),

    'GET /projects': (req) => {
      const trashed = req.query.get('trashed') === 'true'
      const page = Number(req.query.get('page') ?? 1)
      const size = Number(req.query.get('pageSize') ?? 20)
      const sort = req.query.get('sort')
      if (
        sort &&
        !['newest', 'oldest', 'updated', 'name', 'progress_high', 'progress_low'].includes(sort)
      )
        return err(422, 'validation_failed', { sort: 'invalid_sort' })
      // Like the real API: several people joined by commas, any of them with a task.
      const people = (req.query.get('person') ?? '').split(',').filter(Boolean)
      const all = projects.filter((p) => {
        const r = roleOf(p)
        if (!r) return false
        const hasTask = (id: string) =>
          tasks.some((t) => t.projectId === p.id && !t.deletedAt && t.assigneeIds.includes(id))
        if (people.length > 0 && !trashed && !people.some(hasTask)) return false
        return trashed ? r === 'owner' && p.deletedAt !== null : p.deletedAt === null
      })
      // Like the real API: a project with no tasks goes last when sorting by progress.
      const progress = (p: FakeProject) => {
        const { taskCount, doneCount } = view(p)
        return taskCount === 0 ? null : doneCount / taskCount
      }
      if (sort === 'oldest') all.reverse()
      if (sort === 'name')
        all.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      if (sort === 'updated') {
        const latest = (p: FakeProject) =>
          [p.updatedAt, ...tasks.filter((t) => t.projectId === p.id).map((t) => t.updatedAt)]
            .sort()
            .at(-1)!
        all.sort((a, b) => latest(b).localeCompare(latest(a)))
      }
      if (sort === 'progress_high' || sort === 'progress_low') {
        const direction = sort === 'progress_high' ? -1 : 1
        all.sort((a, b) => {
          const [x, y] = [progress(a), progress(b)]
          if (x === null || y === null) return Number(x === null) - Number(y === null)
          return (x - y) * direction
        })
      }
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
        if (t.projectId === p.id)
          t.assigneeIds = t.assigneeIds.filter((userId) => userId !== target.userId)
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
      if (creating && body.status === 'on_hold' && !String(body.holdReason ?? '').trim())
        fields.holdReason = 'hold_reason_required'
      if (body.assigneeIds !== undefined) {
        const ids = body.assigneeIds as string[]
        if (ids.some((userId) => !isMember(projectId, userId))) fields.assigneeIds = 'not_a_member'
      }
      if (body.subtasks !== undefined) {
        const titles = body.subtasks as string[]
        if (titles.length > 100) fields.subtasks = 'too_many_subtasks'
        else if (titles.some((title) => title.trim() === ''))
          fields.subtasks = 'invalid_subtask_title'
      }
      for (const name of ['startDate', 'dueDate']) {
        if (body[name] === undefined || body[name] === null) continue
        const d = String(body[name])
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))
          fields[name] = 'invalid_date'
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
        if (q.get('assigneeId'))
          list = list.filter((t) => t.assigneeIds.includes(q.get('assigneeId')!))
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
          holdReason: status === 'on_hold' ? String(body.holdReason).trim() : null,
          assigneeIds: (body.assigneeIds as string[] | undefined) ?? [],
          subtasks: ((body.subtasks as string[] | undefined) ?? []).map((title) => ({
            id: `s${nextId++}`,
            title: title.trim(),
            done: false,
          })),
          startDate: (body.startDate as string | null | undefined) ?? null,
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
        const known = [
          'title',
          'description',
          'priority',
          'holdReason',
          'assigneeIds',
          'startDate',
          'dueDate',
        ].filter((k) => k in body)
        if (known.length === 0) return err(422, 'validation_failed', { body: 'nothing_to_update' })
        const fields = checkFields(t.projectId, body, false)
        if (Object.keys(fields).length) return err(422, 'validation_failed', fields)
        if (body.title !== undefined) t.title = String(body.title).trim()
        if (body.description !== undefined) t.description = String(body.description)
        if (body.priority !== undefined) t.priority = body.priority as Task['priority']
        if (body.holdReason !== undefined) {
          if (t.status !== 'on_hold')
            return err(422, 'validation_failed', { holdReason: 'not_on_hold' })
          t.holdReason = String(body.holdReason).trim()
        }
        if (body.assigneeIds !== undefined) t.assigneeIds = body.assigneeIds as string[]
        if (body.startDate !== undefined) t.startDate = body.startDate as string | null
        if (body.dueDate !== undefined) t.dueDate = body.dueDate as string | null
        return { body: taskView(t) }
      },
      'POST /tasks/:id/subtasks': (req) => {
        const t = activeTask(req.params.id!)
        if (!t) return err(404, 'not_found')
        const title = String((req.body as { title?: string }).title ?? '').trim()
        if (title === '') return err(422, 'validation_failed', { title: 'invalid_subtask_title' })
        if (t.subtasks.length >= 100)
          return err(422, 'validation_failed', { title: 'too_many_subtasks' })
        const subtask = { id: `s${nextId++}`, title, done: false }
        t.subtasks = [...t.subtasks, subtask]
        return { status: 201, body: subtask }
      },
      'PATCH /tasks/:id/subtasks/:subtaskId': (req) => {
        const t = activeTask(req.params.id!)
        const subtask = t?.subtasks.find((s) => s.id === req.params.subtaskId)
        if (!t || !subtask) return err(404, 'not_found')
        const body = req.body as { title?: string; done?: boolean }
        const changed = {
          ...subtask,
          ...(body.title !== undefined && { title: body.title.trim() }),
          ...(body.done !== undefined && { done: body.done }),
        }
        t.subtasks = t.subtasks.map((s) => (s.id === subtask.id ? changed : s))
        return { body: changed }
      },
      'DELETE /tasks/:id/subtasks/:subtaskId': (req) => {
        const t = activeTask(req.params.id!)
        if (!t?.subtasks.some((s) => s.id === req.params.subtaskId)) return err(404, 'not_found')
        t.subtasks = t.subtasks.filter((s) => s.id !== req.params.subtaskId)
        return { status: 204 }
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
        t.assigneeIds = t.assigneeIds.filter((userId) => isMember(t.projectId, userId))
        return { body: taskView(t) }
      },
      'POST /tasks/:id/move': (req) => {
        const t = activeTask(req.params.id!)
        if (!t) return err(404, 'not_found')
        const body = req.body as {
          status?: string
          beforeTaskId?: string | null
          holdReason?: string
        }
        if (!STATUS_ORDER.includes(String(body.status)))
          return err(422, 'validation_failed', { status: 'invalid_status' })
        const status = body.status as Task['status']
        const reason = body.holdReason?.trim()
        if (status === 'on_hold' && t.status !== 'on_hold' && !reason)
          return err(422, 'validation_failed', { holdReason: 'hold_reason_required' })
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
        t.holdReason = status === 'on_hold' ? (reason ?? t.holdReason) : null
        return { body: taskView(t) }
      },
    }
  }

  const api = mockApi(routes)
  return { ...api, projects, tasks, me, events, notifications }
}
