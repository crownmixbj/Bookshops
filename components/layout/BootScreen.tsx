import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '../../theme';

/** Every full-screen state is centred inside this, so a line of text
 *  never runs the full width of a monitor. */
const CONTENT_MAX_WIDTH = 460;

/**
 * The screen shown while the app works out who you are.
 *
 * It stays deliberately quiet: a spinner with no caption for the instant
 * before the session resolves, and a caption only once we know there is
 * a session to resolve. Announcing "Signing you in…" to someone who is
 * signed out would be a lie, and the flicker of a message that appears
 * and vanishes reads as a glitch.
 */
export function BootScreen({ message }: { message?: string }) {
  return (
    <View style={styles.page}>
      <View style={styles.content}>
        <ActivityIndicator size="large" color={colors.navy} />
        {!!message && <Text style={styles.message}>{message}</Text>}
      </View>
    </View>
  );
}

/**
 * Shown when the bundle was built without Supabase credentials.
 *
 * `EXPO_PUBLIC_*` variables are inlined at BUILD time, so a build host
 * without them bakes `undefined` into the bundle and createClient throws
 * while the module is still loading — which React cannot catch, and
 * which used to render as a plain white page. This screen is the whole
 * reason utils/supabase.js falls back to placeholder credentials instead
 * of throwing: something has to survive long enough to explain.
 */
export function ConfigErrorScreen({ missing }: { missing: string[] }) {
  const plural = missing.length > 1;

  return (
    <View style={styles.page}>
      <View style={styles.content}>
        <View style={styles.badge}>
          <Ionicons name="warning-outline" size={22} color={colors.warning} />
        </View>

        <Text style={styles.title}>This build is missing its configuration</Text>

        <View style={styles.varList}>
          {missing.map((name) => (
            <Text key={name} style={styles.varName}>
              {name}
            </Text>
          ))}
        </View>

        <Text style={styles.body}>
          {plural ? 'These are' : 'This is'} baked in when the app is built, so{' '}
          {plural ? 'they' : 'it'} must be set on the build host — for Cloudflare Pages that is
          Settings → Variables and Secrets, for both Production and Preview — and the site
          redeployed. A local .env only affects local builds.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.page,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
  },
  content: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignItems: 'center', gap: spacing.md },
  message: { fontSize: font.md, color: colors.textMuted },

  badge: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.warningBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: font.xl, fontWeight: '800', color: colors.text, textAlign: 'center' },
  varList: { gap: spacing.xs, alignItems: 'center' },
  varName: {
    fontSize: font.md,
    fontWeight: '700',
    color: colors.danger,
    textAlign: 'center',
  },
  body: {
    fontSize: font.md,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
  },
});
