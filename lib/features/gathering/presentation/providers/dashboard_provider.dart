import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nearu/features/gathering/domain/gathering_state.dart';
import 'package:nearu/services/room_service.dart';

/// ViewModel for [DashboardScreen].
///
/// Listens to [RoomService.roomStream] and translates [RoomSnapshot] events
/// into [GatheringState] for the UI. Also owns the cognitive-buffer timer.
class DashboardNotifier extends AutoDisposeNotifier<GatheringState> {
  Timer? _bufferTimer;

  @override
  GatheringState build() {
    // `ref.watch` on roomServiceProvider so it can be swapped in tests.
    final roomService = ref.watch(roomServiceProvider);
    final roomId = ref.watch(_roomIdProvider);

    // Subscribe to live room updates.
    ref.listen(
      _roomStreamProvider(roomId),
      (_, next) {
        next.whenData((snapshot) {
          state = state.copyWith(
            participants: snapshot.participants,
            plantGrowthLevel: snapshot.plantGrowthLevel,
          );
        });
      },
    );

    ref.onDispose(() => _bufferTimer?.cancel());

    return GatheringState(
      roomId: roomId,
      participants: const [],
      plantGrowthLevel: 0.0,
      elapsedSeconds: 0,
    );
  }

  /// Opens the 30-second cognitive buffer countdown.
  void activateCognitiveBuffer() {
    if (state.isCognitiveBufferActive) return;
    state = state.copyWith(
      isCognitiveBufferActive: true,
      bufferSecondsRemaining: 30,
    );
    _bufferTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      final remaining = state.bufferSecondsRemaining - 1;
      if (remaining <= 0) {
        t.cancel();
        state = state.copyWith(
          isCognitiveBufferActive: false,
          bufferSecondsRemaining: 30,
        );
      } else {
        state = state.copyWith(bufferSecondsRemaining: remaining);
      }
    });
  }

  void dismissCognitiveBuffer() {
    _bufferTimer?.cancel();
    state = state.copyWith(
      isCognitiveBufferActive: false,
      bufferSecondsRemaining: 30,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helper providers (scoped to a roomId)
// ---------------------------------------------------------------------------

/// Provided externally by the route; see [DashboardScreen].
final _roomIdProvider = Provider<String>((_) => throw UnimplementedError());

final _roomStreamProvider =
    StreamProvider.autoDispose.family<RoomSnapshot, String>(
  (ref, roomId) => ref.watch(roomServiceProvider).roomStream(roomId),
);

/// Public entry point consumed by [DashboardScreen].
final dashboardProvider =
    AutoDisposeNotifierProvider<DashboardNotifier, GatheringState>(
  DashboardNotifier.new,
);
