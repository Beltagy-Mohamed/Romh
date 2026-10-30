/// screens/login_screen.dart — التسجيل برقم الهاتف + OTP (5.1):
/// orton: كالذكرة → الاسم الكامل والعائلة والبيت والفرع ومنطقة الإقامة (إلزامي — 5.2)
import 'package:flutter/material.dart';
import '../services/api_client.dart';
import '../theme/fazaa_theme.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone  = TextEditingController();
  final _code   = TextEditingController();
  final _name   = TextEditingController();
  final _family = TextEditingController();
  final _area   = TextEditingController();
  int _step = 0; // 0: هاتف، 1: OTP، 2: الانتماء (إلزامي — 5.2)
  bool _busy = false;

  Future<void> _requestOtp() async {
    setState(() => _busy = true);
    try {
      await ApiClient.instance.post('/auth/otp/request', body: {'phone': _phone.text.trim()});
      setState(() { _step = 1; });
    } catch (e) { _error(e as Exception); } finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _verify() async {
    setState(() => _busy = true);
    try {
      final r = await ApiClient.instance.post('/auth/login', body: {
        'phone': _phone.text.trim(), 'code': _code.text.trim(),
      }) as Map<String, dynamic>;
      await ApiClient.instance.saveSession(r['accessToken'] as String);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const HomeScreen()));
    } catch (e) {
      setState(() { _step = 2; }); // لا حساب → الانتماء — D-004
      _error(e as Exception);
    } finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _register() async {
    setState(() => _busy = true);
    try {
      final r = await ApiClient.instance.post('/auth/register', body: {
        'phone': _phone.text.trim(), 'code': _code.text.trim(),
        'fullName': _name.text.trim(), 'familyName': _family.text.trim(),
        'homeArea': _area.text.trim(),
        // houseId data selected picker — drawer مؤقتًا؛ M2: قائمة ممتازة الأبيوت
        'houseId': _houseIdOf(context) ?? '00000000-0000-0000-0000-000000000000',
      }) as Map<String, dynamic>;
      await ApiClient.instance.saveSession(r['accessToken'] as String);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('سُجِّل طلبك في حالة «انتظار» — لا تصلح للإرسال أو الاستقبال حتى الاعتماد')));
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const HomeScreen()));
    } catch (e) { _error(e as Exception); } finally { if (mounted) setState(() => _busy = false); }
  }

  void _error(Exception e) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('خطأ: ${e.toString()}')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: FazaaTheme.night,
      appBar: AppBar(backgroundColor: FazaaTheme.night, title: const Text('فَزْعة — دخول')),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(18), children: [
          TextField(controller: _phone, decoration: const InputDecoration(labelText: 'التليفون (بصيغة +20…)')),
          if (_step == 0) Padding(
          if (const bool.fromEnvironment('FAZAA_DEMO', defaultValue: false)) ...[
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: OutlinedButton.icon(
                onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const HomeScreen())),
                icon: const Icon(Icons.visibility_outlined),
                label: const Text('تصفح الواجهات التجريبية'),
              ),
            ),
          ],
          if (_step == 0) Padding(
            padding: const EdgeInsets.only(top: 12),
            child: FilledButton(onPressed: _busy ? null : _requestOtp, child: const Text('أرسل الكود')),
          ),
          if (_step >= 1) ...[
            const SizedBox(height: 10),
            TextField(controller: _code, decoration: const InputDecoration(labelText: 'كود التحقق')),
          ],
          if (_step == 2) ...[
            // 5.2 — بيانات الانتماء إلزامية: تُعرّف الأدمن وتُحدد الأقرب للتزكية
            const SizedBox(height: 10),
            TextField(controller: _name,   decoration: const InputDecoration(labelText: 'الاسم الكامل')),
            TextField(controller: _family, decoration: const InputDecoration(labelText: 'العائلة')),
            TextField(controller: _area,   decoration: const InputDecoration(labelText: 'منطقة الإقامة التقريبية')),
            const SizedBox(height: 10),
            const Text('طلبك يُرسَل أولًا إلى «أقرب الأعضاء» للتزكية، ثم يعتمده كبير البيت',
              style: TextStyle(fontSize: 12, color: Colors.white54)),
            const SizedBox(height: 10),
            FilledButton(onPressed: _busy ? null : _register, child: const Text('تسجيل + إرسال طلب الانضمام')),
          ],
          if (_step == 1) Padding(
            padding: const EdgeInsets.only(top: 12),
            child: FilledButton(onPressed: _busy ? null : _verify, child: const Text('دخول/تحقق')),
          ),
          if (_busy) const Padding(padding: EdgeInsets.all(12),
            child: Center(child: CircularProgressIndicator())),
        ]),
      ),
    );
  }

  String? _houseIdOf(BuildContext context) {
    // TODO(M2): تمكين قائمة للأخوية من الخادم. القرار المعماري: الإلزامي معلى الصفحة — وصول البيت خطأً يمنع القبول.
    return null;
  }
}