import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>;

/** Supabase transaction pooler needs `prepare: false`. */
export function createDb(url: string) {
  const client = postgres(url, { prepare: false, max: 10 });
  return drizzle(client, { schema });
}

export { schema };
