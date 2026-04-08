import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
// TODO: restore when Firebase is configured.
// import 'package:nearu/core/providers/firebase_providers.dart';
import 'package:nearu/features/auth/presentation/screens/login_screen.dart';
import 'package:nearu/features/auth/presentation/screens/permissions_screen.dart';
import 'package:nearu/features/gathering/presentation/screens/dashboard_screen.dart';
import 'package:nearu/features/lobby/presentation/screens/gathering_radar_screen.dart';
import 'package:nearu/features/ritual/presentation/screens/synchronized_start_screen.dart';
import 'package:nearu/features/shop/presentation/screens/focus_coin_store_screen.dart';
import 'package:nearu/features/summary/presentation/screens/post_gathering_stats_screen.dart';

// ---------------------------------------------------------------------------
// Route names — use these constants for programmatic navigation.
// ---------------------------------------------------------------------------

abstract final class AppRoutes {
  static const login = '/login';
  static const permissions = '/permissions';
  static const lobby = '/lobby';
  static const ritual = '/ritual/:roomId';
  static const gathering = '/gathering/:roomId';
  static const summary = '/summary/:roomId';
  static const shop = '/shop';
}

// ---------------------------------------------------------------------------
// Router provider — Riverpod-aware so it can react to auth state.
// ---------------------------------------------------------------------------

final appRouterProvider = Provider<GoRouter>((ref) {
  // TODO: restore auth guard when Firebase is configured.
  // final authState = ref.watch(authStateProvider);

  return GoRouter(
    // Preview: start directly at lobby to browse all screens without auth.
    initialLocation: AppRoutes.lobby,
    debugLogDiagnostics: true,

    // ── Redirect logic (disabled for preview) ────────────────────────────
    // redirect: (context, state) {
    //   final isAuthenticated = authState.valueOrNull != null;
    //   final isOnAuthRoute = state.matchedLocation == AppRoutes.login ||
    //       state.matchedLocation == AppRoutes.permissions;
    //   if (!isAuthenticated && !isOnAuthRoute) return AppRoutes.login;
    //   if (isAuthenticated && isOnAuthRoute) return AppRoutes.lobby;
    //   return null;
    // },

    // ── Routes ────────────────────────────────────────────────────────────
    routes: [
      // Auth flow
      GoRoute(
        path: AppRoutes.login,
        name: 'login',
        builder: (_, __) => const LoginScreen(),
      ),
      GoRoute(
        path: AppRoutes.permissions,
        name: 'permissions',
        builder: (_, __) => const PermissionsScreen(),
      ),

      // Lobby / Radar
      GoRoute(
        path: AppRoutes.lobby,
        name: 'lobby',
        builder: (_, __) => const GatheringRadarScreen(),
      ),

      // Ritual — synchronized start
      GoRoute(
        path: AppRoutes.ritual,
        name: 'ritual',
        builder: (context, state) {
          final roomId = state.pathParameters['roomId']!;
          return SynchronizedStartScreen(roomId: roomId);
        },
      ),

      // Gathering dashboard  ← core screen
      GoRoute(
        path: AppRoutes.gathering,
        name: 'gathering',
        builder: (context, state) {
          final roomId = state.pathParameters['roomId']!;
          return DashboardScreen(roomId: roomId);
        },
      ),

      // Post-gathering summary
      GoRoute(
        path: AppRoutes.summary,
        name: 'summary',
        builder: (context, state) {
          final roomId = state.pathParameters['roomId']!;
          return PostGatheringStatsScreen(roomId: roomId);
        },
      ),

      // Shop
      GoRoute(
        path: AppRoutes.shop,
        name: 'shop',
        builder: (_, __) => const FocusCoinStoreScreen(),
      ),
    ],

    // ── Error page ────────────────────────────────────────────────────────
    errorBuilder: (context, state) => Scaffold(
      body: Center(child: Text('Route not found: ${state.error}')),
    ),
  );
});
