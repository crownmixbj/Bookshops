import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { colors, spacing, font } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * The footer for internal workspace screens.
 *
 * The marketplace Footer is a four-column sitemap aimed at a buyer who
 * is still deciding whether to trust the place. A shop owner pricing a
 * booklist has already decided, is signed in, and is scrolling past
 * "Careers" and "How It Works" on every screen to reach their own work.
 *
 * So: one line. Copyright, and the two links a vendor plausibly needs
 * mid-task.
 *
 * Not `position: fixed`. It sits at the end of the scroll content, after
 * everything else on the page — including any editor panel that is open.
 * A footer pinned over the viewport would cover the Save button on a
 * short screen, which is worse than the problem it solves.
 */
export function WorkspaceFooter() {
  const { isMobile } = useLayout();

  return (
    <View style={[styles.footer, isMobile && styles.footerMobile]}>
      <Text style={styles.copy}>© 2026 LOCI Marketplace. All rights reserved.</Text>

      <View style={styles.links}>
        {/* /vendor/support, not the buyer's /support: sending a vendor
            there would drop them into the buyer shell and lose their
            sidebar. */}
        <FooterLink label="Vendor Support" onPress={() => router.push('/vendor/support')} />
        {/* /legal/terms is the real route. There is no /terms. */}
        <FooterLink label="Terms of Service" onPress={() => router.push('/legal/terms')} />
      </View>
    </View>
  );
}

function FooterLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }) => [
        styles.link,
        // RN-Web gives Pressable a `hovered` flag; on native it is
        // undefined and this simply never fires, which is correct —
        // there is no hover on a phone.
        (hovered || pressed) && styles.linkActive,
      ]}
      accessibilityRole="link"
      accessibilityLabel={label}
    >
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    // Pushes the footer away from the last panel rather than letting it
    // read as part of it.
    marginTop: spacing.xl,
  },
  footerMobile: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  copy: { fontSize: font.xs, color: colors.textMuted },
  links: { flexDirection: 'row', gap: spacing.lg },
  link: { paddingVertical: 2 },
  linkActive: { opacity: 0.6 },
  linkText: {
    fontSize: font.xs,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
});
