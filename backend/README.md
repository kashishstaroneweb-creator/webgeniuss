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
V0_API_KEY=your-v0-api-key
# Legacy alias: OPENAI_API_KEY is copied to V0_API_KEY at runtime for the official v0 client.
# Keys: https://v0.app/chat/settings/keys — optional V0_API_URL, V0_PLATFORM_MODEL_ID
# Website generate/edit: attempt 1 = async + poll; attempts 2+ = sync (long POST) unless V0_WEBSITE_RETRY_WITH_SYNC=0. V0_RESPONSE_MODE only affects GET /website/v0-chat-check.
# Polling: V0_POLL_INITIAL_DELAY_MS (default 12000). V0_POLL_MAX_NOT_FOUND_MS (default 180000) caps total time spent in chat_not_found before retry. V0_POLL_INTERVAL_MS, V0_POLL_MAX_MS, V0_POLL_MAX_BACKOFF_MS, V0_GET_CHAT_TIMEOUT_MS.
# V0_CREATE_USE_AXIOS_FIRST=0 to use SDK fetch first; default axios first for POST /chats. V0_CREATE_ASYNC_TIMEOUT_MS (default 180000), V0_CREATE_TIMEOUT_MS for sync (default 600000)
# Windows: main.ts sets dns ipv4first unless V0_DNS_IPV4_FIRST=0 (helps some Undici fetch failures).
# If you still get 401 after rotating keys: remove V0_API_KEY / OPENAI_API_KEY from Windows User/System environment variables (they override `.env` unless you use load-env override — already enabled in `src/load-env.ts`).
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

