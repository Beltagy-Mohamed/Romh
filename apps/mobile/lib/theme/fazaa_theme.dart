/// fazaa_theme.dart — الهوية البدوية (القسم 22): رمل، أسود الليل، لون الجمر.
import 'package:flutter/material.dart';

class FazaaTheme {
  // الألوان من الهوية
  static const sand      = Color(0xFFD9C3A0); // رمال
  static const sandDeep  = Color(0xFFB8946A);
  static const night     = Color(0xFF12100C); // أسود الليل
  static const nightSoft = Color(0xFF1E1913);
  static const ember     = Color(0xFFD46A2E); // لون الجمر — زر الفزعة والحالات الحرجة
  static const emberHot  = Color(0xFFE8813A);
  static const desertInk = Color(0xFFF3EADA); // نص فاتح على الليل

  static ThemeData theme() {
    final base = ThemeData.dark(useMaterial3: true);
    return base.copyWith(
      scaffoldBackgroundColor: night,
      colorScheme: base.colorScheme.copyWith(
        primary: ember,
        secondary: sandDeep,
        surface: nightSoft,
        onSurface: desertInk,
        error: const Color(0xFFC2412A),
      ),
      textTheme: base.textTheme.apply(bodyColor: desertInk, displayColor: desertInk),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: ember,
          foregroundColor: night,
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 22),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: nightSoft,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    );
  }
}
