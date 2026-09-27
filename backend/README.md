# WebGenius API - Backend

NestJS backend for WebGenius platform with MongoDB, TypeORM, and v0 API integration for production-ready website generation.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env`:
```env
MONGODB_URI=mongodb://localhost:27017/webgenius
JWT_SECRET=your-secret-key
BACKEND_GENERATOR_URL=https://webgeniuss.onrender.com
BACKEND_PUBLIC_BASE_URL=https://webgeniuss.onrender.com
V0_API_KEY=your-v0-api-key
OPENAI_API_KEY=your-openai-api-key
OPENAI_BACKEND_MODEL=gpt-4.1-mini
# Keys: https://v0.app/chat/settings/keys — optional V0_API_URL, V0_PLATFORM_MODEL_ID
# Website generate/edit: attempt 1 = async + poll; attempts 2+ = sync (long POST) unless V0_WEBSITE_RETRY_WITH_SYNC=0. V0_RESPONSE_MODE only affects GET /website/v0-chat-check.
# Polling: V0_POLL_INITIAL_DELAY_MS (default 12000). V0_POLL_MAX_NOT_FOUND_MS (default 180000) caps total time spent in chat_not_found before retry. V0_POLL_INTERVAL_MS, V0_POLL_MAX_MS, V0_POLL_MAX_BACKOFF_MS, V0_GET_CHAT_TIMEOUT_MS.
# V0_CREATE_USE_AXIOS_FIRST=0 to use SDK fetch first; default axios first for POST /chats. V0_CREATE_ASYNC_TIMEOUT_MS (default 180000), V0_CREATE_TIMEOUT_MS for sync (default 600000)
# Windows: main.ts sets dns ipv4first unless V0_DNS_IPV4_FIRST=0 (helps some Undici fetch failures).
# If v0 still returns 401 after rotating its key, remove stale V0_API_KEY values from Windows User/System environment variables (they override `.env` unless you use load-env override — already enabled in `src/load-env.ts`).
# Debug: set V0_DEBUG_AUTH=1 to log key length and base URL on startup (no secret printed).
# ... see .env.example for all variables
```

3. Start MongoDB (if running locally):
```bash
mongod
```

4. Run the server:
```bash
npm run start:dev
```

## Project Structure

```
src/
├── entities/          # TypeORM entities
├── auth/             # Authentication module
├── user/             # User management
├── prompt/           # Prompt history
├── website/          # Website generation
├── subscription/     # Subscription plans
└── role/             # Role management
```

## API Documentation

See main README.md for API endpoints.
# Full-stack MVP generation

`POST /fullstack/generate` creates a shared application blueprint, asks OpenAI for a small plain Node.js/Express backend, derives the React UI prompt from the same API contract, and sends that UI prompt through the existing v0 pipeline. Both halves are saved on one website record.

Required backend environment variables:

```env
OPENAI_API_KEY=your-openai-api-key
OPENAI_BACKEND_MODEL=gpt-4.1-mini
```

`OPENAI_BACKEND_MODEL` is configurable so model upgrades do not require a code change. The model generates `routes.js`, `package.json`, `data.json`, and optionally `.env.example`. WebGenius adds its tested `server.js` and `auth.js`; only pinned `express`, `cors`, and `dotenv` dependencies are installed. Keep `V0_API_KEY` configured separately for frontend generation; `OPENAI_API_KEY` is only for backend generation. This endpoint generates and stores the backend before its preview runtime is started.

Runtime controls:

- `POST /fullstack/:id/backend/start`
- `POST /fullstack/:id/backend/stop`
- `GET /fullstack/:id/backend/status`
- `ALL /fullstack/runtime/:id/api/*` (public preview gateway)

The local runner installs only approved dependencies with lifecycle scripts disabled and launches the generated server with a reduced environment. It is suitable for a controlled MVP/private beta, not strong production isolation.

## Authentication in newly generated full-stack apps

New full-stack backends include the following routes. Through the preview gateway, prefix each path with `/fullstack/runtime/<runtime-id>` (use the project's `backendPreviewUrl`; remote generation may use a different runtime ID).

| Method | Path | Request | Result |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | `{ email, password, name? }` | 201: `{ user, token, expiresAt }` |
| POST | `/api/auth/login` | `{ email, password }` | 200: `{ user, token, expiresAt }` |
| GET | `/api/auth/me` | Bearer token | 200: `{ user }` |
| POST | `/api/auth/logout` | Bearer token | 200: `{ ok: true }`; revokes that session |

Passwords must contain 12–128 characters. Emails are normalized; duplicate signup returns 409. Invalid credentials return 401 and repeated attempts return 429. `user` contains only `id`, `email`, and `name`. Sessions expire after 24 hours; clients send `Authorization: Bearer <token>`. The platform's JWT is not a generated-app credential. All business routes require authentication before model-written handlers execute; `/api/health` remains public. Generated routes receive `req.user` and are instructed to enforce record ownership for user-specific data.

The supplied auth module uses Node's scrypt with random salts and timing-safe hash comparisons. Account records and hashed session tokens live in `auth-data.json`, separate from business data. Writes are serialized and atomic; corrupt credential files fail closed. Passwords and raw tokens are never saved. The file is created at runtime, remains across ordinary stop/start cycles, and is not part of generated source files. Disk loss or an ephemeral-host redeployment loses these records: durable database storage is still future work. This file store supports one server process per generated app.

The frontend generation contract includes the auth endpoints, in-memory token handling, login/signup screens, and handling for expired sessions. Generated users sign in again after refreshing. Use HTTPS when publishing the app outside local development.

Existing generated projects are unchanged; generate a new full-stack project to use this contract. When `BACKEND_GENERATOR_URL` points to another WebGenius installation, update both services together. Remote plans with a different auth template are rejected instead of silently accepting unverified authentication code.

Validation: `npm test -- --runInBand` includes real HTTP tests of the exact shipped server/auth templates, storage inspection, concurrent duplicate signup, session expiry/revocation, restart persistence, generation assembly, and gateway authorization forwarding. These tests use mocked AI responses and do not spend provider credits.

## Vercel deployment for generated frontends

Open a generated project in the dashboard and click **Deploy**. The dialog shows the latest deployment, refreshes building status, and provides an **Open deployed website** link when Vercel reports READY. Clicking **Deploy frontend** publishes source to the configured Vercel account; opening the dialog only reads status. Deploy again after editing to publish the latest code.

Configure these variables on the WebGenius backend and restart it:

```env
VERCEL_TOKEN=your-vercel-access-token
# Optional: target a specific Vercel team
VERCEL_TEAM_ID=team_your_team_id
```

Create the token in Vercel account settings and grant it access to the intended account/team. Keep it on the backend, never in a frontend `VITE_` variable. Deployments use a separate project name `webgenius-<website-id>` for each generated website. The configured Vercel account receives hosting/build usage; WebGenius does not deduct generation credits for deployment. Vercel deployment protection/account rules still determine who can open the resulting URL.

- React/Vite: packages saved components, entry point, styles and build settings. SPA routes fall back to `index.html`; assets keep their normal paths.
- HTML: publishes `index.html`, CSS and JavaScript without an npm build.
- Next.js: retrieves the latest completed full source from the website's v0 chat using the existing `V0_API_KEY`. This preserves native routes and dependencies that are absent from the simplified preview. A missing/incomplete v0 source cannot be deployed through this option.
- Full-stack apps: this publishes the frontend only. Enter a public HTTPS backend base URL (without a trailing `/api`). Vercel rewrites `/api/*` to that backend so relative API calls stay same-origin. For a WebGenius preview runtime, use its complete hosted base, e.g. `https://your-backend.example.com/fullstack/runtime/<runtime-id>`. A local URL is insufficient; the runtime's existing uptime and file-persistence limitations still apply. Use a separately hosted durable backend for production.

The package excludes environment files, private keys, local caches and separately generated backend files. It replaces package lifecycle scripts with the framework build command and uses `npm install --ignore-scripts`. Packages that require install hooks may need a manual deployment. Inline deployment is limited to 500 files and 4 MB; larger projects need the Vercel CLI. Generated code can still fail a Vercel build: inspect its build logs, fix the project, and deploy again.

If the hosted backend enforces an Origin allowlist, add the deployed frontend origin there. For a WebGenius backend, append the deployed origin to its comma-separated `FRONTEND_URL` setting and restart it. The API proxy does not override the backend's own access rules.

Authenticated endpoints: `GET /website/:id/vercel` and `POST /website/:id/vercel` (optional `{ backendUrl }`). Both enforce ownership. State is stored separately in `website_deployments`; only the stored provider deployment ID is polled. Failed network submissions are marked UNKNOWN and never automatically retried. Check Vercel before resubmitting to avoid a duplicate. The submission lock is per process; multi-instance operation needs a distributed lock.

Implementation references: [create deployment](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment), [deployment status](https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url), and [external rewrites](https://vercel.com/docs/routing/rewrites). Automated tests mock Vercel/v0 and do not publish externally.
