import { check } from 'k6'
import { STATUSES, createProject, get, invite, json, makeUsers, readBoard, seedTasks, send } from './lib.js'

// "How much can it take?" Requests arrive at a fixed rate that goes up step by step (no thinking time,
// so each step is a harder push than the one before). The summary shows, per step, how many requests
// failed and how slow the slowest 5% were: the step where that turns bad is the limit on this machine.
//
// These lines only REPORT; a failing line here is information, not a broken build.

const USERS = Number(__ENV.USERS || 40)
const TEAM = 5
const STEP_SECONDS = Number(__ENV.STEP_SECONDS || 30)
const RATES = (__ENV.RATES || '20,50,100,200,400').split(',').map(Number) // iterations per second

const scenarios = {}
const thresholds = {}
RATES.forEach((rate, i) => {
  const name = `rate_${rate}`
  scenarios[name] = {
    executor: 'constant-arrival-rate',
    rate,
    timeUnit: '1s',
    duration: `${STEP_SECONDS}s`,
    startTime: `${i * (STEP_SECONDS + 5)}s`,
    preAllocatedVUs: Math.min(500, Math.max(50, rate)),
    maxVUs: 1500,
    tags: { step: name },
  }
  thresholds[`http_req_failed{step:${name}}`] = [{ threshold: 'rate<0.01', abortOnFail: false }]
  thresholds[`http_req_duration{step:${name}}`] = [{ threshold: 'p(95)<500', abortOnFail: false }]
  thresholds[`dropped_iterations{step:${name}}`] = [{ threshold: 'count==0', abortOnFail: false }]
})

export const options = {
  scenarios,
  thresholds,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

export function setup() {
  const users = makeUsers(USERS, 'st')
  const teams = Math.ceil(USERS / TEAM)
  for (let t = 0; t < teams; t++) {
    const owner = users[t * TEAM]
    const projectId = createProject(owner.token, `Stress ${t}`)
    for (let i = t * TEAM; i < Math.min(USERS, (t + 1) * TEAM); i++) {
      users[i].projectId = projectId
      if (i !== t * TEAM) invite(owner.token, projectId, users[i].email)
    }
    seedTasks(owner.token, projectId, 40, 'Task')
  }
  return { users }
}

// One iteration = open the board and add a task (a read-heavy mix with one write).
export default function (data) {
  const me = data.users[Math.floor(Math.random() * data.users.length)]
  const board = readBoard(me.token, me.projectId, 'read')
  check(get('/projects?page=1&pageSize=12', me.token, 'read'), { 'projects 200': (r) => r.status === 200 })

  const res = send('POST', `/projects/${me.projectId}/tasks`, me.token, { title: 'stress', status: STATUSES[Math.floor(Math.random() * 4)] }, 'write')
  check(res, { 'task created 201': (r) => r.status === 201 })
  const task = json(res)
  if (task && board.length > 0) {
    // Tidy up so the board does not grow during the test: delete what was just added.
    send('DELETE', `/tasks/${task.id}`, me.token, undefined, 'write')
  }
}
