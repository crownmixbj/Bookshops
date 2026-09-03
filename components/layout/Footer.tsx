import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { colors, spacing, radius, font } from '../../theme';
import { useLayout } from '../../hooks/useLayout';
import { SUPPORT, SUPPORT_TEL, supportMailto } from '../../lib/support';

/**
 * Every route the footer may link to.
 *
 * Typed as a union rather than `string` so a typo, or a link to a screen
 * that has not been built, is a compile error instead of a tap that
 * lands on Expo Router's "Unmatched Route" page. Each of these has a
 * real file under app/.
 */
export type FooterRoute =
  | '/services/shipping'
  | '/services/returns'
  | '/services/sell'
  | '/services/protection'
  | '/about'
  | '/how-it-works'
  | '/contact'
  | '/careers'
  | '/legal/terms'
  | '/legal/privacy'
  | '/legal/cookies'
  | '/legal/guidelines';

interface FooterColumn {
  heading: string;
  links: { label: string; href: FooterRoute }[];
}

const COLUMNS: FooterColumn[] = [
  {
    heading: 'Services',
    links: [
      { label: 'Shipping & Delivery', href: '/services/shipping' },
      { label: 'Returns & Refunds', href: '/services/returns' },
      { label: 'How to Sell Books', href: '/services/sell' },
      { label: 'Buyer & Seller Protection', href: '/services/protection' },
    ],
  },
  {
    heading: 'About Us',
    links: [
      { label: 'About BookShops', href: '/about' },
      { label: 'How It Works', href: '/how-it-works' },
      { label: 'Contact Us', href: '/contact' },
      { label: 'Careers / Work With Us', href: '/careers' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Terms & Conditions', href: '/legal/terms' },
      { label: 'Privacy Policy', href: '/legal/privacy' },
      { label: 'Cookie Policy', href: '/legal/cookies' },
      { label: 'Marketplace Guidelines', href: '/legal/guidelines' },
    ],
  },
];

export type FooterAudience = 'buyer' | 'vendor' | 'admin';

/**
 * The one-liner under the wordmark follows the audience — buyer
 * marketing copy under an admin console reads as a page someone forgot
 * to finish.
 */
const BLURB: Record<FooterAudience, string> = {
  buyer:
    'Send one booklist to the bookshops near you, compare their quotes side by side, and order from the shop you like.',
  vendor: 'Quote on booklists from schools and families near you, then fulfil the orders you win.',
  admin: 'Operations console for the LOCI marketplace.',
};

interface FooterProps {
  audience?: FooterAudience;
}

function ContactRow({
  icon,
  label,
  url,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  url: string;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      // Linking handles tel: and mailto: on iOS, Android and in a
      // browser alike, so this needs no per-platform branch. These are
      // not app routes, which is why they are not <Link>s.
      onPress={() => {
        Linking.openURL(url).catch(() => {
          // No dialer or mail client on this device. Nothing useful to
          // say, and throwing would take the screen down over a footer
          // link.
        });
      }}
      hitSlop={4}
      style={styles.contactRow}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
    >
      {({ pressed }) => (
        <>
          <Ionicons name={icon} size={14} color={colors.onNavyMuted} />
          <Text style={[styles.link, pressed && styles.linkPressed]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/**
 * The site footer.
 *
 * It lives at the end of a screen's scrolling content rather than pinned
 * to the window. Pinning it would permanently steal height from a shell
 * that already has a fixed top bar and, on a phone, a sticky checkout
 * dock — the footer would either cover the dock or squeeze the content
 * between two bars.
 *
 * Layout is one wrapping row: brand block plus four columns. On a wide
 * viewport they sit side by side; as the width shrinks, `flexWrap` drops
 * them onto new lines and they end up stacked on a phone. No breakpoint
 * decides that — the columns simply run out of room.
 */
export function Footer({ audience = 'buyer' }: FooterProps) {
  const { isMobile } = useLayout();
  const year = new Date().getFullYear();

  return (
    <View style={[styles.shell, { paddingHorizontal: isMobile ? spacing.lg : spacing.xl }]}>
      <View style={styles.top}>
        <View style={styles.brandBlock}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Ionicons name="library" size={16} color={colors.onNavy} />
            </View>
            <Text style={styles.brandName}>LOCI</Text>
          </View>
          <Text style={styles.blurb}>{BLURB[audience]}</Text>
        </View>

      <View style={styles.columns}>
        {COLUMNS.map((column) => (
          <View key={column.heading} style={styles.column}>
            <Text style={styles.columnHead}>{column.heading.toUpperCase()}</Text>
            {column.links.map((link) => (
              // expo-router's Link renders a real <a href> on web, so
              // these are middle-clickable, right-click-copyable and
              // crawlable — which router.push() would not be.
              <Link
                key={link.href}
                href={link.href}
                style={styles.link}
                accessibilityLabel={link.label}
              >
                {link.label}
              </Link>
            ))}
          </View>
        ))}

        <View style={styles.column}>
          <Text style={styles.columnHead}>SUPPORT</Text>
          <ContactRow
            icon="call-outline"
            label={SUPPORT.phoneDisplay}
            url={SUPPORT_TEL}
            accessibilityLabel={`Call support on ${SUPPORT.phoneDisplay}`}
          />
          <ContactRow
            icon="mail-outline"
            label={SUPPORT.email}
            url={supportMailto({ subject: 'LOCI support request' })}
            accessibilityLabel={`Email support at ${SUPPORT.email}`}
          />
          <Text style={styles.hours}>{SUPPORT.hours}</Text>
        </View>
      </View>
      </View>

      <View style={styles.rule} />

      <View style={[styles.bottom, isMobile && styles.bottomStacked]}>
        <Text style={styles.copyright}>© {year} BookShops. All rights reserved.</Text>
        <Text style={styles.madeIn}>Built for Nigerian schools and the shops that supply them</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.navyDark,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    // Separates the footer from the last card above it without needing
    // every screen to remember a margin.
    marginTop: spacing.xl,
  },

  top: { gap: spacing.xl },

  // The four link columns. This is the row that wraps: side by side
  // while there is room, dropping onto new lines as the viewport
  // narrows, one per line on a phone. No breakpoint decides it — the
  // columns simply run out of room.
  columns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Row gap keeps wrapped lines apart; without it the columns collide
    // vertically the moment they wrap.
    rowGap: spacing.xl,
    columnGap: spacing.xxl,
  },

  // The brand sits on its own line above them. Letting it share the
  // wrapping row made it claim a third of the width and orphan the last
  // column underneath it.
  brandBlock: { gap: spacing.sm, maxWidth: 420 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandMark: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: { fontSize: font.lg, fontWeight: '800', color: colors.onNavy, letterSpacing: 1 },
  blurb: { fontSize: font.sm, color: colors.onNavyMuted, lineHeight: 18 },

  // flexBasis is the width each column *wants*; below that the row wraps
  // rather than crushing the labels.
  column: { gap: spacing.sm, flexBasis: 168, flexGrow: 1, maxWidth: 240 },
  columnHead: {
    fontSize: font.xs,
    fontWeight: '800',
    color: colors.onNavyFaint,
    letterSpacing: 0.6,
    marginBottom: 2,
  },

  link: { fontSize: font.md, color: colors.onNavyMuted, lineHeight: 22 },
  linkPressed: { color: colors.orange },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hours: { fontSize: font.sm, color: colors.onNavyFaint, marginTop: 2 },

  rule: { height: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: spacing.xl },

  bottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  bottomStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: spacing.xs },
  copyright: { fontSize: font.sm, color: colors.onNavyMuted },
  madeIn: { fontSize: font.xs, color: colors.onNavyFaint },
});
