import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, font } from '../../theme';

/**
 * One legal link in the auth footer.
 *
 * Link + asChild keeps a real <a href> on web while Pressable supplies
 * the pressed colour. Both routes below exist under app/legal/, so
 * neither can land on Expo Router's "Unmatched Route" screen.
 */
function FooterLink({ href, label }: { href: '/legal/terms' | '/legal/privacy'; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable hitSlop={6} accessibilityRole="link" accessibilityLabel={label}>
        {({ pressed }) => (
          <Text style={[styles.link, pressed && styles.linkPressed]}>{label}</Text>
        )}
      </Pressable>
    </Link>
  );
}

/**
 * The footer for the sign-in and sign-up screens.
 *
 * The marketplace footer — four columns of links, a brand blurb, support
 * hours — is the wrong furniture for a login page. It is taller than the
 * form it sits under, it offers a dozen exits to someone who came to do
 * one thing, and inside a centred layout it pushes the card visibly
 * above the optical centre of the screen.
 *
 * So this is a single line, and it is a band rather than a card: full
 * width, square corners, no inset, its own bottom safe-area padding, so
 * the colour reaches all three edges the way a footer bar is expected
 * to. It is rendered by app/auth/_layout.tsx OUTSIDE the screen's
 * scroll view, which is what lets the form centre in the space that is
 * genuinely left over.
 */
export function AuthFooter() {
  const insets = useSafeAreaInsets();
  const year = new Date().getFullYear();

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: spacing.md + insets.bottom,
          paddingLeft: spacing.lg + insets.left,
          paddingRight: spacing.lg + insets.right,
        },
      ]}
    >
      {/* Wraps rather than overflowing: on a 320px phone the three
          items drop onto two lines instead of being clipped. */}
      <View style={styles.line}>
        <Text style={styles.copyright}>© {year} LOCI</Text>
        <Text style={styles.dot}>•</Text>
        <FooterLink href="/legal/terms" label="Terms & Conditions" />
        <Text style={styles.dot}>•</Text>
        <FooterLink href="/legal/privacy" label="Privacy Policy" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    // Full bleed. No borderRadius, no maxWidth, no alignSelf — the
    // background has to reach the left, right and bottom edges of the
    // window, which a centred rounded card cannot do.
    width: '100%',
    backgroundColor: colors.navyDark,
    paddingTop: spacing.md,
  },
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  copyright: { fontSize: font.sm, color: colors.onNavyMuted },
  dot: { fontSize: font.sm, color: colors.onNavyFaint },
  link: { fontSize: font.sm, color: colors.onNavyMuted, fontWeight: '600' },
  linkPressed: { color: colors.orange },
});
