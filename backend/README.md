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
# Keys: https://v0.app/chat/settings/keys — optional V0_API_URL, V0_PLATFORM_MODEL_ID, V0_CHAT_TIMEOUT_MS
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

