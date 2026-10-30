/**
 * AuditService — سجل العمليات append-only بـ hash chain (15.2).
 * كل سطر: من فعل / ماذا / على من / متى / الجهاز/IP / الموافق / السبب / metadata.
 */
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@/common/db.service';
import { auditHash } from '@/common/audit.hash';

export interface AuditEntry {
  actorId?: string | null;
  action: string;                       // approve_member / ban_confirmed / open_precise_view / ...
  targetType: string;                   // user / incident / house / settings
  targetId?: string | null;
  approverId?: string | null;
  metadata?: Record<string, unknown>;
  device?: string;
  ip?: string;
}

@Injectable()
export class AuditService {
  private logger = new Logger(AuditService.name);

  constructor(private db: DbService) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.db.tx(async (c) => {
      // قفل صف افتراضي serial مع last hash لضمان تسلسل واحد
      await c.query(`SELECT pg_advisory_xact_lock(918273)`);
      const prev = await c.query<{ hash: string }>(
        `SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1`,
      );
      const id = await c.query<{ id: number }>(`SELECT nextval('audit_log_id_seq') AS id`);
      const prevHash = prev.rows[0]?.hash ?? 'GENESIS';
      const parsedId = id.rows[0].id;
      const hash = this.hash({ ...entry, id: parsedId, prevHash });
      await c.query(
        `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, approver_id, metadata, device, ip, prev_hash, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [parsedId, entry.actorId ?? null, entry.action, entry.targetType, entry.targetId ?? null,
         entry.approverId ?? null, entry.metadata ?? {}, entry.device ?? null, entry.ip ?? null, prevHash, hash],
      );
    });
    this.logger.log(`audit ${entry.action} on ${entry.targetType}#${entry.targetId}`);
  }

  private hash(row: AuditEntry & { id: number; prevHash: string }) {
    return auditHash(row); // single-source-of-truth — نفس الدالة في أداة التحقق
  }
}
