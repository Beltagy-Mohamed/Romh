/// screens/cancel_pin_sheet.dart — الإلغاء: ضغط مطوّل + PIN (13.2).
import 'package:flutter/services.dart';
/// PIN الإلغاء يُلغي فعلًا؛ PIN الإكراه يظهر نفس الواجهة لكن البلاغ يستمر صامتًا (D-005: التحقق على الخادم).
import 'package:flutter/material.dart';
import '../theme/fazaa_theme.dart';
import '../services/api_client.dart';

Future<void> showCancelPinDialog(BuildContext context, String incidentId) {
  return showDialog(context: context, barrierDismissible: false,
    builder: (_) => _CancelPinDialog(incidentId: incidentId));
}

class _CancelPinDialog extends StatefulWidget {
  const _CancelPinDialog({required this.incidentId});
  final String incidentId;
  @override
  State<_CancelPinDialog> createState() => _CancelPinDialogState();
}

class _CancelPinDialogState extends State<_CancelPinDialog> {
  final _pin = TextEditingController();
  bool _checking = false;
  String? _error;

  Future<void> _submit() async {
    setState(() { _checking = true; _error = null; });
    HapticFeedback.vibrate(); // 10 ثواني ضغط مطوّل تحقق من شاشة البلاغ قبل هذه — 6.1
    try {
      final r = await ApiClient.instance.post('/incidents/${widget.incidentId}/cancel',
        body: {'pin': _pin.text.trim()});
      if (!mounted) return;
      final ok = r is Map && r['ok'] == true;
      final duress = r is Map && r['duress'] == true;
      // 13.2 — واجهة إلغاء Pine الإكراه مطابقة للتشكيل العادي (رسايل إيجابية إنكماسية)
      Navigator.of(context).pop(); // الحوار
      if (ok && !duress) Navigator.of(context).pop(); // شاشة البلاغ
      if (!ok) {
        setState(() { _checking = false; _error = 'الكود غير صحيح. حاول ثانية.'; });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() { _checking = false; _error = 'تعذر الاتصال، جرّب لاحقًا.'; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: FazaaTheme.nightSoft,
      title: const Text('إلغاء الفزعة'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        const Text('أدخل رقم الإلغاء لإنهاء النداء', style: TextStyle(color: Colors.white70)),
        const SizedBox(height: 12),
        TextField(controller: _pin, obscureText: true, keyboardType: TextInputType.number,
          maxLength: 8, autofocus: true,
          decoration: InputDecoration(counterText: '', errorText: _error)),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('تراجع')),
        FilledButton(onPressed: _checking ? null : _submit, child: const Text('تأكيد')),
      ],
    );
  }
}