# Load tests (k6)

See `docs/load-testing.md` for what they test, how to read them, and the latest results.

```bash
loadtest/run.sh workflow        # a normal working day, 50 people
loadtest/run.sh stress          # rising load to find the limit
loadtest/run.sh login-burst     # password guessing against the strict limits
```

`run.sh` builds the API, makes a fresh database (`taskflow_load`, the script refuses any other name), starts the API on port 8082, samples its memory and CPU, runs k6, and cleans up.

| File | Purpose |
| --- | --- |
| `run.sh` | runs one test end to end |
| `lib.js` | shared helpers (make users, seed tasks, read a board) |
| `workflow.js`, `stress.js`, `login-burst.js` | the tests; their thresholds (pass lines) are at the top of each file |

`results/` holds the saved summaries of past runs and is not committed.
