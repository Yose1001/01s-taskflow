import http from 'k6/http'
import { check } from 'k6'
import { BASE, PASSWORD, makeUsers } from './lib.js'

// "Someone is guessing passwords." 20 clients hammer the login endpoint with the REAL (strict) limit
// (10 attempts per minute per address). Expected: the first few are answered normally, the rest are
// refused with 429 and a Retry-After header, nothing returns a 5xx, and the server is still healthy after.
// Run it with the default rate limits (run.sh does this for you).

export const options = {
  scenarios: {
    burst: { executor: 'constant-vus', vus: 20, duration: '20s' },
  },
  thresholds: {
    checks: ['rate==1'], // every single check must hold
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'max'],
}

export function setup() {
  // One account is enough. (Registering is limited to 5 per minute per address, so only make one.)
  const users = makeUsers(1, 'burst')
  return { email: users[0].email }
}

export default function (data) {
  const res = http.post(`${BASE}/auth/login`, JSON.stringify({ email: data.email, password: PASSWORD }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { kind: 'login' },
  })
  check(res, {
    'answered 200 or 429 (never a 5xx)': (r) => r.status === 200 || r.status === 429,
    'a refusal says how long to wait': (r) => r.status !== 429 || Number(r.headers['Retry-After']) > 0,
    'a refusal has the rate_limited code': (r) => r.status !== 429 || (r.json() || {}).code === 'rate_limited',
  })
}

export function teardown() {
  const health = http.get(`${BASE}/health`)
  check(health, { 'server still healthy afterwards': (r) => r.status === 200 })
}
