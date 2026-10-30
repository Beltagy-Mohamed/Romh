/**
 * SettingsService — Remote Config من جدول settings (الوثيقة: كل رقم قابل للضبط).
 * كاش 60 ثانية؛ الافتراضيات مأخوذة من db/migrations/0004_seed.sql.
 */
import { Injectable } from '@nestjs/common';
import { DbService } from '@/common/db.service';

export type RingPolicy = { r1_km: number; n1: number; r2_km: number; r3_km: number; t2_s: number; t3_s: number };

@Injectable()
export class SettingsService {
  private cache = new Map<string, unknown>();
  private loadedAt = 0;
  private TTL_MS = 60_000;

  constructor(private db: DbService) {}

  private async ensureLoaded() {
    if (Date.now() - this.loadedAt < this.TTL_MS) return;
    const { rows } = await this.db.query('SELECT key, value FROM settings');
    this.cache.clear();
    for (const r of rows) this.cache.set(r.key, r.value);
    this.loadedAt = Date.now();
  }

  /** قيمة رقمية من الإعدادات مع الافتراضي */
  async num(key: string, fallback: number): Promise<number> {
    await this.ensureLoaded();
    const v = this.cache.get(key);
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  async str(key: string, fallback: string): Promise<string> {
    await this.ensureLoaded();
    const v = this.cache.get(key);
    return typeof v === 'string' ? v.replace(/^"|"$/g, '') : fallback;
  }

  /**
   * بعد ربط البلاغ بسياسة توجيه النوع (ring_policy في incident_types):
   * قيمها تتقدم على الإعدادات العامة — القسم 7 (قابلة للتعديل دون نشر إصدار).
   */
  async ringPolicy(typeCode: string): Promise<RingPolicy> {
    const { rows } = await this.db.query(
      `SELECT ring_policy FROM incident_types WHERE code = $1`, [typeCode],
    );
    const rp = (rows[0]?.ring_policy ?? {}) as Partial<RingPolicy>;
    return {
      r1_km:   rp.r1_km   ?? await this.num('incident.ring1_km', 15),
      n1:      rp.n1      ?? await this.num('incident.ring1_size', 10),
      r2_km:   rp.r2_km   ?? await this.num('incident.ring2_km', 50),
      r3_km:   rp.r3_km   ?? await this.num('incident.ring3_km', 150),
      t2_s:    rp.t2_s    ?? await this.num('incident.ring2_after_s', 120),
      t3_s:    rp.t3_s    ?? await this.num('incident.ring3_after_s', 300),
    };
  }
}
