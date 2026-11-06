import http from 'k6/http'
import { check, sleep } from 'k6'
import {
  BASE,
  PASSWORD,
  STATUSES,
  createProject,
  get,
  invite,
  json,
  makeUsers,
  readBoard,
  seedTasks,
  send,
} from './lib.js'

// "A normal working day": teams of 5 share a project and keep using the board.
// Each virtual user (VU) is one person: opens their project, reads the board, adds a task, moves it,
// edits it, sometimes deletes it, thinks for 1 to 3 seconds, repeats. Now and then they log in again,
// and some people open a big project (500 tasks, five pages, like a heavy board).
//
// Targets (thresholds) are the pass/fail line. Change them in one place below.

const USERS = Number(__ENV.USERS || 50)
const HOLD = __ENV.HOLD || '2m'
const BIG_TASKS = Number(__ENV.BIG_TASKS || 500)
const TEAM = 5

export const options = {
  scenarios: {
    team_work: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: USERS },
        { duration: HOLD, target: USERS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Almost nothing may fail (a failed request is a 5xx or a refused connection, not a 4xx the test expects).
    'http_req_failed{kind:read}': ['rate<0.01'],
    'http_req_failed{kind:write}': ['rate<0.01'],
    // 95 of every 100 requests must be faster than this.
    'http_req_duration{kind:read}': ['p(95)<200'],
    'http_req_duration{kind:write}': ['p(95)<300'],
    // Logging in is slow on purpose (password hashing), so it gets its own, looser line.
    'http_req_duration{kind:login}': ['p(95)<1500'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

export function setup() {
  const users = makeUsers(USERS, 'wf')
  const teams = Math.ceil(USERS / TEAM)

  for (let t = 0; t < teams; t++) {
    const owner = users[t * TEAM]
    const projectId = createProject(owner.token, `Team ${t}`)
    for (let i = t * TEAM; i < Math.min(USERS, (t + 1) * TEAM); i++) {
      users[i].projectId = projectId
      if (i !== t * TEAM) invite(owner.token, projectId, users[i].email)
    }
    seedTasks(owner.token, projectId, 30, `Task`)
  }

  const bigOwner = users[0]
  const bigId = createProject(bigOwner.token, 'Big project')
  seedTasks(bigOwner.token, bigId, BIG_TASKS, 'Big')
  for (let i = 1; i < USERS; i++) invite(bigOwner.token, bigId, users[i].email)

  return { users, bigId }
}

export default function (data) {
  const me = data.users[(__VU - 1) % data.users.length]
  const pid = me.projectId
  const pick = Math.random()

  // Open the app: who am I, my projects, this project, its members, its board.
  check(get('/me', me.token, 'read'), { 'me 200': (r) => r.status === 200 })
  check(get('/projects?page=1&pageSize=12', me.token, 'read'), { 'projects 200': (r) => r.status === 200 })
  check(get(`/projects/${pid}`, me.token, 'read'), { 'project 200': (r) => r.status === 200 })
  check(get(`/projects/${pid}/members`, me.token, 'read'), { 'members 200': (r) => r.status === 200 })
  const board = readBoard(me.token, pid, 'read')

  // One in five opens the big project's board (five pages).
  if (pick < 0.2) readBoard(me.token, data.bigId, 'read', { board: 'big' })

  // Add a task, move it to another column, edit it.
  const created = send('POST', `/projects/${pid}/tasks`, me.token, { title: `VU${__VU} iteration ${__ITER}`, priority: 'medium' }, 'write')
  check(created, { 'task created 201': (r) => r.status === 201 })
  const task = json(created)
  if (task) {
    const before = board.length > 0 ? board[Math.floor(Math.random() * board.length)] : null
    const status = STATUSES[1 + Math.floor(Math.random() * 3)]
    const moved = send('POST', `/tasks/${task.id}/move`, me.token, {
      status,
      beforeTaskId: before && before.status === status && before.id !== task.id ? before.id : null,
    }, 'write')
    check(moved, { 'task moved 200': (r) => r.status === 200 })

    check(send('PATCH', `/tasks/${task.id}`, me.token, { title: `Edited by VU${__VU}`, priority: 'high' }, 'write'), {
      'task edited 200': (r) => r.status === 200,
    })

    // Most tasks are deleted again (trash), some restored, a few kept.
    const fate = Math.random()
    if (fate < 0.7) {
      check(send('DELETE', `/tasks/${task.id}`, me.token, undefined, 'write'), { 'task deleted 204': (r) => r.status === 204 })
      if (fate < 0.2) {
        check(send('POST', `/tasks/${task.id}/restore`, me.token, undefined, 'write'), { 'task restored 200': (r) => r.status === 200 })
      }
    }
  }

  // One person in twenty signs in again (this is the slow, password-hashing request).
  if (Math.random() < 0.05) {
    const res = http.post(`${BASE}/auth/login`, JSON.stringify({ email: me.email, password: PASSWORD }), {
      headers: { 'Content-Type': 'application/json' },
      tags: { kind: 'login' },
    })
    check(res, { 'login 200': (r) => r.status === 200 })
  }

  sleep(1 + Math.random() * 2) // thinking time
}
