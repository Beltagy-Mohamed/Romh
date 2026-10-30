/// screens/home_screen.dart — الشاشة الرئيسية (19-2):
/// زر الفزعة الكبير + أيقونة الطوارئ + مفتاح «متاح/غير متاح» + تدفّق الإرسال الفوري (D-003).
import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/fazaa_theme.dart';
import '../widgets/sos_button.dart';
import '../services/api_client.dart';
import '../services/geo_service.dart';
import 'emergency_sheet.dart';
import 'type_picker_sheet.dart';
import 'my_incident_screen.dart';
import 'receive_incident_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _available = true;
  String? _activeIncidentId;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _refreshActive();
    _poll = Timer.periodic(const Duration(seconds: 15), (_) => _refreshActive()); // 10.4 — polling احتياطي
  }
  @override
  void dispose() { _poll?.cancel(); super.dispose(); }

  Future<void> _refreshActive() async {
    try {
      final active = await ApiClient.instance.get('/incidents/active');
      if (!mounted) return;
      setState(() => _activeIncidentId = active == null ? null : (active['id'] as String?));
      // 10.4 — إذا وصله إشعار بلاغ غير بلاغي، تُفتح شاشة الاستلام
    } catch (_) {/* دون إنترنت — الشاشة تعمل دون شبكة (14.2) */}
  }

  /// 6 — الإرسال الفوري بنوع «unspecified» ثم شاشة اختيار النوع (D-003)
  Future<void> _triggerSos() async {
    try {
      final g = await GeoService.sampleForSos();
      final res = await ApiClient.instance.post('/incidents', body: {
        'lat': g.lat, 'lng': g.lng, 'accuracyM': g.accuracy, 'typeCode': 'unspecified',
      });
      final id = (res['id'] ?? res['existing']) as String;
      if (!mounted) return;
      NavigateId(context, MyIncidentScreen(incidentId: id));
      // بعد فتح شاشة البلاغ يظهر اختيار النوع (اختياري، بلا مؤقت)
      await showTypePicker(context, incidentId: id);
    } catch (e) {
      if (!mounted) return;
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const EmergencySheet(offline: true)));
    }
  }

  Future<void> _setAvailability(bool v) async {
    setState(() => _available = v);
    try {
      await ApiClient.instance.put('/me/availability',
        body: {'availability': v ? 'available' : 'unavailable'});
    } catch (_) { /* offline queue (14.2) — M2 */ }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: FazaaTheme.night,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(children: [
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              const Text('فَزْعة', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
              Row(children: [
                IconButton(
                  icon: const Icon(Icons.local_hospital, size: 30, color: FazaaTheme.sand),
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const EmergencySheet(offline: false))),
                ),
                // مفتاح «متاح/غير متاح» (19-2)
                Switch(value: _available, onChanged: _setAvailability,
                  activeColor: FazaaTheme.ember),
                Text(_available ? 'متاح' : 'غير متاح',
                  style: const TextStyle(fontSize: 15, color: FazaaTheme.sand)),
              ]),
            ]),
            const SizedBox(height: 26),
            if (_activeIncidentId != null)
              _ActiveIncidentBanner(incidentId: _activeIncidentId!)
            else
              Expanded(
                child: Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Text('الرِّبع يستسمعك', style: TextStyle(fontSize: 18, color: FazaaTheme.sand)),
                    const SizedBox(height: 18),
                    SizedBox(width: 260, child: SosButton(holdMs: 3000, onComplete: _triggerSos)),
                  ]),
                ),
              ),
            const SizedBox(height: 12),
            const Text('التطبيق وسيلة مساعدة اجتماعية ولا يحل محل الطوارئ الرسمية (122/123/180)',
              style: TextStyle(fontSize: 12, color: Colors.white54), textAlign: TextAlign.center),
            const SizedBox(height: 6),
          ]),
        ),
      ),
    );
  }
}

class _ActiveIncidentBanner extends StatelessWidget {
  const _ActiveIncidentBanner({required this.incidentId});
  final String incidentId;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: FazaaTheme.nightSoft,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ListTile(
        title: const Text('لديك بلاغ نشط حاليًا'),
        subtitle: Text('اضغط لعرض حالة الفزعة — #${incidentId.substring(0, 8)}'),
        leading: const Icon(Icons.emergency, color: FazaaTheme.ember),
        onTap: () => NavigateId(context, MyIncidentScreen(incidentId: incidentId)),
      ),
    );
  }
}

/// ملاحظة داخلية: أندرويد widget + اختصار شاشة القفل → إصدار 1.1 (6.1).
void NavigateId(BuildContext context, Widget screen) =>
  Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => screen));
