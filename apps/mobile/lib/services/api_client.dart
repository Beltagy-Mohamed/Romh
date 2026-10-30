/// services/api_client.dart — عميل REST فوق الخادم (NestJS).
/// القاعدة: كل نداء يمر عبر هذا الملف ليختبر رمز الجلسة والجهاز (17).
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();
  static const baseUrl = String.fromEnvironment('FAZAA_API',
      defaultValue: 'http://10.0.2.2:3000'); // محاكي أندرويد ← localhost

  String? _token;
  String? get token => _token;

  Future<void> loadSession() async {
    final sp = await SharedPreferences.getInstance();
    _token = sp.getString('access_token');
  }

  Future<void> saveSession(String accessToken) async {
    final sp = await SharedPreferences.getInstance();
    await sp.setString('access_token', accessToken);
    _token = accessToken;
  }

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  Future<dynamic> get(String path) async {
    final r = await http.get(Uri.parse('$baseUrl/api/v1$path'), headers: _headers);
    return _decode(r);
  }

  Future<dynamic> post(String path, {Object? body}) async {
    final r = await http.post(Uri.parse('$baseUrl/api/v1$path'), headers: _headers, body: jsonEncode(body ?? {}));
    return _decode(r);
  }

  Future<dynamic> put(String path, {Object? body}) async {
    final r = await http.put(Uri.parse('$baseUrl/api/v1$path'), headers: _headers, body: jsonEncode(body ?? {}));
    return _decode(r);
  }

  dynamic _decode(http.Response r) {
    dynamic data;
    try { data = jsonDecode(r.body); } catch (_) { data = r.body; }
    if (r.statusCode >= 400) throw ApiError(r.statusCode, data is Map ? (data['message'] ?? data) : r.body);
    return data;
  }
}

class ApiError implements Exception {
  ApiError(this.status, this.message);
  final int status;
  final String message;
  @override
  String toString() => 'ApiError($status): $message';
}
