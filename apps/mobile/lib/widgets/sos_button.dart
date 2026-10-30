/// widgets/sos_button.dart — زر الفزعة (6.1): ضغط مطوّل 3 ثوانٍ + دائرة تقدم + اهتزاز.
/// الضوابط: إرسال فوري عند اكتمال الدائرة، وإطلاقة الإصبع قبل الاكتمال تلغي أيًا كان.
import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/fazaa_theme.dart';

class SosButton extends StatefulWidget {
  const SosButton({super.key, required this.holdMs, required this.onComplete});
  final int holdMs;
  final VoidCallback onComplete;

  @override
  State<SosButton> createState() => _SosButtonState();
}

class _SosButtonState extends State<SosButton> with SingleTickerProviderStateMixin {
  Timer? _timer;
  double _progress = 0;
  bool _armed = false;

  @override
  void dispose() { _timer?.cancel(); super.dispose(); }

  void _start() {
    setState(() => _armed = true);
    HapticFeedback.mediumImpact();
    const tick = 50;
    _timer = Timer.periodic(const Duration(milliseconds: tick), (t) async {
      setState(() => _progress += tick / widget.holdMs);
      if (_progress >= 1) {
        t.cancel();
        HapticFeedback.heavyImpact(); // اهتزاز الاكتمال (6.1)
        widget.onComplete();
        if (mounted) setState(() { _progress = 0; _armed = false; });
      } else if (_progress > 0.5) {
        HapticFeedback.selectionClick();
      }
    });
  }

  void _cancel() {
    _timer?.cancel();
    if (mounted) setState(() { _progress = 0; _armed = false; });
    // لا إرسال — قاعدة 6.1 الحاسمة
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onLongPressStart: (_) => _start(),
      onLongPressEnd: (_) => _cancel(),
      onLongPressCancel: _cancel,
      child: AspectRatio(
        aspectRatio: 1,
        child: CustomPaint(
          painter: _SosRing(progress: _progress),
          child: Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const Text('فَزْعة', style: TextStyle(
                fontSize: 44, fontWeight: FontWeight.w800, color: FazaaTheme.emberHot)),
              const SizedBox(height: 4),
              Text(_armed ? 'لا ترفع إصبعك…' : 'اضغط مطوّلًا 3 ثوانٍ',
                style: const TextStyle(fontSize: 15, color: FazaaTheme.sand)),
            ]),
          ),
        ),
      ),
    );
  }
}

class _SosRing extends CustomPainter {
  _SosRing({required this.progress});
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2 - 8;
    // حلقة قاعدة
    canvas.drawCircle(center, radius - 10,
      Paint()..style = PaintingStyle.stroke..strokeWidth = 6..color = FazaaTheme.sandDeep.withOpacity(0.35));
    // دائرة تقدم
    if (progress > 0) {
      canvas.drawArc(Rect.fromCircle(center: center, radius: radius - 10), -math.pi / 2,
        2 * math.pi * progress, false,
        Paint()..style = PaintingStyle.stroke..strokeWidth = 9..strokeCap = StrokeCap.round..color = FazaaTheme.ember);
    }
    // زخرفة مشبك الصحة (مؤقتة — أيقونات SVG في M2)
    canvas.drawCircle(center, radius,
      Paint()..style = PaintingStyle.stroke..strokeWidth = 3..color = FazaaTheme.ember.withOpacity(0.6));
  }

  @override
  bool shouldRepaint(covariant _SosRing old) => old.progress != progress;
}
