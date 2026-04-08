import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Post-gathering results: focus time, distraction count, AI-generated
/// achievements, and the final plant/pet state.
class PostGatheringStatsScreen extends ConsumerWidget {
  const PostGatheringStatsScreen({required this.roomId, super.key});

  final String roomId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Results')),
      body: Center(
        child: Text(
          'PostGatheringStatsScreen\nRoom: $roomId',
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}
