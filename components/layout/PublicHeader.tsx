import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '../../theme';
import { useLayout } from '../../hooks/useLayout';
import { SUPPORT, supportMailto } from '../../lib/support';

/**
 * The header for pages a signed-out visitor can reach.
 *
 * Deliberately NOT the app chrome from AppShell. That header carries a
 * search box over the person's own orders, their shop identity, the
 * peak-season toggle and an account menu that queries `profiles` — none
 * of which mean anything to someone who has not signed in yet, and the
 * account menu would fire a query for a user who does not exist.
 *
 * So this is the same navy bar with the same wordmark, and nothing that
 * needs a session: brand, and a way to reach a human.
 */
export function PublicHeader() {
  const { isMobile } = useLayout();

  return (
    <View style={styles.bar}>
      <View style={styles.brand}>
        <View style={styles.mark}>
          <Ionicons name="library" size={16} color={colors.onNavy} />
        </View>
        <Text style={styles.wordmark}>LOCI</Text>
        {!isMobile && <Text style={styles.tagline}>School books, from shops near you</Text>}
      </View>

      <Pressable
        onPress={() => {
          Linking.openURL(supportMailto({ subject: 'Help signing in to LOCI' })).catch(() => {
            // No mail client. The footer below lists the phone number.
          });
        }}
        hitSlop={8}
        style={({ pressed }) => [styles.help, pressed && styles.helpPressed]}
        accessibilityRole="link"
        accessibilityLabel={`Email support at ${SUPPORT.email}`}
      >
        <Ionicons name="help-buoy-outline" size={15} color={colors.onNavy} />
        <Text style={styles.helpText}>{isMobile ? 'Help' : 'Need help?'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 56,
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.lg,
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
  tagline: {
    color: colors.onNavyMuted,
    fontSize: font.sm,
    marginLeft: spacing.sm,
    paddingLeft: spacing.sm,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.2)',
  },

  help: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  helpPressed: { backgroundColor: 'rgba(255,255,255,0.12)' },
  helpText: { color: colors.onNavy, fontSize: font.sm, fontWeight: '700' },
});
