/** Test environment: repo .env for DATABASE_URL (local Supabase), everything else mock. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1]!;
    if (!['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET'].includes(key)) continue;
    if (process.env[key] === undefined) process.env[key] = m[2]!.replace(/^"|"$/g, '').split(' #')[0]!.trim();
  }
}
process.env['NODE_ENV'] = 'test';
process.env['ADAPTER_MODE'] = 'mock';
process.env['CHAIN_MODE'] = 'mock';
process.env['STORAGE_MODE'] = 'local';
process.env['LLM_MODE'] = 'mock';
process.env['DEV_AUTH_BYPASS'] = 'true';
process.env['AGENT_CLAIM_DELAY_MS'] = '0';
process.env['RATE_LIMIT'] = 'off';
process.env['LOG_LEVEL'] = process.env['LOG_LEVEL'] ?? 'warn';
process.env['UPLOADS_DIR'] = resolve(import.meta.dirname, '../../../data/uploads/test');
process.env['FF_X402'] = 'true';
process.env['FF_EXTENSIONS'] = 'true';
process.env['FF_TRADE_FILE'] = 'true';
process.env['FF_QR_JOIN'] = 'true';
