import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ transform: true, forbidUnknownValues: false }));
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? '*' });

  // Socket.IO على نفس الخادم (10.4) — الاستحقاق يعاد فحصه عند كل اشتراك (11-2)
  const { Server } = await import('socket.io');
  // app.getHttpServer() = خادم http.Server الفعلي (لا تطبيق Express) — شرط ربط socket.io
  const io = new Server(app.getHttpServer(), { cors: { origin: process.env.CORS_ORIGIN ?? '*' } });
  const realtime = app.get((await import('@/realtime/realtime.gateway')).RealtimeGateway);
  realtime.attach(io);
  realtime.registerJwtGuard(app.get((await import('@/common/db.service')).DbService),
    app.get((await import('@/incidents/privacy.service')).PrivacyService));

  // خدمات معدة لتشتغل بجانب الخادم (بدل job مُنفصل في هذه المرحلة)
  const escalation = app.get((await import('@/incidents/escalation.service')).EscalationService);
  const privacy = app.get((await import('@/incidents/privacy.service')).PrivacyService);
  escalation.onIncidentNotified = (incidentId, userId, ring) => {
    // معيار قبول 1: WebSocket لا يبث الموقع الدقيق — التحديث حالφαً يتم عبر threading الهيئة
    realtime.notifyUser(userId, 'incident:new', { incidentId, ring });
  };
  escalation.onIncidentUpdate = (incidentId) => realtime.broadcastIncidentUpdate(incidentId);

  await app.listen(Number(process.env.PORT ?? 3000));
  console.log(`✓ فزعة رمح API on :${process.env.PORT ?? 3000} (REST + WS)`);
  void privacy; void escalation;
}

bootstrap().catch((e) => { console.error(e); process.exit(1); });
