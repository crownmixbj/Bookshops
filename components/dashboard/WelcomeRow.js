import { View, Text, Pressable, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, typography, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * Where the store buttons point.
 *
 * Null on purpose. LOCI has a bundle id and an Android package, but
 * neither store listing exists yet, and a button that says "Download on
 * the App Store" and goes nowhere is worse than no button — it is a
 * promise the product cannot keep, made to the person we are asking to
 * trust us with a booklist and a payment.
 *
 * While these are null the buttons render as "Coming soon", muted and
 * unpressable. Paste the real URLs in and they become live links with no
 * other change:
 *
 *   IOS_APP_URL  = 'https://apps.apple.com/app/id0000000000'
 *   ANDROID_APP_URL = 'https://play.google.com/store/apps/details?id=com.crownmixbj.BookShops'
 */
export const IOS_APP_URL = null;
export const ANDROID_APP_URL = null;

/**
 * Greeting on one side, the mobile apps on the other.
 *
 * This replaces a bare line of muted text under the hero. The greeting
 * is the one thing on the page that is different for every person, so it
 * earns a row of its own rather than floating between two cards — and
 * the space to its right was doing nothing, which is where the apps go.
 *
 * The buttons are built from Ionicons glyphs rather than Apple's and
 * Google's official badge artwork. Those badges are trademarked, come
 * with size, spacing and wording rules, and are not ours to redraw; a
 * plain button carrying the platform's logo glyph says the same thing
 * and stays inside the app's own type scale.
 */
export function WelcomeRow({ displayName }) {
  const { isMobile } = useLayout();

  return (
    <View style={[styles.row, isMobile && styles.rowMobile]}>
      <View style={styles.greetingBlock}>
        <Text style={styles.greeting} numberOfLines={1}>
          Welcome back, {displayName}
        </Text>
        <Text style={styles.sub}>Here is what your booklists are doing today.</Text>
      </View>

      <View style={[styles.stores, isMobile && styles.storesMobile]}>
        <Text style={styles.storesLabel}>Get the app</Text>
        <View style={styles.storeButtons}>
          <StoreButton
            icon="logo-apple"
            caption="Download on the"
            name="App Store"
            url={IOS_APP_URL}
          />
          <StoreButton
            icon="logo-google-playstore"
            caption="Get it on"
            name="Google Play"
            url={ANDROID_APP_URL}
          />
        </View>
      </View>
    </View>
  );
}

function StoreButton({ icon, caption, name, url }) {
  const live = typeof url === 'string' && url.length > 0;

  // Not `disabled`, which would make a screen reader announce a dimmed
  // control with no reason. The button is simply not a button yet: it
  // reads as text saying the app is coming.
  if (!live) {
    return (
      <View style={[styles.store, styles.storeSoon]} accessible accessibilityRole="text">
        <Ionicons name={icon} size={19} color={colors.textFaint} />
        <View style={styles.storeText}>
          <Text style={styles.storeCaptionSoon}>Coming soon</Text>
          <Text style={styles.storeNameSoon} numberOfLines={1}>
            {name}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => Linking.openURL(url)}
      style={({ pressed }) => [styles.store, pressed && styles.storePressed]}
      accessibilityRole="link"
      accessibilityLabel={`${caption} ${name}`}
    >
      <Ionicons name={icon} size={19} color={colors.onNavy} />
      <View style={styles.storeText}>
        <Text style={styles.storeCaption}>{caption}</Text>
        <Text style={styles.storeName} numberOfLines={1}>
          {name}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  // Stacked and left-aligned on a phone: a greeting and two buttons in
  // one row at 375px leaves the name truncated and the buttons too
  // narrow to read.
  rowMobile: {
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },

  greetingBlock: { flex: 1, minWidth: 0 },
  greeting: { ...typography.cardTitle },
  sub: { ...typography.body, marginTop: 2 },

  stores: { alignItems: 'flex-end' },
  storesMobile: { alignItems: 'stretch' },
  storesLabel: {
    ...typography.caption,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  storeButtons: { flexDirection: 'row', gap: spacing.sm },

  store: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    minWidth: 132,
  },
  storePressed: { backgroundColor: colors.navyDark },
  storeSoon: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  storeText: { minWidth: 0 },
  storeCaption: { fontSize: 9, color: 'rgba(255,255,255,0.72)', letterSpacing: 0.3 },
  storeName: { fontSize: font.md, fontWeight: '700', color: colors.onNavy, marginTop: -1 },
  storeCaptionSoon: { fontSize: 9, color: colors.textFaint, letterSpacing: 0.3 },
  storeNameSoon: { fontSize: font.md, fontWeight: '700', color: colors.textMuted, marginTop: -1 },
});
