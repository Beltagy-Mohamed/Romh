/// services/realtime_client.dart — Socket.IO مع إعادة اتصال تلقائي (10.4).
/// WebSocket للموقع الحي + تحديثات؛ يستقبل يعمل والتطبيق مفتوح فقط على iOS (PWA — D-008).
import 'package:socket_io_client/socket_io_client.dart' as socketio;
import 'api_client.dart';

class RealtimeClient {
  RealtimeClient._();
  static final RealtimeClient instance = RealtimeClient._();

  socketio.Socket? _socket;
  final Map<String, void Function(dynamic)> _subscriptions = {};

  void Function(String incidentId)? onUpdate;

  socketio.Socket ensure() {
    _socket ??= socketio.io(ApiClient.baseUrl, <String, dynamic>{
      'transports': ['websocket'],
      'auth': {'token': ApiClient.instance.token},
      'reconnection': true,
      'reconnectionAttempts': 999,
      'reconnectionDelay': 1000,
    });
    _socket!.onConnect((_) => _rejoinAll());
    _socket!.onConnectError((_) {/* إعادة محاولة — إسقاط ابن الأحداث موقوف مؤقتًا */});
    _socket!.on('incident:update', (data) {
      final id = (data is Map ? data['incidentId'] : null) as String?;
      if (id != null) onUpdate?.call(id);
    });
    _socket!.connect();
    return _socket!;
  }

  void subscribeIncident(String incidentId, void Function(dynamic) handler) {
    _subscriptions[incidentId] = handler;
    ensure();
    _socket!.emitWithAck('incident:subscribe', incidentId, ack: (r) {
      // رقم مرفوض = غير متحقق اشتراك (11-2) — الخادم من يفحص الصلاحيات
    });
  }

  void _rejoinAll() {
    for (final id in _subscriptions.keys) {
      _socket!.emit('incident:subscribe', id);
    }
  }
}
