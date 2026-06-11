# Medplum Bots — Deployment Guide

How to **test locally** and **deploy to the dev environment** any Medplum Bot in this `bots/` directory.
Written to be **generic across bots** — today there is one (`fuzzy-match`), more are coming. Every bot
follows the same recipe; only the bot folder/name changes.

---

## 0. Conventions (so this scales to many bots)

```
bots/
├── DEPLOYMENT.md              ← this file (applies to ALL bots)
└── <bot-name>/                ← one folder per bot (e.g. fuzzy-match)
    ├── src/                   ← TypeScript source + Vitest tests
    ├── dist/                  ← built CJS bundle (gitignored)
    ├── esbuild-script.mjs     ← builds a single vmcontext-safe CJS file
    ├── package.json           ← `npm test`, `npm run build`
    └── scripts/
        ├── deploy-and-test-local.sh   ← local: deploy + seed test data + run battery
        └── deploy-bot-dev.sh          ← dev: idempotent deploy of the bot only
```

Throughout this guide, substitute:

| Placeholder | Meaning | Example (fuzzy-match) |
|---|---|---|
| `<BOT_DIR>` | the bot's folder under `bots/` | `fuzzy-match` |
| `<BOT_NAME>` | the Bot resource name / identifier value | `patient-fuzzy-match` |
| `<BUNDLE>` | the built CJS file in `dist/` | `patient-fuzzy-match.cjs` |

> **All bots in this repo use the `vmcontext` runtime** (run inside the Medplum server process — no AWS Lambda layer required). This matters because both local `docker compose` and the dev ECS Fargate stack run the **same `medplum/medplum-server` image**, so a bot that works locally works on dev unchanged.

---

## 1. Prerequisites (one-time per environment) — read this first

These bit us during the first deploy. **Every** bot needs all three or `$execute` fails:

| Requirement | Why | How to check / fix |
|---|---|---|
| **Project has the `bots` feature** | `$execute` checks `project.features.includes('bots')`; otherwise → `"Bots not enabled"` | Super-Admin → open the **Project** → add `bots` to **Features**. (Per-project, per-environment — enable it on both local and dev.) |
| **Admin client / token** | Creating + `$deploy`-ing a Bot requires **project admin**; `$execute` does not | Use a ClientApplication whose ProjectMembership is **Admin**, in the **same project** the bot lives in. |
| **CJS bundle with the vmcontext footer** | The runtime wraps code as CommonJS and calls `exports.handler`. ESM output → `Unexpected token 'export'`; CJS without the footer → `exports.handler is not a function` | Already handled by each bot's `esbuild-script.mjs` (`format: 'cjs'` + `footer: Object.assign(exports, module.exports)`). Just run `npm run build`. |

> **Token + project must match.** A `client_credentials` token is scoped to the client's project. If the client lives in a different project than the one with the `bots` feature, the bot lands in the wrong project and you get `"Bots not enabled"`. Always use a client that belongs to your target project.

### Getting an access token (any environment)

**Inline (copy-paste, nothing to set up)** — set `BASE`, `CLIENT_ID`, `CLIENT_SECRET` to your environment's values:

```bash
BASE=https://medplum-api.calmhsa-works.dev        # or http://localhost:8103 for local
CLIENT_ID=<your client id>
CLIENT_SECRET=<your client secret>

TOKEN=$(curl -s -X POST "$BASE/oauth2/token" \
  -d 'grant_type=client_credentials' \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
echo "$TOKEN"        # should print a long JWT
```

**Optional convenience helper** — if you prefer a reusable command, paste this **once into your current
shell** (it defines a function; it does NOT persist across new terminals). Then call `get_token …`:

```bash
get_token() {  # usage: get_token <BASE> <CLIENT_ID> <CLIENT_SECRET>
  curl -s -X POST "$1/oauth2/token" \
    -d 'grant_type=client_credentials' -d "client_id=$2" -d "client_secret=$3" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])"
}
# After pasting the function above, in the SAME shell:
# TOKEN=$(get_token https://medplum-api.calmhsa-works.dev <CLIENT_ID> <CLIENT_SECRET>)
```

> `get_token: command not found` just means you haven't pasted the function into this shell yet — use
> the inline form above, or paste the helper first.

If it prints `KeyError: 'access_token'`, the credentials are wrong **for that server** —
re-check you copied the id/secret from the *same* environment you're calling.

---

## 2. Local — test a bot end to end

Spins up a local Medplum (same prebuilt image as prod), runs the bot's unit tests, then deploys the
bot to localhost and exercises it with seeded test data.

```bash
# (a) start a local Medplum — from the repo root
docker compose up -d                       # postgres + redis + medplum-server + app
curl -s http://localhost:8103/healthcheck  # wait until this returns {"ok":true,...}

# (b) unit tests for the bot (no server needed) — proves the logic
cd bots/<BOT_DIR>
npm install && npm test

# (c) get a LOCAL admin token (client from your LOCAL project that has the `bots` feature)
BASE=http://localhost:8103
TOKEN=$(curl -s -X POST "$BASE/oauth2/token" \
  -d 'grant_type=client_credentials' \
  -d 'client_id=<LOCAL_CLIENT_ID>' \
  -d 'client_secret=<LOCAL_CLIENT_SECRET>' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# (d) deploy to localhost + run the bot's built-in scenario battery
BASE=http://localhost:8103 TOKEN=$TOKEN ./scripts/deploy-and-test-local.sh
```

`deploy-and-test-local.sh` creates the bot, deploys the code, seeds any test fixtures the bot needs,
and prints the scenario results. It is meant for **local iteration** — it may create throwaway test
data, so don't point it at a shared environment.

> For the `fuzzy-match` bot specifically, the battery is the F1 client-search suite
> (exact / typo / dropped-letter / name-only / phonetic / garbage-rejection). See
> `fuzzy-match/LOCAL-TEST.md` for the bot-specific walkthrough and expected output.

---

## 3. Dev environment — deploy a bot for real use

Deploys the bot to `https://medplum-api.calmhsa-works.dev` **idempotently** (re-runs update the same
Bot, no duplicates) and does **not** seed test data or run a battery — it just makes the bot available.

> **No infrastructure change.** This is NOT a `cdk deploy`. The dev ECS Fargate stack already runs the
> `vmcontext` runtime. Deploying a bot is purely a FHIR API operation (create Bot + `$deploy`).

```bash
cd bots/<BOT_DIR>

# (a) get a DEV admin token (client from the DEV project that has the `bots` feature)
BASE=https://medplum-api.calmhsa-works.dev
TOKEN=$(curl -s -X POST "$BASE/oauth2/token" \
  -d 'grant_type=client_credentials' \
  -d 'client_id=<DEV_CLIENT_ID>' \
  -d 'client_secret=<DEV_CLIENT_SECRET>' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# (b) idempotent deploy (build + create-or-update bot + deploy code)
BASE=https://medplum-api.calmhsa-works.dev TOKEN=$TOKEN ./scripts/deploy-bot-dev.sh
```

The script prints the **stable Bot id** and the invocation contract, e.g.:

```
 Bot id   : <uuid>
 Invoke   : POST https://medplum-api.calmhsa-works.dev/fhir/R4/Bot/<uuid>/$execute
```

### Invoking a deployed bot (from an app / Postman)

```bash
curl -s "https://medplum-api.calmhsa-works.dev/fhir/R4/Bot/<BOT_ID>/\$execute" \
  -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/fhir+json' \
  -d '<the bot’s input body>'
```

**Access model (important, and a nice security property):** by default a bot runs as its **own** bot
identity, not the caller's. So a calling app (e.g. the FOD portal) only needs permission to
**`$execute` the bot** — it does *not* need the bot's underlying data access (e.g. broad Patient read).
Scope the **bot's** ProjectMembership/AccessPolicy to what the bot needs; scope the **caller** to just
execute.

---

## 4. Adding a NEW bot (the repeatable recipe)

1. **Scaffold** a folder `bots/<new-bot>/` mirroring `fuzzy-match/` (package.json with `test` +
   `build`, `tsconfig.json`, `vitest.config.ts`, `esbuild-script.mjs`).
2. **Write** `src/<new-bot>.ts` exporting `handler(medplum, event)`, plus Vitest tests using
   `@medplum/mock` (`MockClient`). Keep any helpers in the same folder so esbuild can inline them.
3. **Build config:** copy `esbuild-script.mjs` and change `entryPoints`/`outfile` to your bot. Keep
   `format: 'cjs'` and `footer: { js: 'Object.assign(exports, module.exports);' }` — both are
   **required** for vmcontext bots.
4. **Scripts:** copy `scripts/deploy-and-test-local.sh` and `scripts/deploy-bot-dev.sh`, and update the
   bot-specific values:
   - bundle path `dist/<BUNDLE>`
   - `BOT_NAME` / `BOT_IDENTIFIER_VALUE` (use a unique, stable identifier so dev re-deploys are
     idempotent — current convention: system `https://calmhsa-works.dev/bots`, value = `<BOT_NAME>`)
   - in the local script, whatever test fixtures + scenario calls the bot needs.
5. **Test → deploy:** §2 (local) then §3 (dev), same as above.

> **Future cleanup (optional):** once there are several bots, these two scripts are nearly identical
> across bots. They can be promoted to a single shared script at `bots/` that takes `<BOT_DIR>` as an
> argument (reading the bundle name + identifier from each bot's `package.json`). Not needed yet —
> per-bot copies are fine while the count is small.

---

## 5. Quick reference

| Action | Command (from `bots/<BOT_DIR>`) |
|---|---|
| Unit test the bot | `npm test` |
| Build the deployable bundle | `npm run build` → `dist/<BUNDLE>` |
| Local deploy + battery | `BASE=http://localhost:8103 TOKEN=… ./scripts/deploy-and-test-local.sh` |
| Dev deploy (idempotent) | `BASE=https://medplum-api.calmhsa-works.dev TOKEN=… ./scripts/deploy-bot-dev.sh` |
| Invoke a deployed bot | `POST {BASE}/fhir/R4/Bot/{id}/$execute` with the bot’s input body |

## 6. Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `KeyError: 'access_token'` | Wrong credentials for that server, or server not reachable | Use id/secret from the **same** environment; confirm `/healthcheck` |
| `"Bots not enabled"` | Bot's project lacks the `bots` feature | Super-Admin → that Project → Features → add `bots` (and make sure the bot is in that project) |
| `403 / forbidden` on create/`$deploy` | Token is not a project admin | Use an **admin** ClientApplication in the target project |
| `Unexpected token 'export'` | Bundle is ESM | `esbuild-script.mjs` must use `format: 'cjs'` |
| `exports.handler is not a function` | CJS bundle missing the footer | Add `footer: { js: 'Object.assign(exports, module.exports);' }` |
| Bot returns `total: 0` unexpectedly | Candidate gathering / data — not a deploy issue | Check the bot's own logic + that the target data exists in that project |
