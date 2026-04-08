import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Waiting room that requires ALL participants to perform the swipe-unlock
/// gesture simultaneously before the gathering session begins.
class SynchronizedStartScreen extends ConsumerWidget {
  const SynchronizedStartScreen({required this.roomId, super.key});

  final String roomId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Text(
            'SynchronizedStartScreen\nRoom: $roomId',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineMedium,
          ),
        ),
      ),
    );
  }
}
