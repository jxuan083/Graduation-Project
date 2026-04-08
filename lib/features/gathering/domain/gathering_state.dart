import 'package:nearu/services/room_service.dart';

/// Immutable state consumed by [DashboardScreen].
class GatheringState {
  const GatheringState({
    required this.roomId,
    required this.participants,
    required this.plantGrowthLevel,
    required this.elapsedSeconds,
    this.isCognitiveBufferActive = false,
    this.bufferSecondsRemaining = 30,
  });

  final String roomId;
  final List<ParticipantSnapshot> participants;

  /// 0.0 – 1.0 shared plant growth.
  final double plantGrowthLevel;

  final int elapsedSeconds;

  /// Whether the 30-second "emergency distraction" timer is running.
  final bool isCognitiveBufferActive;
  final int bufferSecondsRemaining;

  GatheringState copyWith({
    List<ParticipantSnapshot>? participants,
    double? plantGrowthLevel,
    int? elapsedSeconds,
    bool? isCognitiveBufferActive,
    int? bufferSecondsRemaining,
  }) {
    return GatheringState(
      roomId: roomId,
      participants: participants ?? this.participants,
      plantGrowthLevel: plantGrowthLevel ?? this.plantGrowthLevel,
      elapsedSeconds: elapsedSeconds ?? this.elapsedSeconds,
      isCognitiveBufferActive:
          isCognitiveBufferActive ?? this.isCognitiveBufferActive,
      bufferSecondsRemaining:
          bufferSecondsRemaining ?? this.bufferSecondsRemaining,
    );
  }
}
