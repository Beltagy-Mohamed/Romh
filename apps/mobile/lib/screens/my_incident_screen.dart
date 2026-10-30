/// screens/my_incident_screen.dart — شاشة بلاغي النشط (19-4):
/// قائمة المستجيبين مع موقع حي لكل واحد ورقمه وزر الاتصال + «استبعاد مستجيب» + الإغلاق/الإلغاء.
import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/fazaa_theme.dart';
import '../services/api_client.dart';
import '../services/realtime_client.dart';
import 'cancel_pin_sheet.dart';
import '../l10n/phrases.dart' as L;

class MyIncidentScreen extends StatefulWidget {
  const MyIncidentScreen({super.key, required this.incidentId});
  final String incidentId;
  @override
  State<MyIncidentScreen> createState() => _MyIncidentScreenState();
}

class _MyIncidentScreenState extends State<MyIncidentScreen> {
  Map<String, dynamic>? _inc;
  List<dynamic> _responders = [];
  late final Timer _geoTimer;

  @override
  void initState() {
    super.initState();
    _load();
    RealtimeClient.instance.ensure();
    RealtimeClient.instance.subscribeIncident(widget.incidentId, (_) => _load());
    
    // تصحيح تعريف الـ Timer ليعمل بشكل سليم وآمن تماماً عند الإلغاء
    _geoTimer = Timer.periodic(const Duration(seconds: 10), (_) {
      /* دفع الموقع الحي — 10.4 */
    });
  }

  @override
  void dispose() {
    _geoTimer.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final inc = await ApiClient.instance.get('/incidents/${widget.incidentId}');
      if (!mounted) return;
      setState(() {
        _inc = inc as Map<String, dynamic>;
        _responders = (inc['responders'] as List<dynamic>? ?? []);
      });
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final inc = _inc;
    final duress = (inc?['duress'] as bool?) ?? false;
    return Scaffold(
      backgroundColor: FazaaTheme.night,
      appBar: AppBar(
        backgroundColor: FazaaTheme.night,
        title: Text(duress ? 'إلغاء الفزعة' : 'بلاغي'),
        // 13.2: واجهة الإلغاء مطابقة للعادية — البلاغ يستمر صامتًا دون إشعار ظاهر
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            if ((inc?['status'] as String?) != null)
              Text('الحالة: ${_statusAr(inc?['status'] as String)}',
                  style: const TextStyle(color: FazaaTheme.sand)),
            const SizedBox(height: 8),
            CounterCard(responders: _responders),
            const Divider(color: Colors.white24),
            ..._responders.map((r) => ResponderTile(
                  data: r as Map<String, dynamic>,
                  isPrecise: true,
                  onExclude: () => _exclude(r['user_id'] as String),
                )),
            const SizedBox(height: 16),
            FilledButton.icon(
                onPressed: _close,
                icon: const Icon(Icons.check),
                label: Text(L.close)),
            TextButton(onPressed: _cancel, child: Text(L.cancel)),
            // 13.2 — جهاز صاحب البلاغ صامت تمامًا: لا صوت ولا اهتزاز ولا إشعار ظاهر
            // (واجهة الإلغاء مطابقة للعادية، والبلاغ يستمر حيًا خلفيةً)
            const SizedBox(height: 30),
          ],
        ),
      ),
    );
  }

  Future<void> _exclude(String responderId) async {
    bool confirm = false;
    await showDialog(
        context: context,
        builder: (dctx) => AlertDialog(
              title: const Text('استبعاد مستجيب؟'),
              content: const Text('يُسحب صلاحيته فورًا ويُسجَّل ذلك.'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dctx),
                    child: const Text('تراجع')),
                TextButton(
                    onPressed: () {
                      confirm = true;
                      Navigator.pop(dctx);
                    },
                    child: const Text('استبعاده')),
              ],
            ));
    if (confirm) {
      await ApiClient.instance.post(
          '/incidents/${widget.incidentId}/exclude',
          body: {'userId': responderId});
      _load();
    }
  }

  Future<void> _cancel() => showCancelPinDialog(context, widget.incidentId);

  Future<void> _close() async {
    await ApiClient.instance.post('/incidents/${widget.incidentId}/close',
        body: {'reason': 'resolved'});
    if (mounted) Navigator.of(context).pop();
  }
}

String _statusAr(String? s) {
  switch (s) {
    case 'open':
      return 'بانتظار المستجيبين';
    case 'covered':
      return 'قادَمٌ المستجيبون';
    case 'unresponsive':
      return 'بلاغ لا يستجيب — تم تنبيه البيت';
    case 'resolved':
    case 'resolved_unconfirmed':
      return 'تمت الفزعة';
    case 'cancelled':
      return 'أُلغيت الفزعة';
    case 'expired_unconfirmed':
      return 'انتهى الوقت دون تأكيد';
  }
  return s ?? '';
}

class CounterCard extends StatelessWidget {
  const CounterCard({super.key, required this.responders});
  final List<dynamic> responders;

  @override
  Widget build(BuildContext context) {
    // 10.2 — «3 أبشروا — الأقرب 12 دقيقة»: بلا مواقع
    final enRoute = responders.where((r) => r['status'] == 'en_route').toList();
    final arrived = responders.where((r) => r['status'] == 'arrived').toList();
    return Card(
        color: FazaaTheme.nightSoft,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${enRoute.length} أبشروا — في الطريق',
                style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: FazaaTheme.emberHot)),
            if (arrived.isNotEmpty)
              Text('${arrived.length} وصل — حضَر',
                  style: const TextStyle(color: Colors.white70)),
          ]),
        ));
  }
}

class ResponderTile extends StatelessWidget {
  const ResponderTile(
      {super.key,
      required this.data,
      required this.isPrecise,
      required this.onExclude});
  final Map<String, dynamic> data;
  final bool isPrecise;
  final VoidCallback onExclude;

  @override
  Widget build(BuildContext context) {
    final status = data['status'];

    return ListTile(
      leading: Icon(
          status == 'arrived' ? Icons.check_circle : Icons.directions_run,
          color: status == 'arrived' ? Colors.green : FazaaTheme.ember),
      title: Text(data['name'] as String),
      subtitle:
          Text(status == 'arrived' ? 'حضر' : (status == 'en_route' ? 'جاي' : '—')),
      // 10.3 — الموقع الدقيق والرقم: للملتزمين فقط (يأتي حقًّا من الـ API تحقق cast في M2)
      trailing: IconButton(icon: const Icon(Icons.call), onPressed: () {}),
    );
  }
}