import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nearu/features/gathering/presentation/providers/dashboard_provider.dart';
import 'package:nearu/features/gathering/presentation/widgets/cognitive_buffer_modal.dart';

/// The core screen of NearU.
///
/// Layout regions:
/// ┌─────────────────────────────┐
/// │  AppBar  (timer + avatars)  │
/// ├─────────────────────────────┤
/// │                             │
/// │   Shared Plant / Pet        │  ← grows when all users are focused
/// │                             │
/// ├─────────────────────────────┤
/// │   Participant Status Row    │  ← face-down icons per user
/// ├─────────────────────────────┤
/// │   SOS / Cognitive Buffer    │  ← opens [CognitiveBufferModal]
/// └─────────────────────────────┘
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({required this.roomId, super.key});

  final String roomId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Override the internal _roomIdProvider scoped to this widget tree.
    return ProviderScope(
      overrides: [
        // ignore: invalid_use_of_internal_member
        _roomIdProvider.overrideWithValue(roomId),
      ],
      child: const _DashboardView(),
    );
  }
}

class _DashboardView extends ConsumerWidget {
  const _DashboardView();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(dashboardProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      // ── AppBar ──────────────────────────────────────────────────────────
      appBar: AppBar(
        title: _ElapsedTimer(seconds: state.elapsedSeconds),
        centerTitle: true,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: _ParticipantAvatarRow(
              participants: state.participants,
            ),
          ),
        ],
      ),

      // ── Body ────────────────────────────────────────────────────────────
      body: SafeArea(
        child: Column(
          children: [
            // Plant / Pet area
            Expanded(
              flex: 5,
              child: _PlantWidget(growthLevel: state.plantGrowthLevel),
            ),

            // Participant status row
            _ParticipantStatusRow(participants: state.participants),
            const SizedBox(height: 24),

            // SOS button
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: _SosButton(
                onTap: () {
                  ref
                      .read(dashboardProvider.notifier)
                      .activateCognitiveBuffer();
                  CognitiveBufferModal.show(context);
                },
              ),
            ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}

// ── Sub-widgets ──────────────────────────────────────────────────────────────

class _ElapsedTimer extends StatelessWidget {
  const _ElapsedTimer({required this.seconds});
  final int seconds;

  String get _label {
    final m = (seconds ~/ 60).toString().padLeft(2, '0');
    final s = (seconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    return Text(_label, style: Theme.of(context).textTheme.titleLarge);
  }
}

class _ParticipantAvatarRow extends StatelessWidget {
  const _ParticipantAvatarRow({required this.participants});
  final List participants;

  @override
  Widget build(BuildContext context) {
    if (participants.isEmpty) {
      return const SizedBox(width: 40, height: 40);
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(
        participants.length.clamp(0, 4),
        (i) => Padding(
          padding: const EdgeInsets.only(left: 4),
          child: CircleAvatar(
            radius: 16,
            child: Text(
              participants[i].displayName.substring(0, 1).toUpperCase(),
            ),
          ),
        ),
      ),
    );
  }
}

class _PlantWidget extends StatelessWidget {
  const _PlantWidget({required this.growthLevel});
  final double growthLevel;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // TODO: replace with Lottie animation keyed to growthLevel
          Icon(
            Icons.eco_rounded,
            size: 120,
            color: Color.lerp(
              Colors.brown.shade300,
              Colors.green.shade600,
              growthLevel,
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: 200,
            child: LinearProgressIndicator(
              value: growthLevel,
              minHeight: 8,
              borderRadius: BorderRadius.circular(4),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '${(growthLevel * 100).toStringAsFixed(0)}% focused',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _ParticipantStatusRow extends StatelessWidget {
  const _ParticipantStatusRow({required this.participants});
  final List participants;

  @override
  Widget build(BuildContext context) {
    if (participants.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Text('Waiting for participants…'),
      );
    }
    return SizedBox(
      height: 72,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 24),
        itemCount: participants.length,
        separatorBuilder: (_, __) => const SizedBox(width: 16),
        itemBuilder: (context, i) {
          final p = participants[i];
          return Column(
            children: [
              Icon(
                Icons.phone_android_rounded,
                color: p.status.name == 'focused'
                    ? Colors.green
                    : Colors.red.shade300,
              ),
              const SizedBox(height: 4),
              Text(p.displayName, style: Theme.of(context).textTheme.labelSmall),
            ],
          );
        },
      ),
    );
  }
}

class _SosButton extends StatelessWidget {
  const _SosButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: onTap,
      icon: const Icon(Icons.notifications_active_outlined),
      label: const Text('I need my phone'),
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        foregroundColor: Theme.of(context).colorScheme.error,
        side: BorderSide(color: Theme.of(context).colorScheme.error),
      ),
    );
  }
}

// Re-export the internal provider so [DashboardScreen] can override it.
// ignore: library_private_types_in_public_api
final _roomIdProvider = Provider<String>((_) => throw UnimplementedError());
