import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, font } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * Where "Home" goes for someone who has not signed in.
 *
 * Not '/' — that route is the buyer dashboard, and app/_layout.js sends
 * a signed-out visitor from it straight back to /auth/login. Pointing
 * the link there would put a control on the page that looks like an exit
 * and returns you to the page you were already on.
 *
 * '/how-it-works' is public, renders signed out, and is the nearest
 * thing the site has to a landing page: it explains the marketplace to a
 * visitor. When a real public home page exists at '/', change this one
 * constant and the header follows.
 */
export const AUTH_HOME_HREF = '/how-it-works' as const;

/**
 * The header for the sign-in and sign-up screens.
 *
 * Deliberately thinner than the marketplace chrome. Someone on a login
 * form has exactly two intentions — sign in, or leave — so the bar
 * carries the brand and one way out, and nothing else.
 *
 * It applies the safe-area insets itself rather than sitting inside a
 * SafeAreaView, so the navy runs edge to edge and up under the status
 * bar instead of leaving a page-coloured strip above it.
 */
export function AuthHeader() {
  const insets = useSafeAreaInsets();
  const { isMobile } = useLayout();

  return (
    <View
      style={[
        styles.bar,
        {
          paddingTop: insets.top,
          paddingLeft: spacing.lg + insets.left,
          paddingRight: spacing.lg + insets.right,
        },
      ]}
    >
      <View style={styles.inner}>
        <View style={styles.brand}>
          <View style={styles.mark}>
            <Ionicons name="library" size={16} color={colors.onNavy} />
          </View>
          <Text style={styles.wordmark}>LOCI</Text>
        </View>

        {/* asChild so this is still a real <a href> on web — middle
            clickable, copyable, crawlable — while Pressable supplies the
            pressed state that a bare Link cannot. */}
        <Link href={AUTH_HOME_HREF} asChild>
          <Pressable
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="Back to home"
          >
            {({ pressed }) => (
              <Text style={[styles.back, pressed && styles.backPressed]}>
                {isMobile ? '← Home' : '← Back to Home'}
              </Text>
            )}
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Full bleed: no radius, no horizontal margin, no max width. The
  // padding lives here so the colour still reaches both edges.
  bar: { width: '100%', backgroundColor: colors.navy },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 56,
  },

  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  mark: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: { color: colors.onNavy, fontSize: font.xl, fontWeight: '800', letterSpacing: 1 },

  // Subtle by design: no pill, no border, muted against the navy. It is
  // the way out, not the thing to press.
  back: { color: colors.onNavyMuted, fontSize: font.md, fontWeight: '600' },
  backPressed: { color: colors.onNavy },
});
