/**
 * DbService — pg Pool + سياق RLS لكل اتصال (D-004).
 * القاعدة: كل استعلام باسم عضو عبر withUser() أو نظامًا عبر tx()/query().
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

export type UserRole = 'member' | 'house_admin' | 'mediator' | 'super_admin' | 'deputy' | 'auditor';

/** إرفاق options=-c app.role=system بـ connection string (مرة واحدة لكل اتصال) */
function withSystemRole(url: string): string {
  if (/[?&]options=/.test(url)) return url;
  const opt = encodeURIComponent('-c app.role=system');
  return url.includes('?') ? `${url}&options=${opt}` : `${url}?options=${opt}`;
}

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  // options=-c app.role=system: كل اتصال من الخادم يبدأ بدور system الموثوق.
  // مسارات المستخدم (withUser) تعيد ضبطه ليقيد بسياسات RLS الخاصة به.
  private url = withSystemRole(process.env.DATABASE_URL ?? 'postgres://localhost/fazaa');
  pool = new Pool({ connectionString: this.url, max: 20 });

  async onModuleInit() { await this.pool.query('SELECT 1'); }
  async onModuleDestroy() { await this.pool.end(); }

  /**
   * استعلام باسم عضو: يضبط app.user_id/local role ثم يلتزم معاملة واحدة.
   * سياسات RLS (db/migrations/0003_rls.sql) تنطبق على كل جملة داخل المعاملة.
   */
  async withUser<T>(userId: string, role: UserRole, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.role', $2, true)`,
        [userId, role],
      );
      await c.query('BEGIN');
      try {
        const out = await fn(c);
        await c.query('COMMIT');
        return out;
      } catch (e) { await c.query('ROLLBACK'); throw e; }
    } finally { c.release(); }
  }

  /** استعلامات النظام (طابور، محرك دوائر) — تلغى سياسات RLS بمالك الشبكة في الديفولت محليًا */
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      try { const r = await fn(c); await c.query('COMMIT'); return r; }
      catch (e) { await c.query('ROLLBACK'); throw e; }
    } finally { c.release(); }
  }

  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
    return this.pool.query(sql, params) as never;
  }

  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    return this.query<T>(sql, params).then((r) => (r.rows[0] as T) ?? null);
  }
}
