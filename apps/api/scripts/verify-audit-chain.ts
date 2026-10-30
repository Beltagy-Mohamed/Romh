/**
 * Trim verification: Hash Chain — append-only audit_log that allows spotting tampering (15.2).
 */
import 'dotenv/config';
import { Client } from 'pg';
import { auditHash as hashRow } from '../src/common/audit.hash';

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    options: '-c app.role=system', // نفس دور الخادم — audit_log متاح للنظام فقط
  });
  await client.connect();
  const { rows } = await client.query(
    `SELECT id, actor_id, action, target_type, target_id, metadata, prev_hash, hash FROM audit_log ORDER BY id`,
  );
  let prev = 'GENESIS';
  for (const r of rows) {
    const expect = hashRow({ id: r.id, actorId: r.actor_id, action: r.action, targetType: r.target_type, targetId: r.target_id, metadata: r.metadata, prevHash: prev });
    if (r.hash !== expect) { console.error(`✗ تلاعب عند id=${r.id}`); await client.end(); process.exit(1); }
    prev = r.hash;
  }
  console.log(`✓ سلسلة سليمة — ${rows.length} سجلًا`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
