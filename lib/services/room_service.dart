import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Describes the focus state of a single participant.
enum ParticipantStatus { focused, distracted, offline }

/// Snapshot of one participant inside a room.
class ParticipantSnapshot {
  const ParticipantSnapshot({
    required this.uid,
    required this.displayName,
    required this.status,
    required this.distractionCount,
  });

  final String uid;
  final String displayName;
  final ParticipantStatus status;
  final int distractionCount;
}

/// Snapshot of the shared room state synced via Firestore.
class RoomSnapshot {
  const RoomSnapshot({
    required this.roomId,
    required this.participants,
    required this.plantGrowthLevel,
    required this.startedAt,
  });

  final String roomId;
  final List<ParticipantSnapshot> participants;

  /// 0.0 – 1.0, increases as everyone stays focused.
  final double plantGrowthLevel;
  final DateTime startedAt;
}

/// Handles real-time multi-user state sync for a single gathering room.
abstract class RoomService {
  /// Creates a new room and returns its ID.
  Future<String> createRoom({required String hostUid});

  /// Joins an existing room.
  Future<void> joinRoom({required String roomId, required String uid});

  /// Streams live room snapshots for [roomId].
  Stream<RoomSnapshot> roomStream(String roomId);

  /// Updates the caller's [ParticipantStatus] in Firestore.
  Future<void> updateStatus({
    required String roomId,
    required String uid,
    required ParticipantStatus status,
  });

  /// Closes the room and persists the final summary.
  Future<void> endRoom(String roomId);
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

class MockRoomService implements RoomService {
  @override
  Future<String> createRoom({required String hostUid}) async => 'mock-room-id';

  @override
  Future<void> joinRoom({required String roomId, required String uid}) async {}

  @override
  Stream<RoomSnapshot> roomStream(String roomId) => Stream.value(
        RoomSnapshot(
          roomId: roomId,
          participants: const [],
          plantGrowthLevel: 0.0,
          startedAt: DateTime.now(),
        ),
      );

  @override
  Future<void> updateStatus({
    required String roomId,
    required String uid,
    required ParticipantStatus status,
  }) async {}

  @override
  Future<void> endRoom(String roomId) async {}
}

final roomServiceProvider = Provider<RoomService>(
  (_) => MockRoomService(),
);
