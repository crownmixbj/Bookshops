import { ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, spacing, radius, font } from '../../theme';

/**
 * The small pieces every vendor workspace screen repeats: the role gate,
 * the page heading, the filter pills, the "run this migration" panel and
 * the inline error/notice rows.
 *
 * Pulled out when Orders, Messaging and Analytics arrived together —
 * three more copies of the same gate and the same pill styles is how the
 * screens would start to drift apart.
 */

/** Shown to anyone who is not a vendor. `/vendor/*` sits outside the auth group. */
export function VendorGate({ area }: { area: string }) {
  return (
    <View style={styles.gate}>
      <Ionicons name="lock-closed-outline" size={30} color={colors.textFaint} />
      <Text style={styles.gateTitle}>This area is for bookshops</Text>
      <Text style={styles.gateBody}>{area} is part of the vendor console.</Text>
      <Pressable
        onPress={() => router.replace('/')}
        style={({ pressed }) => [styles.gateBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.gateBtnText}>Back to my dashboard</Text>
      </Pressable>
    </View>
  );
}

export function PageHeading({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.heading}>
      <View style={styles.headingText}>
        <Text style={styles.h1} accessibilityRole="header">
          {title}
        </Text>
        {!!subtitle && <Text style={styles.h2}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

export interface PillOption<K extends string> {
  key: K;
  label: string;
  count?: number;
}

/** A horizontally scrolling row of filter pills, one selected. */
export function FilterPills<K extends string>({
  options,
  value,
  onChange,
}: {
  options: PillOption<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.pills}
      style={styles.pillsScroll}
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={({ pressed }) => [styles.pill, on && styles.pillOn, pressed && !on && styles.pressed]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.pillText, on && styles.pillTextOn]}>{o.label}</Text>
            {o.count !== undefined && (
              <View style={[styles.pillCount, on && styles.pillCountOn]}>
                <Text style={[styles.pillCountText, on && styles.pillCountTextOn]}>{o.count}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A feature whose SQL has not been run yet. Says which file, and offers a retry. */
export function MigrationNeeded({
  feature,
  file,
  onRetry,
}: {
  feature: string;
  file: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.setup}>
      <Ionicons name="server-outline" size={26} color={colors.warning} />
      <Text style={styles.setupTitle}>{feature} is not set up yet</Text>
      <Text style={styles.setupBody}>
        This page needs database functions that do not exist yet. Run{' '}
        <Text style={styles.code}>{file}</Text> in the Supabase SQL editor, then check again.
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [styles.gateBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.gateBtnText}>Check again</Text>
      </Pressable>
    </View>
  );
}

export function InlineMessage({
  tone,
  children,
}: {
  tone: 'error' | 'info' | 'success';
  children: ReactNode;
}) {
  const t = TONES[tone];
  return (
    <View style={[styles.msg, { backgroundColor: t.bg }]} accessibilityLiveRegion="polite">
      <Ionicons name={t.icon} size={16} color={t.fg} />
      <Text style={[styles.msgText, { color: tone === 'info' ? colors.text : t.fg }]}>{children}</Text>
    </View>
  );
}

const TONES = {
  error: { bg: '#FDF2F1', fg: colors.danger, icon: 'alert-circle' as const },
  info: { bg: colors.surfaceMuted, fg: colors.navy, icon: 'information-circle' as const },
  success: { bg: '#EDF7F1', fg: colors.success, icon: 'checkmark-circle' as const },
};

/** A coloured status pill. Label always present — never colour alone. */
export function StatusPill({
  label,
  fg,
  bg,
  icon,
}: {
  label: string;
  fg: string;
  bg: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={[styles.status, { backgroundColor: bg }]}>
      {!!icon && <Ionicons name={icon} size={12} color={fg} />}
      <Text style={[styles.statusText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** "3 Sep" this year, "3 Sep 2025" otherwise. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "14:05" today, "Yesterday", "Mon" this week, else a short date. */
export function relativeStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (t >= startOfToday - 86400000) return 'Yesterday';
  if (t >= startOfToday - 6 * 86400000) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return shortDate(iso);
}

export const pageStyles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },
  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
});

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  gateTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  gateBody: { fontSize: font.md, color: colors.textMuted, textAlign: 'center' },
  gateBtn: {
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  gateBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },

  heading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headingText: { flex: 1, minWidth: 200 },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  pillsScroll: { flexGrow: 0 },
  pills: { gap: spacing.sm, paddingBottom: spacing.lg, paddingRight: spacing.lg },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    minHeight: 40,
  },
  pillOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  pillText: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  pillTextOn: { color: colors.onNavy },
  pillCount: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    minWidth: 20,
    paddingHorizontal: 5,
    alignItems: 'center',
  },
  pillCountOn: { backgroundColor: colors.navyLight },
  pillCountText: { fontSize: font.xs, fontWeight: '800', color: colors.textMuted },
  pillCountTextOn: { color: colors.onNavy },

  setup: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  setupTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  setupBody: { fontSize: font.md, color: colors.textMuted, lineHeight: 21 },
  code: { fontWeight: '700', color: colors.text },

  msg: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  msgText: { flex: 1, fontSize: font.sm, lineHeight: 18 },

  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
  },
  statusText: { fontSize: font.xs, fontWeight: '800' },
});
