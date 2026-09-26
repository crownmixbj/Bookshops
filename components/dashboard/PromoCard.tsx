import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  Animated,
  AccessibilityInfo,
  StyleSheet,
  type ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { endsInLabel, type Promo } from '../../hooks/useDashboardPromo';
import { colors, spacing, radius, font, shadow, typography } from '../../theme';

/**
 * The dashboard's permanent promo slot.
 *
 * One layout for everything it can show — a paid deal, a top-rated
 * shop, or LOCI's own parent-facing card — so the rail looks identical whichever
 * source filled it. Only two things vary with the source, and both are
 * about honesty rather than decoration: the badge colour (orange means
 * paid, navy means not) and the line of fine print saying which it is.
 *
 *   'column'  the right-hand rail on desktop
 *   'inline'  a card at the top of the side column on tablet and phone
 */

interface Props {
  promo: Promo | null;
  loading?: boolean;
  variant: 'column' | 'inline';
  onAction: (promo: Promo) => void;
  onLink: (route: string) => void;
}

export function PromoCard({ promo, loading, variant, onAction, onLink }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!promo) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [opacity, promo?.key]);

  const body =
    !promo || loading ? (
      <Skeleton />
    ) : (
      <Animated.View
        style={[styles.card, { opacity }]}
        accessibilityLabel={`${promo.badge}: ${promo.title}. ${promo.headline}`}
      >
        <View style={styles.topRow}>
          <View style={[styles.badge, promo.badgeTone === 'paid' ? styles.badgePaid : styles.badgeHouse]}>
            <Ionicons
              name={promo.badgeIcon}
              size={11}
              color={promo.badgeTone === 'paid' ? colors.orangeDark : colors.navy}
            />
            <Text style={[styles.badgeText, { color: promo.badgeTone === 'paid' ? colors.orangeDark : colors.navy }]}>
              {promo.badge}
            </Text>
          </View>
          {!!promo.endsAt && <Countdown endsAt={promo.endsAt} />}
        </View>

        {promo.slides ? (
          <Slideshow slides={promo.slides} onOpen={onLink} />
        ) : promo.imageUrl ? (
          <Image
            source={{ uri: promo.imageUrl }}
            style={styles.visual}
            resizeMode="cover"
            accessibilityLabel={`${promo.title} photo`}
          />
        ) : (
          <View style={[styles.visual, styles.visualTile]} accessibilityElementsHidden importantForAccessibility="no">
            {'letter' in promo.visual ? (
              <>
                <Text style={styles.monogram}>{promo.visual.letter}</Text>
                <Ionicons name="storefront" size={18} color={colors.onNavyMuted} style={styles.cornerIcon} />
              </>
            ) : (
              <Ionicons name={promo.visual.icon} size={40} color={colors.onNavy} />
            )}
          </View>
        )}

        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {promo.title}
          </Text>
          {promo.verified && (
            <Ionicons name="checkmark-circle" size={14} color={colors.success} accessibilityLabel="Verified shop" />
          )}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {promo.meta}
        </Text>

        <Text style={styles.headline}>{promo.headline}</Text>
        {!!promo.tag && (
          <View style={styles.tag}>
            <Text style={styles.tagText}>{promo.tag}</Text>
          </View>
        )}
        {!!promo.details && <Text style={styles.details}>{promo.details}</Text>}

        <Pressable
          onPress={() => onAction(promo)}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          accessibilityRole="button"
          accessibilityLabel={promo.cta.label}
        >
          <Ionicons name={promo.cta.icon} size={15} color={colors.onNavy} />
          <Text style={styles.ctaText} numberOfLines={2}>
            {promo.cta.label}
          </Text>
        </Pressable>
        {/* Always the same height, link or not, so the rail does not
            shift when the source changes. */}
        <View style={styles.linkRow}>
          {!!promo.link && (
            <Pressable onPress={() => onLink(promo.link!.route)} accessibilityRole="link" hitSlop={6}>
              <Text style={styles.linkText}>{promo.link.label}</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.fine}>{promo.fine}</Text>
      </Animated.View>
    );

  // The same Card surface in both variants — surface, 1px border, large
  // radius, card shadow, 16px padding — so the promo reads as one more
  // dashboard card rather than a foreign widget. On desktop the rail
  // around it simply gives it its own column.
  if (variant === 'inline') return <View style={styles.inline}>{body}</View>;
  return (
    <View style={styles.column}>
      <View style={styles.inline}>{body}</View>
    </View>
  );
}

/**
 * A slow crossfade through the category photos, each captioned and
 * tappable to its category. The next photo fades in over the current
 * one, so there is never a blank frame between them.
 *
 * Holds still for anyone who has asked the OS to reduce motion, and
 * pauses while pressed so a slide can actually be tapped.
 */
const SLIDE_MS = 3200;

function Slideshow({
  slides,
  onOpen,
}: {
  slides: { source: ImageSourcePropType; label: string; route: string }[];
  onOpen: (route: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [still, setStill] = useState(false);
  const [held, setHeld] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;

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
    if (still || held || slides.length < 2) return;
    const t = setTimeout(() => {
      setPrev(index);
      setIndex((i) => (i + 1) % slides.length);
    }, SLIDE_MS);
    return () => clearTimeout(t);
  }, [index, still, held, slides.length]);

  useEffect(() => {
    if (prev === null) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 700, useNativeDriver: true }).start(() => setPrev(null));
  }, [index, prev, fade]);

  const current = slides[index];

  return (
    <Pressable
      onPress={() => onOpen(current.route)}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      onHoverIn={() => setHeld(true)}
      onHoverOut={() => setHeld(false)}
      style={styles.visual}
      accessibilityRole="link"
      accessibilityLabel={`${current.label} — open category`}
    >
      {prev !== null && <Image source={slides[prev].source} style={styles.slide} resizeMode="cover" />}
      <Animated.Image source={current.source} style={[styles.slide, { opacity: fade }]} resizeMode="cover" />
      <View style={styles.slideShade} pointerEvents="none" />
      <View style={styles.slideFoot} pointerEvents="none">
        {/* The caption changes once the new photo has faded in, so it
            never names a picture that is not on screen yet. */}
        <Text style={styles.slideLabel}>{slides[prev ?? index].label}</Text>
        <View style={styles.dots}>
          {slides.map((s, i) => (
            <View key={s.route} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
      </View>
    </Pressable>
  );
}

function Countdown({ endsAt }: { endsAt: string }) {
  const urgent = new Date(endsAt).getTime() - Date.now() < 48 * 3_600_000;
  return (
    <View style={[styles.timer, urgent && styles.timerUrgent]}>
      <Ionicons name="time-outline" size={11} color={urgent ? colors.danger : colors.textMuted} />
      <Text style={[styles.timerText, urgent && { color: colors.danger }]}>{endsInLabel(endsAt)}</Text>
    </View>
  );
}

/** Same frame as the real card, so nothing moves when it arrives. */
function Skeleton() {
  return (
    <View style={styles.card} accessibilityLabel="Loading">
      <View style={[styles.bone, { width: 90, height: 18 }]} />
      <View style={[styles.visual, styles.bone]} />
      <View style={[styles.bone, { width: '60%', height: 16 }]} />
      <View style={[styles.bone, { width: '40%', height: 12 }]} />
      <View style={[styles.bone, { width: '90%', height: 20 }]} />
      <View style={[styles.bone, { height: 44, marginTop: spacing.sm }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: 288,
    backgroundColor: colors.page,
    // 20 = useLayout().contentPadding on desktop, so the card's top edge
    // lines up with the first card in the main column.
    paddingTop: 20,
    paddingRight: 20,
    paddingBottom: 20,
  },
  inline: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  card: { gap: spacing.sm },

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minHeight: 20 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgePaid: { borderColor: colors.orange, backgroundColor: '#FDF1E6' },
  badgeHouse: { borderColor: colors.navy, backgroundColor: '#E8EEF8' },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  timerUrgent: { backgroundColor: '#FCEAE8' },
  timerText: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted },

  visual: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  slide: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  // A soft bottom gradient stand-in (no gradient dependency): a dark band
  // the caption can sit on legibly over any photo.
  slideShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '42%',
    backgroundColor: 'rgba(15,30,61,0.45)',
  },
  slideFoot: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  slideLabel: { color: colors.onNavy, fontSize: font.md, fontWeight: '800' },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotOn: { backgroundColor: colors.onNavy, width: 14 },
  visualTile: { backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  monogram: { fontSize: 40, fontWeight: '800', color: colors.onNavy },
  cornerIcon: { position: 'absolute', right: 10, bottom: 8 },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  title: { ...typography.bodyStrong, flexShrink: 1 },
  meta: { ...typography.caption },

  headline: { fontSize: font.lg, fontWeight: '800', color: colors.navy, lineHeight: 22, marginTop: 2 },
  tag: {
    alignSelf: 'flex-start',
    backgroundColor: '#E8EEF8',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tagText: { fontSize: font.xs, fontWeight: '700', color: colors.navy },
  details: { fontSize: font.sm, color: colors.textMuted, lineHeight: 18 },

  cta: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    ...shadow.card,
  },
  ctaPressed: { backgroundColor: colors.orangeDark },
  ctaText: { ...typography.bodyStrong, fontWeight: '700', color: colors.onNavy, textAlign: 'center', flexShrink: 1 },
  linkRow: { alignItems: 'center', minHeight: 20, justifyContent: 'center' },
  linkText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  fine: { ...typography.caption, fontSize: 11, lineHeight: 15 },

  bone: { backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, width: '100%', height: 14 },
});
