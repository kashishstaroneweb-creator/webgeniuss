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

`OPENAI_BACKEND_MODEL` is configurable so model upgrades do not require a code change. Generated backends are restricted to `server.js`, `package.json`, `data.json`, and `.env.example`, with only `express`, `cors`, and `dotenv` allowed as dependencies. Keep `V0_API_KEY` configured separately for frontend generation; `OPENAI_API_KEY` is only for backend generation. This endpoint generates and stores the backend before its preview runtime is started.

Runtime controls:

- `POST /fullstack/:id/backend/start`
- `POST /fullstack/:id/backend/stop`
- `GET /fullstack/:id/backend/status`
- `ALL /fullstack/runtime/:id/api/*` (public preview gateway)

The local runner installs only approved dependencies with lifecycle scripts disabled and launches the generated server with a reduced environment. It is suitable for a controlled MVP/private beta, not strong production isolation.
