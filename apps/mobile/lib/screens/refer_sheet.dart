/// screens/refer_sheet.dart — «ما أقدر… وأنادي لك غيري» (10.1):
/// قائمة أعضاء البيت لاختيار من ننادي له — الحد 3 إحالات للبلاغ (يفحصه الخادم).
import 'package:flutter/material.dart';
import '../theme/fazaa_theme.dart';
import '../services/api_client.dart';

Future<void> showReferSheet(BuildContext context, {required void Function(String userId) onPicked}) {
  return showModalBottomSheet(
    context: context,
    backgroundColor: FazaaTheme.nightSoft,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (_) => _ReferSheet(onPicked: onPicked),
  );
}

class _ReferSheet extends StatefulWidget {
  const _ReferSheet({required this.onPicked});
  final void Function(String userId) onPicked;
  @override
  State<_ReferSheet> createState() => _ReferSheetState();
}

class _ReferSheetState extends State<_ReferSheet> {
  List<dynamic>? _housemates;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      final r = await ApiClient.instance.get('/house/mates');
      if (!mounted) return;
      setState(() => _housemates = r as List?);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(18),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('من تندّي له؟', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700), textAlign: TextAlign.center),
        const SizedBox(height: 8),
        const Text('ستصله الإحالة بأولوية الدائرة الأولى فورًا',
          style: TextStyle(color: Colors.white70), textAlign: TextAlign.center),
        const SizedBox(height: 12),
        if (_housemates == null)
          const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()))
        else
          ..._housemates!.take(30).map((m) => ListTile(
            title: Text((m['name'] as String?) ?? ''),
            subtitle: Text((m['area'] as String?) ?? ''),
            trailing: const Icon(Icons.call_made),
            onTap: () { widget.onPicked(m['id'] as String); Navigator.of(context).pop(); },
          )),
        if (_housemates != null && _housemates!.isEmpty)
          const Padding(padding: EdgeInsets.all(12), child: Text('لا يوجد أعضاء متاحون الآن — جرّب من قريبًا آخر',
            style: TextStyle(color: Colors.white54), textAlign: TextAlign.center)),
        const SizedBox(height: 10),
      ]),
    );
  }
}
