import { useEffect, useRef } from 'react';
import { Stack, router, useSegments } from 'expo-router';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuthSession, landingRouteFor } from '../hooks/useAuthSession';

/**
 * Root layout: the auth gate, and the one place that decides where a
 * signed-in person lands.
 *
 * Both roles share `/auth/login`. What differs is the destination:
 * vendors go to the vendor dashboard, everyone else to the buyer hub.
 * The rule lives here rather than in the login screen so it applies to
 * every route into the app — a cold start with a stored session, a magic
 * link, a deep link — not only the one path through the form.
 *
 * The important restraint: this lands people ONCE per sign-in. It does
 * not police navigation afterwards. A vendor who deliberately opens the
 * buyer hub to place their own order should stay there, and yanking them
 * back on every render would make that impossible.
 */
export default function RootLayout() {
  const { session, role, roleResolved, profileMissing, roleError, initialized } =
    useAuthSession();
  const segments = useSegments();

  /** The user id we have already landed, so it happens once per sign-in. */
  const landedFor = useRef(null);

  useEffect(() => {
    if (!initialized) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!session) {
      // Clear the marker so the next sign-in lands again.
      landedFor.current = null;
      if (!inAuthGroup) router.replace('/auth/login');
      return;
    }

    // Wait for the role before routing, or a vendor sees the buyer
    // dashboard flash past on the way to theirs.
    if (!roleResolved) return;

    const alreadyLanded = landedFor.current === session.user.id;
    const target = landingRouteFor(role);

    if (inAuthGroup) {
      // Just signed in, or sitting on login with a live session.
      landedFor.current = session.user.id;
      router.replace(target);
      return;
    }

    if (!alreadyLanded) {
      landedFor.current = session.user.id;
      // Cold start with a stored session. Only move them if they are on
      // the buyer root and belong somewhere else; a deep link to any
      // other screen is honoured as-is.
      const atBuyerRoot =
        segments.length === 0 || (segments.length === 1 && segments[0] === '(tabs)');
      if (atBuyerRoot && target !== '/') router.replace(target);
    }
  }, [session, role, roleResolved, segments, initialized]);

  // Hold the splash until both the session AND the role are known. The
  // role gate only applies while signed in; a signed-out user resolves
  // immediately.
  if (!initialized || (session && !roleResolved)) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#1E3A6E" />
        {session && !roleResolved && <Text style={styles.splashText}>Signing you in…</Text>}
      </View>
    );
  }

  // A signed-in user with no profile row still gets into the app — the
  // buyer hub already explains the problem and offers a retry. Blocking
  // here would strand them on a dead screen with no way to fix it.
  if (session && (profileMissing || roleError)) {
    console.warn(
      '[auth] routing as buyer:',
      profileMissing
        ? 'no profiles row for this account'
        : `role lookup failed — ${roleError?.message}`
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  splash: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  splashText: { fontSize: 14, color: '#5B6B85' },
});
