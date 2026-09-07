import { useEffect, useRef } from 'react';
import { Stack, router, useSegments } from 'expo-router';
import { useAuthSession, landingRouteFor } from '../hooks/useAuthSession';
import { isConfigured, missingEnv } from '../utils/supabase';
import { BootScreen, ConfigErrorScreen } from '../components/layout/BootScreen';
import { AppShell } from '../components/layout/AppShell';
import { colors } from '../theme';
import { isAuthRoute, routeRequiresAuth } from '../lib/authGate';

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
  /**
   * Has the app tree been rendered once?
   *
   * Guards the splash below so it is a boot screen rather than a
   * teardown — see the comment there.
   */
  const hasRendered = useRef(false);

  /** The user id we have already landed, so it happens once per sign-in. */
  const landedFor = useRef(null);

  useEffect(() => {
    if (!initialized) return;

    const inAuthGroup = isAuthRoute(segments);

    if (!session) {
      // Clear the marker so the next sign-in lands again.
      landedFor.current = null;

      // Expo Router reports an empty segment array for one tick while it
      // resolves a popstate — a browser Back or Forward press. It is not
      // a route: '/' resolves to ['(tabs)'], never to []. Reading it as
      // one made isPublic false and fired the replace below, so a
      // signed-out visitor who opened Terms from the login page and then
      // pressed Forward was thrown back to the login form, cancelling
      // the navigation they had just made.
      //
      // This defers the decision rather than skipping it: the empty
      // array is always followed immediately by the resolved one, and
      // this effect re-runs on it. Deliberately scoped to the
      // signed-out branch — the landing logic below reads the same
      // empty tick as "at the buyer root", which is how a vendor
      // arriving on a confirmation link reaches /vendor.
      if (segments.length === 0) return;

      // Guests browse. Only the routes that read a buyer's own data or
      // spend their money bounce to the login form — see lib/authGate.
      // Everything else, the dashboard and shop pages included, opens
      // without an account, and the sign-in prompt is raised at the
      // moment a guest actually tries to act.
      if (!inAuthGroup && routeRequiresAuth(segments)) router.replace('/auth/login');
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

  // A build without Supabase credentials cannot do anything, and used to
  // render as a white page — the error is thrown while the module loads,
  // so React never gets to draw. Say what is missing instead.
  if (!isConfigured) {
    return <ConfigErrorScreen missing={missingEnv} />;
  }

  // Hold the splash until both the session AND the role are known —
  // but ONLY on the way in. The role gate exists so a vendor does not
  // see the buyer dashboard flash past on a cold start; it was never
  // meant to tear down an app that is already running.
  //
  // It was doing exactly that. Signing in from anywhere inside the app
  // flips `session` truthy and `roleResolved` false for the length of
  // one profile query, and this line swapped the ENTIRE Stack for a
  // splash while that ran. Everything below it unmounted: the review
  // modal, the booklist the guest had typed into it, and the picked
  // photo — which on web is a blob: URL that cannot be recreated once
  // its owner is gone. That, not the sign-in screen, is what made a
  // guest lose their photo when they signed in.
  //
  // So the splash is now only shown before the tree has ever rendered.
  // After that a role re-resolve happens underneath a live screen, and
  // the effect above still routes a vendor to /vendor the moment the
  // role arrives — a buyer, whose target is '/', is simply left where
  // they are, with their work intact.
  const booting = !initialized || (session && !roleResolved);
  if (booting && !hasRendered.current) {
    return <BootScreen message={session && !roleResolved ? 'Signing you in…' : undefined} />;
  }
  hasRendered.current = true;

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

  // contentStyle paints the navigator's own background. Without it the
  // stack defaults to white and you get a flash of it behind every push
  // — most visible on web, where the transition is instant.
  const stack = (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }}
    />
  );

  // The chrome is mounted HERE, outside the navigator, so it survives
  // every navigation instead of being torn down and rebuilt by each
  // screen. That is what keeps the header on screen — and what keeps
  // the search box from clearing — as you move around.
  //
  // The auth screens stand alone — a login form inside the app chrome
  // reads as though you are already in. Everything else gets the shell,
  // signed in or not: a guest browsing the hub needs the same header and
  // navigation as anyone else, and rendering a bare stack for them was
  // what made guest browsing look broken rather than open.
  if (isAuthRoute(segments)) return stack;

  return <AppShell role={role ?? 'buyer'}>{stack}</AppShell>;
}
