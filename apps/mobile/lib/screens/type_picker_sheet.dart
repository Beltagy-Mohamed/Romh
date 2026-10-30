/// screens/type_picker_sheet.dart — اختيار النوع والوصف بعد الإرسال (6.2):
/// شبكة أيقونات كبيرة بهوية بدوية + زر «تخطي» — لا مؤقت ولا إجبار.
import 'package:flutter/material.dart';
import '../theme/fazaa_theme.dart';
import '../services/api_client.dart';

const incidentTypes = <String, (String, IconData)>{
  'vehicle_stuck':    ('سيارة غرزت', Icons.directions_car),
  'no_transport':     ('ما عنده مواصلة', Icons.directions_bus),
  'medical':          ('مرض أو إسعاف', Icons.medical_services),
  'accident':         ('حادث', Icons.car_crash),
  'lost_desert':      ('ضياع في الصحراء', Icons.landscape),
  'urgent_financial': ('مشكلة مالية عاجلة', Icons.shield),
  'dispute':          ('خلاف يلزم إصلاحًا', Icons.handshake),
  'unspecified':      ('غير محدد', Icons.help_outline),
};

Future<void> showTypePicker(BuildContext context, {required String incidentId}) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: FazaaTheme.nightSoft,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (_) => _TypePickerSheet(incidentId: incidentId),
  );
}

class _TypePickerSheet extends StatefulWidget {
  const _TypePickerSheet({required this.incidentId});
  final String incidentId;
  @override
  State<_TypePickerSheet> createState() => _TypePickerSheetState();
}

class _TypePickerSheetState extends State<_TypePickerSheet> {
  String? _type;
  final _desc = TextEditingController();
  bool _lifeRisk = false;

  Future<void> _submit({bool skip = false}) async {
    try {
      await ApiClient.instance.put('/incidents/${widget.incidentId}', body: skip
        ? {}
        : {
            if (_type != null && _type != 'unspecified') 'typeCode': _type,
            if (_desc.text.trim().isNotEmpty) 'description': _desc.text.trim(),
            if (_lifeRisk) 'lifeRisk': true,
          });
    } catch (_) { /* تحديث صامت لاحقًا — النداء أصلًا وصل (6.2) */ }
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('ما الخَلَق؟ (اختياري — النداء وصَلَ)',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700), textAlign: TextAlign.center),
        const SizedBox(height: 8),
        const Text('يمكنك تركه الآن، أو الاختيار ليُوجَّه البلاغ لأنسب الرِّبع',
          style: TextStyle(color: Colors.white70), textAlign: TextAlign.center),
        const SizedBox(height: 18),
        Wrap(
          spacing: 10, runSpacing: 10,
          children: incidentTypes.entries
            .where((e) => e.key != 'unspecified')
            .map((e) => ChoiceChip(
              label: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(e.value.$2, size: 18),
                const SizedBox(width: 6),
                Text(e.value.$1),
              ]),
              selected: _type == e.key,
              selectedColor: FazaaTheme.ember,
              onSelected: (_) => setState(() => _type = e.key),
            )).toList(),
        ),
        const SizedBox(height: 14),
        TextField(controller: _desc, maxLines: 2,
          decoration: const InputDecoration(hintText: 'وصف قصير (اختياري)…')),
        CheckboxListTile(
          value: _lifeRisk, onChanged: (v) => setState(() => _lifeRisk = v ?? false),
          title: const Text('يوجد خطر على الحياة أو عنف', style: TextStyle(color: FazaaTheme.emberHot)),
          subtitle: const Text('يجعل البلاغ عاجلًا فورًا ويُظهِر أرقام الطوارئ', style: TextStyle(fontSize: 12)),
        ),
        const SizedBox(height: 8),
        FilledButton(onPressed: _submit, child: const Text('تم')),
        TextButton(onPressed: () => _submit(skip: true), child: const Text('تخطي')),
        const SizedBox(height: 12),
      ]),
    );
  }
}
