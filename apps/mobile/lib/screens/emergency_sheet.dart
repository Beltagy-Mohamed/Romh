/// screens/emergency_sheet.dart — قسم الطوارئ (14.1):
/// أرقام تُجلب من الخادم + fallback محلي يعمل دون إنترنت، والاتصال بلمسة المستخدم فقط (tel:).
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../theme/fazaa_theme.dart';
import '../services/api_client.dart';
import '../services/geo_service.dart';

/// 14.1 — النسخة المحلية ضمن الحزمة (دون إنترنت) — تُراجع رسميًا قبل الإطلاق
const localEmergency = [
  {'label': 'النجدة', 'number': '122'},
  {'label': 'الإسعاف', 'number': '123'},
  {'label': 'المطافئ', 'number': '180'},
];

class EmergencySheet extends StatefulWidget {
  const EmergencySheet({super.key, required this.offline});
  final bool offline;
  @override
  State<EmergencySheet> createState() => _EmergencySheetState();
}

class _EmergencySheetState extends State<EmergencySheet> {
  List<Map<String, dynamic>> numbers = localEmergency.cast<Map<String, dynamic>>();

  @override
  void initState() {
    super.initState();
    if (!widget.offline) _load();
  }

  Future<void> _load() async {
    try {
      final r = await ApiClient.instance.get('/emergency-numbers') as List;
      if (r.isNotEmpty && mounted) setState(() => numbers = r.cast<Map<String, dynamic>>());
    } catch (_) {/* استخدم المحلية — 14.2 */}
  }

  /// mécanisme 14.1: ACTION_DIAL (لا ACTION_CALL) — الاتصال بلمسة المستخدم في تطبيق الاتصال
  Future<void> _dial(String number) async {
    final uri = Uri(scheme: 'tel', path: number);
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذر فتح تطبيق الاتصال')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: FazaaTheme.night,
      appBar: AppBar(
        backgroundColor: FazaaTheme.night,
        title: Text(widget.offline ? 'لا يوجد اتصال' : 'الطوارئ الرسمية'),
      ),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(18), children: [
          if (widget.offline) ...[
            const Text('أنت دون اتصال — لكن التطبيق يعمل ودون إنترنت:',
              style: TextStyle(color: Colors.white70)),
            const SizedBox(height: 10),
            Card(color: FazaaTheme.nightSoft, child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                const Text('رسالة SMS جاهزة: اسمك + إحداثياتك + رابط خرائط',
                  style: TextStyle(color: FazaaTheme.sand)),
                const SizedBox(height: 10),
                FilledButton.icon(
                  onPressed: _sendPreparedSms,
                  icon: const Icon(Icons.sms),
                  label: const Text('رسائل SMS جاهزة (لأقاربك وأدمن البيت)'), // يفتح مصراع الرسائل — 14.2
                ),
              ]),
            )),
            const SizedBox(height: 14),
          ],
          const Text('اتصل بالجهة الرسمية أولًا', style: TextStyle(
            fontSize: 17, fontWeight: FontWeight.w700, color: FazaaTheme.emberHot)),
          const SizedBox(height: 10),
          ...numbers.map((n) => Card(
            color: FazaaTheme.nightSoft,
            child: ListTile(
              leading: const Icon(Icons.local_phone, color: FazaaTheme.sand),
              title: Text(n['label'] as String),
              subtitle: Text(n['number'] as String, style: const TextStyle(fontSize: 20)),
              trailing: const Icon(Icons.call, color: FazaaTheme.ember),
              onTap: () => _dial(n['number'] as String),
            ),
          )),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: _copyCoords,
            icon: const Icon(Icons.copy),
            label: const Text('انسخ إحداثياتي (اقرأها لمشغّل الطوارئ)'),
          ),
          const SizedBox(height: 6),
          const Text('ملاحظة: التطبيق لا يتصل تلقائيًا — أنت من يضغط زر الاتصال',
            style: TextStyle(fontSize: 12, color: Colors.white54), textAlign: TextAlign.center),
        ]),
      ),
    );
  }

  Future<void> _copyCoords() async {
    try {
      final g = await GeoService.sampleForSos();
      final text = '${g.lat.toStringAsFixed(6)}, ${g.lng.toStringAsFixed(6)} '
          'https://maps.google.com/?q=${g.lat},${g.lng}';
      await Clipboard.setData(ClipboardData(text: text));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('نُسخت الإحداثيات — اقرأها لمشغّل الطوارئ')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('لا يوجد موقع متاح الآن')));
      }
    }
  }

  Future<void> _sendPreparedSms() async {
    // 14.2 — يفتح واجهة الرسائل برسالة معبأة (لا إرسال صامت): iOS قيود / سياسة Play
    try {
      final g = await GeoService.sampleForSos();
      final body = 'أحتاج الفزعة الآن — إحداثياتي: ${g.lat.toStringAsFixed(6)},${g.lng.toStringAsFixed(6)}'
          ' https://maps.google.com/?q=${g.lat},${g.lng}';
      final uri = Uri(scheme: 'sms', query: 'body=${Uri.encodeComponent(body)}');
      if (!await launchUrl(uri)) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('تعذر فتح الرسائل')));
        }
      }
    } catch (_) {/* 14.2 */}
  }
}
