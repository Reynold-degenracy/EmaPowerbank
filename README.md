[English](README.md) | [简体中文](README_ZH.md)

# Ema Powerbank

Ema Powerbank is a Gemini API token relay built with TypeScript, React, Express, and SQLite. It exposes Gemini-shaped REST endpoints under `/api/v1*` and does not convert requests into another API protocol. Its job is to replace upstream authentication, forward requests, store audit logs, track usage, and charge user balances.

## Features

- Single-port service: frontend and backend run on the same port, defaulting to `http://localhost:8787`.
- `/api` backend prefix: application APIs and Gemini relay endpoints live under `/api`.
- Gemini REST passthrough: clients keep the normal Gemini request shape and only change the Base URL.
- User accounts: users register and log in with only username and password.
- API key management: users can create, copy, and delete `ep_` prefixed relay keys.
- Admin console: the single admin can configure upstream credentials, model pricing, user balances, and users.
- Upstream support: Google AI Studio API keys and Vertex AI service account JSON.
- Usage and cost reporting: daily cost chart, model filters, request success totals, token details, and cost details.
- SQLite persistence: users, keys, upstream settings, pricing, balances, and usage records are stored in `data/relay.sqlite`.
- Request audit logs: every relayed request is saved as JSON in `request-logs/` with timestamp and user id in the filename.

## Stack

- React 19
- TypeScript
- Vite 7
- Express 5
- better-sqlite3
- Google GenAI SDK
- google-auth-library

Node.js 20 or newer is recommended.

## Quick Start

```bash
npm install
npm run dev
```

The development server starts at:

```text
http://localhost:8787
```

On first launch, if no admin user exists, the server creates:

```text
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123456
```

Log in as the admin, configure an upstream provider, set user balances, and users can start calling Gemini through their relay API keys.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Web server port |
| `NODE_ENV` | `development` | Set to `production` to serve the built `dist/` frontend |
| `JWT_SECRET` | `development-only-change-me` | Session signing secret. Must be changed in production |
| `SESSION_COOKIE_SECURE` | Derived from `NODE_ENV` when unset: `true` in production, otherwise `false` | Overrides whether the login session cookie uses the `Secure` attribute |
| `ADMIN_USERNAME` | `admin` | Admin username used only during first database initialization |
| `ADMIN_PASSWORD` | `admin123456` | Admin password used only during first database initialization |

Production example:

```bash
export JWT_SECRET="replace-with-a-long-random-secret"
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="replace-with-a-strong-password"
export PORT=8787
# Only use this when production is served over plain HTTP.
export SESSION_COOKIE_SECURE=false

npm ci
npm run build
# Optional in a runtime image after build artifacts already exist.
npm prune --omit=dev
npm start
```

`SESSION_COOKIE_SECURE` has priority over the `NODE_ENV` default. Keep it `true` when serving over HTTPS. Set it to `false` only for plain-HTTP deployments; otherwise browsers will reject the production session cookie and the app will show `Not authenticated` after login.

## Admin Configuration

The admin must configure one upstream provider before relay requests can succeed.

AI Studio:

- Select `AI Studio`
- Enter the string `API Key`
- No location is required

Vertex AI:

- Select `Vertex AI`
- Enter `Location`, usually `global`
- Enter the service account JSON
- The service account JSON must include `project_id`
- The service account must have permission to call Vertex AI Gemini models

The active provider is shown in the admin panel. AI Studio and Vertex AI credentials are stored in the SQLite `settings` table, so keep the deployment directory and database file permissions tight.

## Default Model Pricing

The first startup seeds these default pricing rows:

| Model | Uncached input | Output | Cached input | Embedding |
| --- | ---: | ---: | ---: | ---: |
| `gemini-3.5-flash` | `$1.50/M` | `$9.00/M` | `$0.15/M` | `-` |
| `gemini-3.1-pro-preview` | `$2.00/M` | `$12.00/M` | `$0.20/M` | `-` |
| `gemini-embedding-001` | `-` | `-` | `-` | `$0.15/M` |
| `gemini-embedding-2` | `-` | `-` | `-` | `$0.20/M` |

Admins can delete and add model pricing rows. A model ID cannot be added twice. Empty or zero prices are treated as unavailable and displayed as `-`.

## Billing Rules

Prices are per 1M tokens or characters.

- Uncached input: `promptTokenCount - cachedContentTokenCount`
- Output: `thoughtsTokenCount + candidatesTokenCount`
- Cached input: `cachedContentTokenCount`
- Embedding: `billableCharacterCount`

Users are charged only when the upstream response is `2xx`. Requests for unpriced models are still forwarded, audited, and counted, but they do not deduct balance.

Embedding model usage is always normalized into the embedding bucket. If an upstream embedding response does not include `billableCharacterCount`, the relay falls back to returned token counts to avoid recording embedding usage as prompt or output usage.

## User Integration

After logging in, users can:

- View balance, cumulative cost, today's cost, and request success rate
- Create and copy API keys
- Copy the Base URL
- See available model IDs and prices
- Send test requests from the built-in API test panel
- Submit issue feedback with a required issue description and up to 10 optional image attachments; accepted feedback can earn a reward amount
- View daily cost statistics

Base URL:

```text
http://localhost:8787/api
```

For production, replace it with your domain:

```text
https://example.com/api
```

Relay authentication supports:

- `x-goog-api-key: ep_xxx`
- `x-api-key: ep_xxx`
- `Authorization: Bearer ep_xxx`
- URL query: `?key=ep_xxx`

Headers are recommended so keys do not appear in browser history or ordinary access logs.

## API Examples

Generate content:

```bash
curl "http://localhost:8787/api/v1beta/models/gemini-3.5-flash:generateContent" \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: ep_xxx" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [
          { "text": "Who are you?" }
        ]
      }
    ]
  }'
```

Embedding:

```bash
curl "http://localhost:8787/api/v1beta/models/gemini-embedding-001:batchEmbedContents" \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: ep_xxx" \
  -d '{
    "requests": [
      {
        "model": "gemini-embedding-001",
        "content": {
          "role": "user",
          "parts": [
            { "text": "hello" }
          ]
        }
      }
    ]
  }'
```

AI Studio upstream requests are forwarded to `generativelanguage.googleapis.com`. Vertex AI upstream requests map `/api/v1beta/models/{model}:...` to the configured service account project, location, and Vertex publisher model path.

For Vertex AI embedding requests, `gemini-embedding-001` and text embedding models are converted to Vertex `predict`; newer Gemini embedding models are converted to Vertex `embedContent`. Responses are converted back to a batch embedding shape.

## Data Directories

Runtime creates:

```text
data/relay.sqlite
request-logs/
feedback/
```

`data/relay.sqlite` stores:

- Users and the admin account
- API key hashes and copyable values for newly created keys
- Upstream configuration
- Model pricing
- User balances
- Usage records

`request-logs/` stores one JSON audit file per relayed request, including:

- Request path, method, headers, and body
- Upstream URL with sensitive query values redacted
- Response status and body
- Extracted usage and cost
- Total request duration and timing breakdown

`feedback/` stores one directory per submitted feedback package. Each package directory is named `feedback-<id>-<timestamp>/` and contains `feedback.json` plus up to 10 optional uploaded image attachments at 5 MB each. The JSON file includes the feedback id, timestamp, submitting user, issue description, attachment metadata array, review status, and reward metadata. Admins can filter feedback by pending, approved, or rejected status; each status list is paginated at 10 items per page. Admins can export all feedback as CSV with `user-name`, `user-id`, `description`, `attachments-filenames`, and `review-status` fields. Admins can review feedback, view the issue description in a labeled read-only text box, see the submitted time and package name below the description, preview image attachments horizontally, approve with a non-zero reward amount, or reject without granting balance.

## Logs Page

Signed-in users can open the `Logs` page to view only their own request logs. Admins can view all users' logs and use the user filter. The backend enforces this on both the list and detail APIs, so non-admin users cannot access another user's log by guessing an id. The list view is indexed from the SQLite `usage_records` table, so user/time filters and 20-item pagination do not scan or load every JSON audit file. Each list row includes database-backed metadata such as user, request time, model, status code, usage, cost, total duration, and the audit filename.

When a permitted user expands one row, the backend reads that row's `audit_file` from `request-logs/` and returns the full JSON details for display. If the database record still exists but the JSON file has been deleted, the list row remains visible, while expanding it returns `404 Request log file not found` and the UI shows that error for the row.

Request and response bodies are stored as-is and may contain user data. In production, restrict directory permissions and define a cleanup, archival, and backup policy.

## Production Deployment

Build the frontend:

```bash
npm run build
```

Start the production server:

```bash
NODE_ENV=production npm start
```

`npm run build` emits the Vite frontend to `dist/` and the compiled Express server to `dist-server/`. `npm start` runs `node dist-server/index.js`, so production runtime installs can omit dev dependencies after the build artifacts have been created.

In production mode, Express serves the `dist/` frontend and continues to expose backend and relay APIs on the same port.

Recommended production checklist:

- Use HTTPS
- Set a strong `JWT_SECRET`
- Change the default admin password
- Restrict permissions for `data/` and `request-logs/`
- Restrict permissions for `feedback/`
- Back up `data/relay.sqlite`
- Clean up or archive `request-logs/` as needed
- Clean up or archive `feedback/` as needed
- If running behind a reverse proxy, configure request body size and timeout limits for model responses

## Verification

Typecheck:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

Smoke test after build:

```bash
npm run smoke
```

Health check:

```bash
curl http://localhost:8787/api/health
```

Example response:

```json
{
  "ok": true,
  "time": "2026-06-01T17:44:56.974Z"
}
```

## Scope

Ema Powerbank is intentionally a Gemini REST relay plus local management app:

- It does not convert OpenAI Chat Completions or Responses API requests
- It does not change the semantic shape of user requests
- It does not hide upstream errors
- It does not implement multi-upstream load balancing

If OpenAI-compatible protocol support is required, do that conversion in the client or in a separate gateway layer.
