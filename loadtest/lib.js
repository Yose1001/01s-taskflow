import http from 'k6/http'
import { check } from 'k6'
import exec from 'k6/execution'

// Shared helpers for the load tests (run with k6, see loadtest/README.md).

export const BASE = __ENV.BASE_URL || 'http://localhost:8082/api/v1'
/** A throwaway password for throwaway users in the throwaway load-test database. */
export const PASSWORD = 'correct horse battery'
export const STATUSES = ['todo', 'in_progress', 'review', 'done']

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

/** kind: "read" | "write" | "login" | "setup". Thresholds are set per kind, so setup work never counts. */
export function get(path, token, kind, extraTags = {}) {
  return http.get(`${BASE}${path}`, { headers: authHeaders(token), tags: { kind, ...extraTags } })
}

export function send(method, path, token, body, kind, extraTags = {}) {
  return http.request(method, `${BASE}${path}`, body === undefined ? null : JSON.stringify(body), {
    headers: authHeaders(token),
    tags: { kind, ...extraTags },
  })
}

export function json(res) {
  try {
    return res.json()
  } catch (_) {
    return null
  }
}

/** Stops the whole run with a clear message when preparing data fails (nothing useful can be measured). */
export function must(res, expected, what) {
  if (res.status !== expected) {
    exec.test.abort(`setup failed: ${what} answered ${res.status} (wanted ${expected}): ${res.body}`)
  }
  return json(res)
}

/**
 * Makes `count` users that can sign in, in batches (the server hashes passwords on purpose slowly).
 * Returns [{ email, token }].
 */
export function makeUsers(count, label) {
  const run = Date.now().toString(36)
  const users = []
  const BATCH = 10
  for (let start = 0; start < count; start += BATCH) {
    const end = Math.min(count, start + BATCH)
    const register = []
    for (let i = start; i < end; i++) {
      const email = `${label}-${run}-${i}@load.test`
      users.push({ email })
      register.push([
        'POST',
        `${BASE}/auth/register`,
        JSON.stringify({ email, password: PASSWORD, displayName: `Load ${i}` }),
        { headers: JSON_HEADERS, tags: { kind: 'setup' } },
      ])
    }
    http.batch(register).forEach((r, k) => must(r, 201, `register user ${start + k}`))

    const logins = []
    for (let i = start; i < end; i++) {
      logins.push([
        'POST',
        `${BASE}/auth/login`,
        JSON.stringify({ email: users[i].email, password: PASSWORD }),
        { headers: JSON_HEADERS, tags: { kind: 'setup' } },
      ])
    }
    http.batch(logins).forEach((r, k) => {
      users[start + k].token = must(r, 200, `login user ${start + k}`).accessToken
    })
  }
  return users
}

export function createProject(token, name) {
  return must(send('POST', '/projects', token, { name, description: 'load test' }, 'setup'), 201, 'create project').id
}

export function invite(token, projectId, email) {
  must(send('POST', `/projects/${projectId}/members`, token, { email }, 'setup'), 201, 'invite member')
}

/** Adds `count` tasks spread over the four columns, 20 requests at a time. */
export function seedTasks(token, projectId, count, prefix) {
  const BATCH = 20
  for (let start = 0; start < count; start += BATCH) {
    const reqs = []
    for (let i = start; i < Math.min(count, start + BATCH); i++) {
      reqs.push([
        'POST',
        `${BASE}/projects/${projectId}/tasks`,
        JSON.stringify({ title: `${prefix} ${i}`, status: STATUSES[i % 4], priority: ['low', 'medium', 'high'][i % 3] }),
        { headers: authHeaders(token), tags: { kind: 'setup' } },
      ])
    }
    http.batch(reqs).forEach((r) => {
      if (r.status !== 201) exec.test.abort(`setup failed: seeding tasks answered ${r.status}: ${r.body}`)
    })
  }
}

/** Reads every page of a project's tasks, like the board does. Returns all tasks. */
export function readBoard(token, projectId, kind, extraTags = {}) {
  const all = []
  for (let page = 1; page <= 20; page++) {
    const res = get(`/projects/${projectId}/tasks?page=${page}&pageSize=100`, token, kind, extraTags)
    check(res, { 'board page 200': (r) => r.status === 200 })
    const body = json(res)
    if (!body) break
    all.push(...body.items)
    if (body.items.length === 0 || all.length >= body.total) break
  }
  return all
}
