import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, spacing, radius, font } from '../../theme';
import { useLayout } from '../../hooks/useLayout';
import { useShell } from './ShellContext';
import { Footer } from './Footer';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** One sentence on what this screen will show once it is built. */
  summary: string;
  /** Whose console this screen belongs to; anyone else is refused. */
  audience: 'vendor' | 'admin';
}

/**
 * A screen that exists as a route but not yet as a feature.
 *
 * The sidebar links used to be inert — they looked like navigation and
 * did nothing, which is the worst of both worlds. These give each one a
 * real destination that says plainly what is not built yet, so the menu
 * behaves the way it looks.
 *
 * It also gates on role. `/vendor/*` sits outside the auth group, so a
 * signed-in buyer could otherwise open a vendor screen just by typing
 * the URL. Nothing sensitive is exposed here yet, but the gate belongs
 * in place before there is.
 */
export function RolePlaceholder({ icon, title, summary, audience }: Props) {
  const { contentPadding } = useLayout();
  const { role } = useShell();

  if (role !== audience) {
    return (
      <View style={styles.gate}>
        <Ionicons name="lock-closed-outline" size={30} color={colors.textFaint} />
        <Text style={styles.gateTitle}>
          {audience === 'vendor' ? 'This area is for bookshops' : 'This area is for administrators'}
        </Text>
        <Text style={styles.gateBody}>
          {title} is part of the {audience === 'vendor' ? 'vendor' : 'admin'} console. Your account is
          signed in as a {role === 'admin' ? 'administrator' : role === 'vendor' ? 'bookshop' : 'buyer'}.
        </Text>
        <Pressable
          onPress={() => router.replace(role === 'admin' ? '/admin' : role === 'vendor' ? '/vendor' : '/')}
          style={({ pressed }) => [styles.gateBtn, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.gateBtnText}>Back to my dashboard</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={22} color={colors.navy} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.summary}>{summary}</Text>

        <View style={styles.pending}>
          <Ionicons name="construct-outline" size={16} color={colors.warning} />
          <Text style={styles.pendingText}>
            Not built yet. The route exists so the sidebar link works and the page you are on is
            highlighted; the screen itself still needs building.
          </Text>
        </View>

        <Pressable
          onPress={() => router.push(audience === 'vendor' ? '/vendor' : '/admin')}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Ionicons name="arrow-back" size={15} color={colors.navy} />
          <Text style={styles.linkText}>
            {audience === 'vendor' ? 'Back to the request queue' : 'Back to the control centre'}
          </Text>
        </Pressable>
      </View>

      <Footer audience={audience} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  summary: { fontSize: font.lg, color: colors.textMuted, lineHeight: 24 },

  pending: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  pendingText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 18 },

  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.lg },
  linkText: { fontSize: font.md, fontWeight: '700', color: colors.navy },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  gateTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text, textAlign: 'center' },
  gateBody: { fontSize: font.md, color: colors.textMuted, textAlign: 'center', maxWidth: 420, lineHeight: 21 },
  gateBtn: {
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  gateBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  pressed: { opacity: 0.85 },
});
