import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Monitors hardware sensors to determine device orientation.
///
/// Primary use-case: detect "face-down" (screen facing the table) which
/// signals that the user is not using their phone during a gathering.
abstract class SensorService {
  /// Emits `true` when the device screen is facing downward.
  Stream<bool> isFaceDown();

  /// Emits raw accelerometer readings (x, y, z) in m/s².
  Stream<List<double>> accelerometerStream();

  /// Emits raw gyroscope readings (x, y, z) in rad/s.
  Stream<List<double>> gyroscopeStream();

  void dispose();
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

class MockSensorService implements SensorService {
  @override
  Stream<bool> isFaceDown() => const Stream.empty();

  @override
  Stream<List<double>> accelerometerStream() => const Stream.empty();

  @override
  Stream<List<double>> gyroscopeStream() => const Stream.empty();

  @override
  void dispose() {}
}

final sensorServiceProvider = Provider<SensorService>(
  (_) => MockSensorService(),
);
