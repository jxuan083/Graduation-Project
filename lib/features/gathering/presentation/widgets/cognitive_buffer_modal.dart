import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nearu/features/gathering/presentation/providers/dashboard_provider.dart';

/// Bottom-sheet modal shown when the user taps the SOS button.
/// Runs a 30-second countdown ("cognitive buffer") before registering
/// the interruption — giving the user a chance to change their mind.
class CognitiveBufferModal extends ConsumerWidget {
  const CognitiveBufferModal({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet(
      context: context,
      isDismissible: false,
      builder: (_) => const CognitiveBufferModal(),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(dashboardProvider);
    final notifier = ref.read(dashboardProvider.notifier);
    final colorScheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Really need your phone?',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 16),
          // Countdown ring placeholder
          _CountdownRing(seconds: state.bufferSecondsRemaining),
          const SizedBox(height: 8),
          Text(
            '${state.bufferSecondsRemaining}s',
            style: Theme.of(context)
                .textTheme
                .displayMedium
                ?.copyWith(color: colorScheme.primary),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: notifier.dismissCognitiveBuffer,
            child: const Text("Nope, I'm back"),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: () {
              notifier.dismissCognitiveBuffer();
              Navigator.of(context).pop();
            },
            child: Text(
              'I really need it',
              style: TextStyle(color: colorScheme.error),
            ),
          ),
        ],
      ),
    );
  }
}

class _CountdownRing extends StatelessWidget {
  const _CountdownRing({required this.seconds});
  final int seconds;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 120,
      height: 120,
      child: CircularProgressIndicator(
        value: seconds / 30,
        strokeWidth: 8,
        backgroundColor: Theme.of(context).colorScheme.surfaceVariant,
      ),
    );
  }
}
