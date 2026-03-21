/**
 * Load `.env` before other modules read `process.env` (e.g. TypeORM, WebsiteService).
 * `override: true` matters on Windows: User/system env vars (e.g. old V0_API_KEY) would
 * otherwise block updated values in `.env` — a common cause of persistent 401 after
 * rotating keys.
 */
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env'), override: true });
