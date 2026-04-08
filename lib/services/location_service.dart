import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Represents a lat/lng coordinate pair.
class LatLng {
  const LatLng({required this.latitude, required this.longitude});
  final double latitude;
  final double longitude;
}

/// Handles LBS location access and distance detection between users.
abstract class LocationService {
  /// Returns the device's current position once.
  Future<LatLng> getCurrentPosition();

  /// Streams continuous position updates.
  Stream<LatLng> positionStream();

  /// Calculates distance in metres between two coordinates.
  double distanceBetween(LatLng a, LatLng b);
}

// ---------------------------------------------------------------------------
// Mock implementation — replace with geolocator-backed class in production.
// ---------------------------------------------------------------------------

class MockLocationService implements LocationService {
  @override
  Future<LatLng> getCurrentPosition() async =>
      const LatLng(latitude: 25.0330, longitude: 121.5654);

  @override
  Stream<LatLng> positionStream() => Stream.periodic(
        const Duration(seconds: 5),
        (_) => const LatLng(latitude: 25.0330, longitude: 121.5654),
      );

  @override
  double distanceBetween(LatLng a, LatLng b) => 0.0;
}

final locationServiceProvider = Provider<LocationService>(
  (_) => MockLocationService(),
);
