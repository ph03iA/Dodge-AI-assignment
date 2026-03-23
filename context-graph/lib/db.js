import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
export default sql;

/** PostgreSQL undefined_table — schema not applied or wrong database */
export function isMissingSchemaError(err) {
  return err?.code === '42P01';
}
