import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, shadow, typography } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * The artwork, bundled rather than fetched.
 *
 * A relative require, not the `@/assets/...` alias. The alias IS declared
 * in tsconfig.json paths, but nothing in this codebase imports through it
 * and babel.config.js has no module-resolver — so it rests entirely on
 * Metro's tsconfigPaths experiment being on. A hero image that resolves
 * in the editor and 500s in the bundler is not worth the tidier string,
 * and require() is what react-native's Image wants anyway.
 *
 * The asset is the CROPPED version. The original is 1024x572 with the
 * subject pushed into the right half and roughly 440px of empty gradient
 * backdrop on the left — it was drawn as a full-width marketing banner
 * with copy space beside the artwork. Dropped straight into a split
 * panel, that empty half renders as a large beige gap between the
 * headline and the illustration. The crop removes 360px of backdrop and
 * nothing else; the nearest real pixel starts at x=438, so there is
 * still 78px of clearance around the artwork. hero-banner-full.jpg is
 * the untouched original, kept for a full-bleed treatment later.
 */
const HERO_IMAGE = require('../../assets/images/hero-banner.jpg');

/** Intrinsic aspect of the cropped asset (664 x 572). */
const HERO_ASPECT = 664 / 572;

/**
 * Sampled from the crop's own top-left pixel (#B39980).
 *
 * The backdrop is a gradient, not a flat fill, so no single colour can
 * match all four edges. This one matches the edge a letterbox actually
 * sits against, which makes `contain` look like generous padding rather
 * than a mismatched band.
 */
const HERO_BACKDROP = '#B39980';

/**
 * The dashboard hero.
 *
 * Split on wide screens — headline and CTA left, artwork right — and
 * stacked on mobile, artwork first. The text sits on a solid navy panel
 * rather than over the image: there is no gradient library in this
 * project, and white type laid directly on a photograph whose brightness
 * runs from #B39980 to #DECCB8 is a contrast gamble that fails on
 * exactly the devices hardest to test.
 *
 * resizeMode is `contain`, not `cover`. The illustration is a single
 * composed object — a shop, a phone and five price tags on connecting
 * light trails — and `cover` crops whichever edge does not fit the
 * panel's aspect. At desktop widths that is the top and bottom, which
 * takes the ₦19,800 tag and the shop's base. `contain` keeps every part
 * of it at every width, and the matched backdrop hides the letterbox.
 */
export function HeroBanner({ onCreate, onBrowse }) {
  const { isMobile, isDesktop } = useLayout();

  const art = (
    <View
      style={[styles.artPanel, isMobile ? styles.artPanelMobile : styles.artPanelWide]}
      // Decorative: the headline beside it already says what the product
      // does, so a screen reader announcing the illustration as well
      // would just repeat it more vaguely.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image source={HERO_IMAGE} style={styles.art} resizeMode="contain" />
    </View>
  );

  const copy = (
    <View style={[styles.copyPanel, isMobile ? styles.copyPanelMobile : styles.copyPanelWide]}>
      <View style={styles.eyebrow}>
        <Ionicons name="pricetags-outline" size={13} color={colors.onNavy} />
        <Text style={styles.eyebrowText}>Free quotes from local bookshops</Text>
      </View>

      <Text
        style={[styles.headline, isDesktop && styles.headlineDesktop]}
        // The whole point of a hero is that this is the first thing read.
        accessibilityRole="header"
      >
        All your school supplies,{'\n'}priced by shops near you
      </Text>

      <Text style={styles.sub}>
        Snap the paper booklist, upload it, or type it in. Nearby bookshops quote on what you
        send, and you pick the one you like.
      </Text>

      <View style={[styles.actions, isMobile && styles.actionsMobile]}>
        <Pressable
          onPress={onCreate}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          accessibilityRole="button"
          accessibilityLabel="Create a new booklist"
          accessibilityHint="Photograph a printed list, pick one from your photos, or type it in"
        >
          <Ionicons name="camera" size={17} color={colors.onNavy} />
          <Text style={styles.ctaText}>Create New Booklist</Text>
        </Pressable>

        {!!onBrowse && (
          <Pressable
            onPress={onBrowse}
            style={({ pressed }) => [styles.ghost, pressed && styles.ghostPressed]}
            accessibilityRole="button"
            accessibilityLabel="Browse bookshops"
          >
            <Text style={styles.ghostText}>Browse bookshops</Text>
            <Ionicons name="arrow-forward" size={15} color={colors.onNavy} />
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <View style={[styles.wrap, isMobile ? styles.wrapMobile : styles.wrapWide]}>
      {/* Artwork first on mobile so the page opens on something to look
          at, and second on wide so the headline leads the reading order.
          The DOM order changes with it rather than being flipped in CSS,
          so a screen reader and the tab key follow what is on screen. */}
      {isMobile ? (
        <>
          {art}
          {copy}
        </>
      ) : (
        <>
          {copy}
          {art}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.navy,
    ...shadow.card,
  },
  wrapWide: { flexDirection: 'row', alignItems: 'stretch' },
  wrapMobile: { flexDirection: 'column' },

  /* ---- text side ---- */
  copyPanel: { backgroundColor: colors.navy, justifyContent: 'center' },
  // 1.15 against the artwork's 1, so the headline gets the larger share
  // without the illustration shrinking to a thumbnail.
  copyPanelWide: { flex: 1.15, padding: spacing.xl, minWidth: 0 },
  copyPanelMobile: { padding: spacing.lg },

  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginBottom: spacing.md,
  },
  eyebrowText: { ...typography.caption, color: colors.onNavy, fontWeight: '600' },

  // 28/700/1.2, stepping to 32 on desktop — the two hero rungs, not
  // hand-set numbers. The weight comes down from 800: at 28px and above,
  // 800 on a navy ground fills the counters and the line stops reading
  // as type and starts reading as a block.
  headline: { ...typography.heroTitle, color: colors.onNavy },
  headlineDesktop: { ...typography.heroTitleLarge },
  sub: { ...typography.body, color: 'rgba(255,255,255,0.80)', marginTop: spacing.sm, maxWidth: 460 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  // Full width and stacked on a phone, where a row of two buttons leaves
  // both too narrow to read and too small to hit.
  actionsMobile: { flexDirection: 'column', alignItems: 'stretch' },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    minHeight: 46,
  },
  ctaPressed: { backgroundColor: colors.orangeDark },
  ctaText: { ...typography.bodyStrong, fontWeight: '700', color: colors.onNavy },

  ghost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
  },
  ghostPressed: { backgroundColor: 'rgba(255,255,255,0.12)' },
  ghostText: { ...typography.bodyStrong, fontWeight: '600', color: colors.onNavy },

  /* ---- artwork side ---- */
  artPanel: { backgroundColor: HERO_BACKDROP, alignItems: 'center', justifyContent: 'center' },
  artPanelWide: { flex: 1, minWidth: 0 },
  // Height comes from the asset's own aspect, so the strip is never
  // taller than the artwork needs and `contain` has nothing to letterbox.
  artPanelMobile: { width: '100%', aspectRatio: HERO_ASPECT, maxHeight: 260 },
  art: { width: '100%', height: '100%' },
});
