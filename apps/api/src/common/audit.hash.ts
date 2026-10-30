/**
 * audit-hash.ts — تجزئة single-source-of-truth لسجل العمليات (D-005، القسم 15.2).
 * تستخدم في كل من AuditService (الكتابة) وأداة التحقق (القراءة) لمنع اختلاف الكنونيكال.
 */
import crypto from 'crypto';

export function canonical(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(',') + '}';
}

export interface AuditRowForHash {
  id: number | bigint;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: unknown;
  prevHash: string;
}

export function auditHash(row: AuditRowForHash): string {
  return crypto.createHash('sha256')
    .update([row.id, row.actorId ?? '', row.action, row.targetType, row.targetId ?? '', row.prevHash, canonical(row.metadata ?? {})].join('|'))
    .digest('hex');
}
