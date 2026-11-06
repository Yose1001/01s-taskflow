# End-to-end tests

A real browser (Chromium, driven by [Playwright](https://playwright.dev)) uses the real web app, the real Go API and a real PostgreSQL database, the way a person would. These tests catch what unit tests cannot: the pieces not fitting together.

## What they cover

| File | Journey |
| --- | --- |
| `auth.spec.ts` | sign up, log in/out, wrong password, protected pages, no open redirect, token never in storage |
| `projects.spec.ts` | create, edit, delete + Undo, trash + restore, paging, "not found" for strangers, no HTML injection |
| `members.spec.ts` | invite, read-only member view, member works on tasks, removing a member |
| `board.spec.ts` | real mouse drag and keyboard drag between columns, saved after reload, create/edit/delete/restore tasks |
| `filters.spec.ts` | search, priority and person filters, kept in the address |
| `settings.spec.ts` | Thai/English, light/dark, settings follow the account to another device |

## Run them

```bash
make db-up                   # the Postgres container (once)
cd e2e && pnpm install       # once
pnpm exec playwright install chromium   # once (about 150 MB)
pnpm test                    # or, from the project root: make test-e2e
```

`pnpm test` first creates a brand-new database named `taskflow_e2e`, then starts its own API (port 8081) and web app (port 5174). Your development servers and data (`taskflow` database, ports 8080/5173) are never touched. The script that makes the database refuses any name not ending in `_e2e`.

Useful: `pnpm test:ui` (watch tests run), `pnpm exec playwright test tests/board.spec.ts`, `pnpm report` (open the last report).

If Chromium says a shared library is missing (for example `libnspr4.so`) on Linux/WSL, run once: `sudo pnpm exec playwright install-deps chromium`.

## Rules of this folder

- Each test makes its own users (unique emails), so tests never depend on each other and run side by side.
- Setting things up goes through the API (fast); the thing being tested goes through the screen.
- The sign-in/sign-up rate limits are raised for this run only (`LOGIN_RATE_LIMIT_PER_MINUTE`, `REGISTER_RATE_LIMIT_PER_MINUTE`), because every test user comes from one address. Production keeps the strict defaults.
- A page reload signs the person out on purpose (the token lives only in memory), so tests use `reloadAndLogin`.
