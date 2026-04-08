import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Marketplace where users spend Focus Coins earned during gatherings
/// to unlock new seeds, pets, and accessories.
class FocusCoinStoreScreen extends ConsumerWidget {
  const FocusCoinStoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Focus Coin Store')),
      body: const Center(child: Text('FocusCoinStoreScreen')),
    );
  }
}
