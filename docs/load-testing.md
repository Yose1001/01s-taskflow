# Load testing

How much can the TaskFlow API take, and does it stay well-behaved when pushed? These tests answer that with [k6](https://k6.io), a tool that makes many "virtual users" use the API at the same time.

The scripts are in `loadtest/`. Each run starts its **own** copy of the system (fresh database `taskflow_load`, the real compiled API on port 8082), so it never touches development data.

## How to run

```bash
make db-up                      # the Postgres container (once)
# install k6 once: https://k6.io/docs/get-started/installation/
make load-test                  # a normal working day (50 people), about 3 minutes
loadtest/run.sh stress          # rising load, to find the limit (about 3 minutes)
loadtest/run.sh login-burst     # password guessing against the strict limits (30 seconds)
```

Settings go before the command, for example `USERS=100 HOLD=5m loadtest/run.sh workflow` or `RATES=800,1600,3200 STEP_SECONDS=20 loadtest/run.sh stress`. After each run the script prints the API's peak memory and CPU and saves the full k6 summary in `loadtest/results/` (not committed).

## The three tests

| Test | What it does | Pass line |
| --- | --- | --- |
| `workflow` | 50 people in 10 teams. Each: open the project, read the board, add a task, move it, edit it, sometimes delete it, think 1 to 3 seconds, repeat. One in five also opens a big project (500 tasks, 5 pages). One in twenty logs in again. | reads: 95% under 200 ms. writes: 95% under 300 ms. login: 95% under 1.5 s (slow on purpose, passwords are hashed). under 1% failed requests. over 99% checks pass. |
| `stress` | Requests arrive at a fixed rate that goes up step by step, with no thinking time. Each iteration reads the board and projects, adds a task, deletes it. | Only reports: the step where slowness or errors appear is the limit. |
| `login-burst` | 20 clients hammer the login endpoint for 20 seconds with the real limit (10 per minute per address). | every answer is 200 or 429 (never a 5xx), a 429 carries `Retry-After` and the `rate_limited` code, the server is healthy afterwards. |

## Results (6 Nov 2026)

Machine: Intel Core i9-13900H (20 threads), 12 GB for WSL2 Ubuntu. The load generator (k6), the API and PostgreSQL (Docker) all run on this one machine and share its CPU, so the numbers are **indicative, not a promise** for a real server.

### Working day: 50 people for 2.5 minutes. PASSED

| | Result |
| --- | --- |
| Requests | 38,523 (about 225 per second), 0 failed |
| Reads (95% faster than) | 2.0 ms |
| Writes (95% faster than) | 4.5 ms |
| Login (95% faster than) | 180 ms |
| Checks passed | 37,523 of 37,523 |
| API peak memory | 23 MB |

### Stress: rising load. No errors at any step; slows down after about 3,000 requests per second

Each iteration is about 4 requests (board, projects, create, delete).

| Iterations per second | Requests per second | 95% of requests faster than | Failed requests |
| --- | --- | --- | --- |
| 20 | about 80 | 4.8 ms | 0 |
| 100 | about 400 | 1.7 ms | 0 |
| 400 | about 1,600 | 3.3 ms | 0 |
| 800 | about 3,200 | 11.5 ms | 0 |
| 1,200 | the machine could not keep up | 532 ms | 0 |
| 3,200 | the machine could not keep up | 823 ms | 0 |

Reading it: up to about 3,000 requests per second the API answers in milliseconds. Beyond that, requests queue up and get slower (hundreds of milliseconds) but **none fail and nothing crashes**; the API's peak memory was 170 MB. For comparison, the working-day test with 50 active people needs about 225 requests per second, so there is roughly **13 times** headroom on this machine.

### Login burst: the rate limit holds. PASSED

714,741 login attempts in 20 seconds (35,000 per second). Only about 10 got through (exactly the limit of 10 per minute); every other one was refused with `429` and a `Retry-After` header. No 5xx. The server was healthy afterwards. (k6 counts the 429s as "failed requests", that is expected here.)

## What this does NOT tell us

- It is one machine. A production server, a managed database and network delay will give other numbers. Repeat the run there before relying on them.
- The "limit" shown is where this machine ran out, not necessarily where the code does. The connection pool is fixed at 10 database connections (`backend/internal/database`); whether that or the CPU is the real limit was **not** measured.
- Login hashing (bcrypt, cost 12) takes about 170 ms of CPU per login. It is the heaviest single request. 50 people logging in at the same moment would take a few seconds of CPU; that is fine for normal use but worth knowing for a launch-day rush.
- The rate limiter keys on the connection's address. Behind a reverse proxy every user would look like one address (see the note in `middleware/ratelimit.go`), so the proxy setup needs care before deploying.
- Data size: 10 projects of 30 tasks and one project of 500 tasks. A board with thousands of tasks reads several pages and was not measured.

## Next steps worth considering

1. Make the database pool size a setting and measure again (cheap, and answers the question above).
2. Re-run on the staging server once it exists (step 8), and keep the numbers next to these.
3. If boards with thousands of tasks are expected, load them lazily instead of reading every page up front.
