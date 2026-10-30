/**
 * RealtimeGateway — Socket.IO (10.4): WebSocket للموقع الحي والخط الزمني + HTTP polling احتياطي.
 * ضوابط 11: كل اشتراك يُفحص entitled (committedResponder/requester/live admin) — صلاحية الموقع الدقيق
 * تُسحب مع انسحاب/استبعاد/إغلاق فورًا.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Server } from 'socket.io';
import { DbService } from '@/common/db.service';
import { PrivacyService } from '@/incidents/privacy.service';

@Injectable()
export class RealtimeGateway implements OnModuleDestroy {
  private io: Server | null = null;
  userSockets = new Map<string, Set<string>>(); // للإشعارات الفورية داخل التطبيق

  attach(server: Server) { this.io = server; }

  async onModuleDestroy() { if (this.io) await this.io.close(); }

  /** يُستدعى من main.ts بعد التأسيس — التحقق عند الاتصال و عند كل اشتراك (11-2) */
  registerJwtGuard(db: DbService, privacy: PrivacyService) {
    if (!this.io) return;
    this.io.use(async (socket, next) => {
      try {
        const token = (socket.handshake.auth?.token ?? socket.handshake.query?.token) as string | undefined;
        if (!token) return next(new Error('missing_token'));
        const jwt = await import('jsonwebtoken');
        const payload = jwt.verify(token, process.env.JWT_SECRET ?? 'dev-jwt-secret') as { sub: string };
        socket.data.userId = payload.sub;
        next();
      } catch { next(new Error('invalid_token')); }
    });

    this.io.on('connection', (socket) => {
      const userId: string = socket.data.userId;
      if (!this.userSockets.has(userId)) this.userSockets.set(userId, new Set());
      this.userSockets.get(userId)!.add(socket.id);
      socket.on('disconnect', () => { this.userSockets.get(userId)?.delete(socket.id); });

      // الاشتراك في بلاغ غرف incident:{id} — فحص التخويل عند كل اشتراك
      socket.on('incident:subscribe', async (incidentId: string, ack?: (r: unknown) => void) => {
        try {
          const ent = await privacy.entitlement(incidentId, userId, 'member');
          const notified = await db.one<{ ring: number }>(
            `SELECT max(ring) ring FROM incident_notifications WHERE incident_id=$1 AND user_id=$2`,
            [incidentId, userId]);
          if (!ent.live && !ent.isHouseAdminActiveIncident && !notified) {
            ack?.({ ok: false, error: 'not_entitled' });
            return;
          }
          await socket.join(`incident:${incidentId}`);
          ack?.({ ok: true, entitlement: { precise: ent.precise, live: ent.live } });
        } catch { ack?.({ ok: false, error: 'subscribe_failed' }); }
      });

      // انسحاب الاشتراك (تُسعرف الصلاحيات انسحابًا/استبعادًا/إغلاقًا من بحور الحالات)
      socket.on('incident:unsubscribe', async (incidentId: string) => {
        await socket.leave(`incident:${incidentId}`);
      });
    });
  }

  /** صاحب البلاغ/الملتزمون يرون الموقع الحي — يُستدعى من IncidentsService.postLive */
  broadcastLive(incidentId: string, userId: string, point: { lat: number; lng: number; speed?: number }) {
    this.io?.to(`incident:${incidentId}`).emit('live:location', { incidentId, userId, ...point, ts: Date.now() });
  }

  broadcastIncidentUpdate(incidentId: string) {
    this.io?.to(`incident:${incidentId}`).emit('incident:update', { incidentId, at: Date.now() });
  }

  /** إشعار تراجعي للملتزمين — يدفع للعميل دون انتظار FCM (10.6، إشعارات عادية لا إنذار) */
  notifyUser(userId: string, event: string, payload: unknown) {
    for (const sid of this.userSockets.get(userId) ?? []) {
      this.io?.to(sid).emit(event, payload);
    }
  }
}
