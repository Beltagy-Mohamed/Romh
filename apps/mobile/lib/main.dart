/// main.dart — نقلة الدخول: AuthGate → التسجيل (OTP) أو الرئيسية. RTL أساسًا (16).
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'services/api_client.dart';
import 'theme/fazaa_theme.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ApiClient.instance.loadSession();

  runApp(const FazaaApp());
}

class FazaaApp extends StatelessWidget {
  const FazaaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'فَزْعة',
      debugShowCheckedModeBanner: false,
      theme: FazaaTheme.theme(),
      locale: const Locale('ar'),           // واجهة عربية RTL أساسًا (16)
      supportedLocales: const [Locale('ar')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      builder: (context, child) => Directionality(
        textDirection: TextDirection.rtl,
        child: child ?? const SizedBox.shrink(),
      ),
      home: ApiClient.instance.token == null ? const LoginScreen() : const HomeScreen(),
    );
  }
}
