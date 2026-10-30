/// screens/receive_incident_screen.dart — شاشة الاستلام قبل الالتزام (19-5):
/// منطقة تقريبية فقط (نصف قطر 2 كم حول نقطة مزاحة — 11) + ثلاثة أزرار + عدّاد.
import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/fazaa_theme.dart';
import '../services/api_client.dart';
import '../services/realtime_client.dart';
import '../l10n/phrases.dart' as L;
import 'refer_sheet.dart';

class ReceiveIncidentScreen extends StatefulWidget {
  const ReceiveIncidentScreen({super.key, required this.incidentId});
  final String incidentId;
  @override
  State<ReceiveIncidentScreen> createState() => _ReceiveIncidentScreenState();
}

class _ReceiveIncidentScreenState extends State<ReceiveIncidentScreen> {
  Map<String, dynamic>? _inc;
  List<dynamic>? _responders;
  Timer? _poll;

  // 9.3 — ack فوري: الخادم يُسجّل التسليم ويستبدل SMS دون تحميل مرايا
  @override
  void initState() { _load(); super.initState();
    _ack();
    RealtimeClient.instance.onUpdate = (id) { if (id == widget.incidentId) _load(); };
    _poll = Timer.periodic(const Duration(seconds: 15), (_) => _load());
  }
  @override
  void dispose() { _poll?.cancel(); RealtimeClient.instance.onUpdate = null; super.dispose(); }

  Future<void> _ack() async { try { await ApiClient.instance.post('/incidents/${widget.incidentId}/ack', body: {'ring': 1}); } catch (_) {} }

  Future<void> _load() async {
    try {
      final inc = await ApiClient.instance.get('/incidents/${widget.incidentId}');
      if (!mounted) return;
      setState(() { _inc = inc as Map<String, dynamic>; _responders = inc['responders'] as List?; });
      final status = (inc['status'] as String?);
      // 11 — إن ضغط «أبشر» يجب الانتقال لشاشة المستجيب (الموقع الدقيق يُرى بعد الالتزام فقط)
      if (status == 'closed' || status == 'cancelled') {
        if (mounted) Navigator.of(context).pop();
      }
    } catch (_) {}
  }

  Future<void> _respond(String response, {String? referredToUserId}) async {
    await ApiClient.instance.post('/incidents/${widget.incidentId}/respond', body: {
      'response': response,
      if (referredToUserId != null) 'referredToUserId': referredToUserId,
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final inc = _inc;
    final radius = ((inc?['approx_radius_m'] as num? ?? 2000) / 1000).toStringAsFixed(1);
    return Scaffold(
      backgroundColor: FazaaTheme.night,
      appBar: AppBar(backgroundColor: FazaaTheme.night, title: Text(L.appTitle)),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(18), children: [
          Text('${inc?['requester_name'] ?? 'عضو'} يطلب الفزعة',
            style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: FazaaTheme.emberHot)),
          const SizedBox(height: 6),
          Text('منطقة تقريبية فقط — ضمن نطاق $radius كم من موقعك',
            style: const TextStyle(color: Colors.white70)), // 11 — قبل الالتزام: لا موقع دقيق ولا هاتف
          const SizedBox(height: 14),
          Card(color: FazaaTheme.nightSoft, child: Padding(
            padding: const EdgeInsets.all(16),
            child: Text(inc?['description'] as String? ?? '', style: const TextStyle(fontSize: 16)),
          )),
          const SizedBox(height: 8),
          _MiniCounter(responders: _responders ?? []),
          const SizedBox(height: 18),
          // الأزرار الثلاثة (10.1)
          FilledButton.icon(
            onPressed: () => _respond('coming'),
            icon: const Icon(Icons.directions_run), label: const Text(L.coming)),
          OutlinedButton.icon(
            onPressed: () => showReferSheet(context, onPicked: (uid) => _respond('referred', referredToUserId: uid)),
            icon: const Icon(Icons.people_alt), label: const Text(L.refer)),
          OutlinedButton.icon(
            onPressed: () => _respond('cannot'),
            icon: const Icon(Icons.close), label: const Text(L.cannot)),
          const SizedBox(height: 14),
          const Text('الطوارئ الرسمية بالنسبة للبلاغ: 122 نجدة · 123 إسعاف · 180 مطافئ',
            style: TextStyle(fontSize: 12, color: Colors.white38), textAlign: TextAlign.center),
        ]),
      ),
    );
  }
}

class _MiniCounter extends StatelessWidget {
  const _MiniCounter({required this.responders});
  final List<dynamic> responders;

  @override
  Widget build(BuildContext context) {
    final coming = responders.where((r) => r['status'] == 'en_route' || r['status'] == 'arrived').toList();
    return Text('${coming.length} أبشروا',
      style: const TextStyle(fontSize: 18, color: FazaaTheme.sand));
  }
}
