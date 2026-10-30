/**
 * مشغّل الـ migrations: ينفذ db/migrations/*.sql بالترتيب مرة واحدة لكل ملف.
 * نهج SQL خام لأن PostGIS وRLS مواطن من الدرجة الأولى (D-002).
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { Client } from 'pg';
import path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../db/migrations');
// Admin: لإنشاء الدور fazaa_app ثم تطبيق الـ migrations.
// ملاحظة معمارية: مالك الجداول يتجاوز RLS، لذا الخادم التشغيلي يتصل بـ fazaa_app فقط.
const ADMIN_URL = process.env.ADMIN_DATABASE_URL ?? 'postgres://fazaa:fazaa_dev_password@localhost:5432/fazaa';

async function main() {
  const boot = new Client({ connectionString: ADMIN_URL });
  await boot.connect();
  await ensureMigrationsTable(boot);
  const applied = new Set(
    (await boot.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version),
  );

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}.*\.sql$/.test(f)).sort();
  for (const file of files) {
    if (applied.has(file)) { console.log(`= ${file} (مطبّق سابقًا)`); continue; }
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`> تطبيق ${file} ...`);
    try {
      await boot.query('BEGIN');
      await boot.query(sql);
      await boot.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
      await boot.query('COMMIT');
      console.log(`✓ ${file}`);
    } catch (e) {
      await boot.query('ROLLBACK');
      console.error(`✗ فشل ${file}:`, (e as Error).message);
      process.exit(1);
    }
  }
  await boot.end();
}

async function ensureMigrationsTable(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

main().catch((e) => { console.error(e); process.exit(1); });
