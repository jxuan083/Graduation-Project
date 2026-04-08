import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Radar view that discovers nearby friends via location/BLE and lets the
/// user create or join a gathering room.
class GatheringRadarScreen extends ConsumerWidget {
  const GatheringRadarScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Nearby')),
      body: const Center(child: Text('GatheringRadarScreen')),
    );
  }
}
