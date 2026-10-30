/// services/geo_service.dart — جمع الموقع بأعلى دقة + التقاط ثانٍ بعد 5 ثواني (6.2).
import 'package:geolocator/geolocator.dart';

class GeoSample {
  GeoSample(this.lat, this.lng, this.accuracy, {this.stale = false, this.capturedAt});
  final double lat;
  final double lng;
  final double accuracy;
  final bool stale;          // 6.3: علامة الموقع القديم
  final DateTime? capturedAt;
}

class GeoService {
  static Future<bool> ensurePermission() async {
    var granted = await Geolocator.checkPermission();
    if (granted == LocationPermission.denied) {
      granted = await Geolocator.requestPermission();
    }
    return granted == LocationPermission.whileInUse || granted == LocationPermission.always;
  }

  static Future<GeoSample> sampleForSos() async {
    Position p;
    try {
      p = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 6)),
      );
    } catch (_) {
      // 6.3 — لا GPS: آخر موقع معروف مع علامة stale
      final last = await Geolocator.getLastKnownPosition();
      if (last == null) throw StateError('no_position');
      return GeoSample(last.latitude, last.longitude, last.accuracy, stale: true, capturedAt: last.timestamp);
    }
    return GeoSample(p.latitude, p.longitude, p.accuracy, capturedAt: DateTime.now());
    // التقاط ثانٍ بعد 5 ثوى يُشغَّل من شاشة البلاغ لتحسين الدقة (6.2)
  }
}
