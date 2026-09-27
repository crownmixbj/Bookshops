import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Animated,
  Easing,
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
} from 'react-native';
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
 * The photos are NOT pre-cropped. All three have their subject from
 * about x=400–465 rightwards; everything left of that is backdrop drawn as copy
 * space for a full-width banner. The layout below removes that space in
 * code rather than in extra image files — see artFrame().
 *
 * The previous artwork (hero-banner.jpg, and its uncropped original
 * hero-banner-full.jpg) is no longer referenced but left in assets.
 */
/**
 * The carousel, in order. All three are 1024x572 on a clean white or
 * light-grey studio backdrop, with the subject in the right-hand ~55%,
 * so one artFrame() fits them all:
 *
 *   hero-banner1  hands holding a clipboard booklist and the priced quote
 *                 on a phone (backdrop ~#F3F3F3)
 *   hero-banner2  a hand photographing a handwritten booklist with a phone
 *                 on a light wooden desk (backdrop ~#EDF1F2)
 *   hero-banner3  an illustrated parade of three bookshop fronts on a
 *                 pavement (backdrop ~#F8F9F4)
 */
const HERO_SLIDES = [
  require('../../assets/images/hero-banner1.jpeg'),
  require('../../assets/images/hero-banner2.jpeg'),
  require('../../assets/images/hero-banner3.jpeg'),
];

/**
 * A new photo every 5 seconds, crossfading over 0.8s with ease-in-out.
 * The timer restarts the moment a fade begins, so a change starts every
 * 5s exactly, however long the fade takes.
 */
const SLIDE_HOLD_MS = 5000;
const SLIDE_FADE_MS = 800;
const SLIDE_EASING = Easing.inOut(Easing.ease);

/** Intrinsic size of every hero photo. */
const HERO_W = 1024;
const HERO_H = 572;

/**
 * Where the subject begins, in source pixels. The clipboard's left edge
 * is at x≈480; left of x≈460 there is only the tip of a forearm in the
 * bottom corner. 450 keeps the whole clipboard with a sliver of backdrop
 * beside it, and lets that bit of forearm go.
 */
const SUBJECT_LEFT = 450;

/**
 * The whole hero card's background — copy side and photo side alike.
 *
 * One light neutral sitting between the three photos' own backdrops
 * (#EDF1F2 – #F8F9F4), so every photo reads as printed on the card
 * rather than pasted onto it. Not pure #FFFFFF: all three photos are a
 * shade darker than white, and against it their edges would show as
 * faint grey boxes. It is also what fills
 * any strip a photo does not cover (artFrame's third case, narrow
 * tablets), and being one colour for all three, nothing jumps when one
 * photo fades into the next.
 */
const HERO_BACKDROP = '#F3F4F1';

/**
 * The seam between the copy side and the photo.
 *
 * Even on one shared background, a photo's cut edge can show as a faint
 * line where its backdrop is a shade off the card's. This lays a short
 * card-colour-to-clear fade over the photo's inner edge (its left on wide
 * screens, its bottom on a phone, where the copy sits underneath) so the
 * photo dissolves into the card instead. No gradient library in
 * the project, so it is 36 hairline bands of falling opacity, 2px each
 * (72px in all). Fewer, wider bands showed as visible stripes; at 2px
 * and ~3% opacity per step the fade reads as continuous.
 */
const SEAM_BANDS = 36;
const SEAM_BAND_PX = 2;

function SeamFade({ side }) {
  const horizontal = side === 'left';
  return (
    <View
      pointerEvents="none"
      style={[styles.seam, horizontal ? styles.seamLeft : styles.seamBottom]}
    >
      {Array.from({ length: SEAM_BANDS }, (_, i) => {
        // Eased, so it is solid card colour at the seam and melts out.
        const t = 1 - i / SEAM_BANDS;
        return (
          <View
            key={i}
            style={{
              backgroundColor: HERO_BACKDROP,
              opacity: t * t,
              [horizontal ? 'width' : 'height']: SEAM_BAND_PX,
            }}
          />
        );
      })}
    </View>
  );
}


/**
 * Size and place the photo inside a panel of `w` x `h`.
 *
 * React Native has no object-position, so "cover, but keep the right
 * side" is done by hand: the image is drawn larger than the panel and
 * pinned to its bottom-right corner, and the panel's overflow clips the
 * rest. Pinned right because that is where the subject is; pinned
 * bottom because the hands run off the bottom edge of the photo, and a
 * gap under them would look like a mistake.
 *
 * Three cases, in order of preference:
 *   1. Fit the height. The empty left side is clipped away. Used while
 *      the panel is wide enough to show the whole subject.
 *   2. The panel is wider than the photo at that height: fit the width
 *      instead and let the empty sky at the top be clipped.
 *   3. The panel is too narrow to show the subject at full height: scale
 *      down until the subject fits the width. The strip left above it is
 *      filled by the matching backdrop colour.
 */
function artFrame(w, h) {
  if (!w || !h) return null;
  const byHeight = h / HERO_H;
  if (HERO_W * byHeight < w) {
    const s = w / HERO_W;
    return { width: w, height: HERO_H * s };
  }
  if (w / byHeight >= HERO_W - SUBJECT_LEFT) {
    return { width: HERO_W * byHeight, height: h };
  }
  const s = w / (HERO_W - SUBJECT_LEFT);
  return { width: HERO_W * s, height: HERO_H * s };
}

/**
 * The dashboard hero.
 *
 * Split on wide screens — headline and CTA left, artwork right — and
 * stacked on mobile, artwork first. The whole card is one light neutral
 * (HERO_BACKDROP) matching the photos' studio backdrops, so there is no
 * colour split between the halves; the type is dark navy on that light
 * ground for contrast. Text never sits over a photo.
 *
 * The photo fills its panel edge to edge, anchored bottom-right, with
 * its empty left-hand backdrop clipped off — artFrame() above does the
 * sizing. `contain` would have letterboxed it; plain `cover` would have
 * centred it and cut into the clipboard on narrower screens.
 */
export function HeroBanner({ onCreate, onBrowse }) {
  const { isMobile, isDesktop } = useLayout();
  const [panel, setPanel] = useState({ w: 0, h: 0 });
  const frame = artFrame(panel.w, panel.h);

  // ---- slideshow ------------------------------------------------
  // Every photo is mounted once, absolutely positioned in the same spot,
  // each with its OWN opacity value. A change never adds, removes or
  // resizes anything — only opacities and stacking order move — so the
  // text and buttons beside it cannot shift.
  //
  // A change from A to B:
  //   1. B (already at opacity 0) is raised above A.
  //   2. B fades 0 -> 1 over A, which stays fully opaque underneath, so
  //      the panel never dips through its background mid-fade.
  //   3. Once B is fully in, A is dropped to 0, out of sight beneath it.
  //
  // The previous version shared one opacity value between whichever
  // photo was incoming. It was still at 1 from the last fade when the
  // new photo was first drawn, and was only reset to 0 a frame later —
  // so each new photo flashed in at full strength before fading. That
  // one-frame flash is what made the change feel abrupt.
  const opacity = useRef(HERO_SLIDES.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;
  const [current, setCurrent] = useState(0);
  const [still, setStill] = useState(false);

  // Respect "reduce motion": the first photo, and nothing moving.
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setStill(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setStill);
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (still || HERO_SLIDES.length < 2) return;
    const t = setTimeout(() => {
      const from = current;
      const to = (current + 1) % HERO_SLIDES.length;
      // Set BEFORE the re-render that raises it, so it is never drawn
      // on top at anything but 0.
      opacity[to].setValue(0);
      setCurrent(to);
      Animated.timing(opacity[to], {
        toValue: 1,
        duration: SLIDE_FADE_MS,
        easing: SLIDE_EASING,
        // The web has no native animation driver; asking for one there
        // only logs a warning and falls back anyway.
        useNativeDriver: Platform.OS !== 'web',
      }).start(({ finished }) => {
        if (finished) opacity[from].setValue(0);
      });
    }, SLIDE_HOLD_MS);
    // Only the pending timer is cleared. A fade already running is left to
    // finish: `current` changing at the START of a fade is what re-runs
    // this effect, and stopping it there would freeze the fade halfway.
    return () => clearTimeout(t);
  }, [current, still, opacity]);

  const art = (
    <View
      style={[
        styles.artPanel,
        isMobile ? styles.artPanelMobile : styles.artPanelWide,
      ]}
      // Decorative: the headline beside it already says what the product
      // does, so a screen reader announcing the illustration as well
      // would just repeat it more vaguely.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        // Only when it actually changes: this runs on every layout pass.
        if (width !== panel.w || height !== panel.h) setPanel({ w: width, h: height });
      }}
    >
      {/* Not rendered until the panel has been measured, so the photo
          never flashes at the wrong size on first paint. */}
      {frame &&
        HERO_SLIDES.map((source, i) => (
          <Animated.Image
            key={i}
            source={source}
            style={[
              styles.art,
              { width: frame.width, height: frame.height },
              // Same shape of style every render — only the zIndex
              // number changes — so nothing is re-created mid-fade.
              { opacity: opacity[i], zIndex: i === current ? 2 : 1 },
            ]}
            resizeMode="stretch"
          />
        ))}
      <SeamFade side={isMobile ? 'bottom' : 'left'} />
    </View>
  );

  const copy = (
    <View style={[styles.copyPanel, isMobile ? styles.copyPanelMobile : styles.copyPanelWide]}>
      <View style={styles.eyebrow}>
        <Ionicons name="pricetags-outline" size={13} color={colors.navy} />
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
            <Ionicons name="arrow-forward" size={15} color={colors.navy} />
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <View
      style={[
        styles.wrap,
        isMobile ? styles.wrapMobile : styles.wrapWide,
        isDesktop && styles.wrapDesktop,
      ]}
    >
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
    backgroundColor: HERO_BACKDROP,
    // The same 1px edge every dashboard card has, so a light hero still
    // separates from the light page behind it.
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  /**
   * minHeight, because otherwise the artwork is at the text's mercy.
   *
   * Both panels are `alignItems: 'stretch'`, so the row's height is set
   * by the TALLER child, and the copy alone comes to only ~160px — far
   * too short for the clipboard and phone to read at a glance.
   *
   * 300 keeps the photo in artFrame's first case (fit the height, clip
   * the empty left) at most tablet widths: a ~344px art panel shows
   * 344 / 300 × 572 ≈ 656 source pixels, more than the 574px subject.
   */
  wrapWide: { flexDirection: 'row', alignItems: 'stretch', minHeight: 300 },
  // Desktop gives the hero a wider column, so the art wants more height
  // again to fill it without letterboxing.
  wrapDesktop: { minHeight: 340 },
  wrapMobile: { flexDirection: 'column' },

  /* ---- text side ---- */
  copyPanel: { backgroundColor: HERO_BACKDROP, justifyContent: 'center' },
  // 1.15 against the artwork's 1, so the headline gets the larger share
  // without the illustration shrinking to a thumbnail.
  copyPanelWide: { flex: 1.15, padding: spacing.xxl, minWidth: 0 },
  copyPanelMobile: { padding: spacing.xl },

  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(30,58,110,0.08)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginBottom: spacing.md,
  },
  eyebrowText: { ...typography.caption, color: colors.navy, fontWeight: '600' },

  // 28/700/1.2, stepping to 32 on desktop — the two hero rungs, not
  // hand-set numbers. The weight comes down from 800: at 28px and above,
  // 800 on a navy ground fills the counters and the line stops reading
  // as type and starts reading as a block.
  // Navy on #F3F4F1 is about 10:1 — well past the 4.5:1 AA line.
  headline: { ...typography.heroTitle, color: colors.navy },
  headlineDesktop: { ...typography.heroTitleLarge },
  // Slate (#334155) rather than the lighter body grey: ~9:1 on the card.
  sub: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, maxWidth: 460 },

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
    borderColor: colors.navy,
    backgroundColor: colors.surface,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
  },
  ghostPressed: { backgroundColor: colors.surfaceMuted },
  ghostText: { ...typography.bodyStrong, fontWeight: '600', color: colors.navy },

  /* ---- artwork side ---- */
  // overflow:hidden is what does the cropping: the photo is drawn larger
  // than this panel and pinned bottom-right (see artFrame).
  artPanel: { backgroundColor: HERO_BACKDROP, overflow: 'hidden' },
  seam: { position: 'absolute', zIndex: 3 },
  seamLeft: { left: 0, top: 0, bottom: 0, flexDirection: 'row' },
  seamBottom: { left: 0, right: 0, bottom: 0, flexDirection: 'column-reverse' },
  artPanelWide: { flex: 1, minWidth: 0 },
  // The subject's own proportions (574 x 572 once the empty left side is
  // dropped), so a phone shows the clipboard and phone edge to edge.
  artPanelMobile: { width: '100%', aspectRatio: (HERO_W - SUBJECT_LEFT) / HERO_H, maxHeight: 300 },
  art: { position: 'absolute', right: 0, bottom: 0 },
});
