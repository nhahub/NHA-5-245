# SLA Guard

SLA Guard monitors one website against a monthly uptime agreement. It records HTTP evidence every minute, assesses UTC billing months, and prepares eligible service-credit drafts for human review.

| Interface          | URL                                      | Purpose                                                                     |
| ------------------ | ---------------------------------------- | --------------------------------------------------------------------------- |
| Dashboard          | [localhost:8083](http://localhost:8083/) | Monitor availability, investigate checks, assess a month, and review claims |
| n8n                | [localhost:8080](http://localhost:8080/) | Configure and inspect the existing five-workflow backend                    |
| Endpoint directory | [localhost:8082](http://localhost:8082/) | Find request examples, demo controls, and the health endpoint               |

## Run SLA Guard

After [first-time setup](#first-time-setup), run this one command from the repository root:

```powershell
python scripts/start.py
```

The script checks the Docker engine first. If the engine is unavailable, it starts Docker Desktop and waits for the engine to respond. It then starts n8n if needed, starts SLA Guard, and connects the containers. The dashboard defaults to [localhost:8083](http://localhost:8083/). Append `--build` to the same command after changing dashboard code you want to run in Docker.

For a Windows startup task, set **Program/script** to the full path to `python.exe` and **Add arguments** to the quoted absolute path to `scripts/start.py`. Run the task in your signed-in Windows session so it can launch Docker Desktop.

## First-time setup

Install Docker Desktop with Compose and Python 3. Create or reuse a Docker-based n8n instance with container name `n8n` and host port 8080. For a differently named container, set `SLA_DOCKER_WEBHOOK_URL` to its Docker URL and pass `--n8n-container` to the startup script.

Generate the local configuration from the repository root:

```powershell
python scripts/init_local_env.py
```

The generator creates `.env` and preserves existing values on later runs. Choose a database below, then use the [run command](#run-sla-guard) to start the services before importing and publishing the workflows. The Docker dashboard includes Node.js 24. Frontend development on the host requires Node.js 24 or later and npm.

### Database

Choose one database configuration.

| Backend                        | Setup                                                                                                            | Base URL in workflows 02–05     | Database Header Auth                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| Hosted Supabase                | Run [schema.sql](supabase/schema.sql) in your project's SQL Editor. Enable the Data API for the `public` schema. | Your Supabase project URL       | Name `apikey`, value the backend secret key                           |
| Local PostgreSQL and PostgREST | Add `COMPOSE_PROFILES=local-data` to `.env`. The database initializes the same schema at startup.                | `http://sla-guard-gateway:3000` | Name `Authorization`, value `Bearer ` followed by `SLA_LOCAL_API_JWT` |

The schema enables row-level security and grants backend access to the server role. Keep the database credentials inside n8n. Back up the named PostgreSQL volume and its environment settings together if you use the local database.

### n8n workflow installation

1. Import **02 → 03 → 05 → 04 → 01** into the same n8n project.
2. Set the database base URL in each **Settings and Validation** node. Workflow 02 calls its node **Health Monitor Settings and Validation**.
3. Bind the database Header Auth credential to the nodes below.

   | Workflow | Database credential nodes                             |
   | -------- | ----------------------------------------------------- |
   | 02       | Load Website Service, Record Check Once per Execution |
   | 03       | Read Site Status, Load Saved Report                   |
   | 04       | Save Monthly Assessment                               |
   | 05       | Load Saved Report, Save Claim Draft                   |

4. Create a separate Header Auth credential with name `X-SLA-Key` and the value of `SLA_WEBHOOK_KEY` from your local `.env`. Select it on workflow 01's **Receive Authenticated SLA Request** node.
5. Select workflow 05 in 04's **Call 05 - Build Claim Draft**. Select 02, 03, and 04 in 01's matching Execute Sub-workflow nodes. Keep the supplied inputs and wait-for-completion settings.
6. If the legacy single-workflow starter is active, unpublish it to free the webhook and schedules. Publish 02, 03, 05, and 04, then publish 01.

The exports are inactive and contain placeholder workflow IDs and database URLs. [SLA_Guard_Workflow.json](SLA_Guard_Workflow.json) is the original single-workflow reference. Use the five numbered exports for deployment.

### Monitor a different website

Edit `public.sg_services` in Supabase and set `target_url` on the row with ID `website`. Set `expected_status` if the healthy endpoint uses a status other than HTTP 200. The next check reads the updated settings. For a service running on the Windows Docker host, use a URL such as `http://host.docker.internal:3000/health`.

The monitor probes the exact URL and disables redirects. Reports group evidence by service ID, so a billing month that spans a target change can contain checks from both targets.

## How it works

The React and TypeScript dashboard sends same-origin requests to its Express proxy. The proxy validates requests, adds the server-side webhook key, calls n8n, and validates the result. n8n records and reads evidence through the Supabase Data API. Supabase calculates report coverage, availability, eligibility, and candidate credit. The browser displays those results.

| Workflow                                                  | Entry point                        | Responsibility                                                         |
| --------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| [01 · Webhook Gateway](01_Webhook_Gateway.json)           | POST `/webhook/sla-guard`          | Authenticate, validate, route, and add the execution trace             |
| [02 · Health Monitor](02_Health_Monitor.json)             | Every minute or `check`            | Probe the configured site and store one live observation per execution |
| [03 · Status Lookup](03_Status_Lookup.json)               | `status`, `get_report`             | Return recent observations or a saved assessment and its claim draft   |
| [04 · Monthly Assessment](04_Monthly_SLA_Assessment.json) | First day at 00:05 UTC or `report` | Save the monthly assessment and request a draft when eligible          |
| [05 · Claim Draft](05_Claim_Draft.json)                   | Called by 04                       | Attach deterministic claim text to the exact saved report revision     |

Live evidence and synthetic demo evidence are stored with separate dataset labels.

## Dashboard

- **Overview** shows the latest website state, selected month's measured results, a discrete availability timeline, and six recent observations. **Run health check** writes a live observation.
- **Monitoring History** displays up to 20 returned observations per dataset. Time and status filters apply to those records. A gray timeline interval represents missing monitoring coverage.
- **SLA Reports** loads saved revisions or generates an assessment for the selected UTC month and dataset. It shows assessed availability, observed downtime, measured coverage, contract terms, and candidate credit.
- **Claim Review** shows the saved revision, supporting downtime windows, and copyable workflow-generated text for eligible claims. Synthetic drafts carry a demo notice.
- **Settings** shows gateway-supplied monitor settings and appearance controls. Monitor or contract edits are made in the database.

Live mode starts on the current UTC month. Demo mode starts on the previous UTC month. The global refresh control and automatic 60-second refresh call `status` while the dashboard is visible. Use **Load saved report** to refresh evidence for a report revision. **Generate assessment** creates a new revision for the selected month.

### Dashboard configuration

| Variable                 | Purpose                                                                | Default                                   |
| ------------------------ | ---------------------------------------------------------------------- | ----------------------------------------- |
| `SLA_WEBHOOK_KEY`        | Server-side credential for n8n and its matching Header Auth credential | Generated locally                         |
| `SLA_DOCKER_WEBHOOK_URL` | Upstream URL for the dashboard container                               | `http://n8n:5678/webhook/sla-guard`       |
| `SLA_WEBHOOK_URL`        | Upstream URL for a Node process running directly on the host           | `http://localhost:8080/webhook/sla-guard` |
| `LOCAL_DASHBOARD_PORT`   | Docker's loopback dashboard port                                       | `8083`                                    |
| `DASHBOARD_PORT`         | Dashboard port when running Node directly                              | `8083`                                    |
| `LOCAL_DEMO_PORT`        | Docker's loopback endpoint-directory and demo-site port                | `8082`                                    |
| `DEMO_CONTROL_TOKEN`     | Bearer token for the demo outage controls                              | Generated locally                         |

The dashboard proxy is designed for localhost. It uses the key at runtime on the server, validates the browser origin, and forwards requests to its configured upstream. The frontend saves the theme preference in browser storage. Keep `.env`, keys, and n8n credential exports private.

### Frontend development on the host

From `dashboard/`, install dependencies once with `npm ci`. With n8n available, start the development server:

```powershell
npm run dev
```

Development and production Node commands read the parent `.env` on the server. If the Compose dashboard is already using port 8083, choose another port for the local Node process with `$env:DASHBOARD_PORT = '8084'`.

For a host production build, `npm run build` creates `dashboard/dist`. Serve that build with `npm start` to keep the same-origin proxy available.

## Webhook and temporary API testing

Send JSON to `POST http://localhost:8080/webhook/sla-guard` with `Content-Type: application/json` and `X-SLA-Key: <SLA_WEBHOOK_KEY>`.

| JSON body                                                    | Result                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `{}` or `{"action":"status"}`                                | Latest live status and up to 20 observations                   |
| `{"action":"status","dataset":"demo"}`                       | Latest synthetic status and history                            |
| `{"action":"check"}`                                         | Run and record one live check                                  |
| `{"action":"report"}`                                        | Generate the previous UTC month's live report                  |
| `{"action":"report","dataset":"demo","month":"2026-10"}`     | Generate an assessment for a particular month and dataset      |
| `{"action":"get_report","dataset":"demo","month":"2026-10"}` | Read the saved assessment and eligible draft for that revision |

Dataset defaults to `live`. Use a `YYYY-MM` month for saved lookup and optionally for generation. A valid request returns `ok`, `action`, `execution_id`, and `result`. **HTTP 200 on a check means the observation was saved.** Inspect `result.check.is_up` for website health.

| HTTP status | Meaning                                          |
| ----------- | ------------------------------------------------ |
| 400         | Unsupported action, dataset, or month            |
| 401 / 403   | Missing or invalid webhook credential            |
| 404         | Saved report unavailable                         |
| 409         | Stale or ineligible claim revision               |
| 502         | Gateway, database, or workflow dependency failed |

Import the [Hoppscotch collection](SLA_Guard.hoppscotch-collection.json) through **Collections → Import from Hoppscotch**. In an active personal environment, set the secret variables `SLA_WEBHOOK_KEY` and `DEMO_CONTROL_TOKEN`. Set the collection's `REPORT_MONTH` to the month you want to test. Start with **Get live status**.

The demo site serves `GET /` and `GET /health`. Use `POST /admin/down` and `POST /admin/up` with `Authorization: Bearer <DEMO_CONTROL_TOKEN>` to simulate and restore an outage. While the monitor targets the demo site, record a live check after each state change to capture both observations.

## Evidence and SLA interpretation

| Sample contract term         | Value                        |
| ---------------------------- | ---------------------------- |
| Uptime target                | 99.9% per UTC calendar month |
| Monthly fee                  | USD 100                      |
| Candidate credit rate        | 10% for an eligible breach   |
| Sample interval              | 60 seconds                   |
| Maximum sample carry-forward | 90 seconds                   |
| HTTP timeout                 | 10 seconds                   |

The database carries each observation forward until the next sample, subject to the configured gap limit. It labels time beyond that coverage as unknown. A final, fully covered month strictly below the contractual target can qualify for a credit draft. Open months and months with gaps remain ineligible. The credit and draft are evidence for human review.

Run [demo-seed.sql](supabase/demo-seed.sql) to populate the previous UTC month with synthetic measurements. The seed includes two hours of downtime and, under the default contract, produces a USD 10 candidate credit. The October 2026 example has 99.731183% monthly availability. A saved report can be loaded repeatedly by its dataset and month, and its revision identifies the associated claim draft.

## Verification

Run the workflow export checks from the repository root:

```powershell
node tests/validate_split_workflows.mjs
node tests/validate_05_claim_draft.mjs
node tests/validate_workflow.mjs
docker compose config --quiet
```

Run [self-test.sql](supabase/self-test.sql) in the hosted SQL Editor for rollback-only database assertions. For the optional local database, run the same checks and seed with PowerShell:

```powershell
Get-Content -Raw supabase/self-test.sql | docker compose --profile local-data exec -T database psql -X -v ON_ERROR_STOP=1 -U postgres -d sla_guard
Get-Content -Raw supabase/demo-seed.sql | docker compose --profile local-data exec -T database psql -X -v ON_ERROR_STOP=1 -U postgres -d sla_guard
```

Run the deployed webhook smoke test from the repository root. The demo and outage options generate a fresh assessment revision and briefly toggle the demo site. The test restores the site at the end.

```powershell
python scripts/smoke_test.py --local-env --demo --outage
```

Run the frontend checks from `dashboard/`. Playwright exercises browser behavior using isolated synthetic fixtures. The Node test checks the proxy against a local mock upstream.

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm audit
```

## Troubleshooting

| Symptom                         | Check                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard cannot reach gateway  | Confirm n8n is running with workflow 01 published and attached to `sla-guard_default`. Confirm the container upstream URL.                                        |
| Gateway rejects the server key  | Match the runtime `SLA_WEBHOOK_KEY` with the Header Auth credential bound to workflow 01, then restart the dashboard.                                             |
| Recent website state is unknown | Check the latest sample timestamp and workflow 02's scheduled executions. A sample older than its hold limit cannot represent current health.                     |
| A report is missing             | Verify the selected month and dataset, then generate an assessment. To view the seeded example, select the demo dataset.                                          |
| A claim is unavailable          | Check the saved revision, report finality, unknown coverage time, and assessment outcome. Reload the saved report after regeneration.                             |
| An API action fails             | Use its `execution_id` to find the gateway run and follow the child workflow in n8n. Dashboard logs are available with `docker compose logs --tail=50 dashboard`. |

The optional tunnel profile exposes the authenticated webhook through the existing Nginx proxy:

```powershell
docker compose --profile tunnel up -d cloudflared
```

Find the HTTPS URL with `docker compose logs --tail=100 cloudflared`, append `/webhook/sla-guard`, and send the same `X-SLA-Key` header.

## Repository guide

| Path                                   | Contents                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `dashboard/`                           | React UI, typed contract, Express proxy, Docker build, and tests              |
| `01_*.json` through `05_*.json`        | Deployable n8n workflow exports                                               |
| `supabase/`                            | Schema, optional local initialization, demo seed, and database assertions     |
| `demo-site/`                           | Endpoint directory, health endpoint, and outage controls                      |
| `scripts/`                             | One-command startup, local environment setup, and deployed webhook smoke test |
| `tests/`                               | Workflow structure and business-logic checks                                  |
| `SLA_Guard.hoppscotch-collection.json` | Importable requests with placeholders for local credentials                   |

The lockfile, source files, and `.env.example` are part of the repository. Local secrets, installed dependencies, generated builds, test output, and local backups are excluded by [the ignore rules](.gitignore).
