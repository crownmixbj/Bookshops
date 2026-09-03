import type { ReactNode } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '../../theme';
import { Skeleton } from '../vendor/PayoutParts';

/**
 * The bits every admin management screen repeats: a row of counters, a
 * strip of filter tabs, a search box, status pills and a table shell.
 *
 * Pulled out after the third screen copied the same 200 lines of styles.
 * One definition means the tables actually match rather than drifting a
 * pixel at a time.
 */

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONE_FG: Record<Tone, string> = {
  neutral: colors.text,
  good: colors.success,
  warn: colors.warning,
  bad: colors.danger,
  info: colors.navy,
};

const TONE_BG: Record<Tone, string> = {
  neutral: colors.surfaceMuted,
  good: '#EDF7F1',
  warn: colors.warningBg,
  bad: '#FDF2F1',
  info: '#E7EDF7',
};

export function StatTile({
  label, value, tone = 'neutral', loading, hint,
}: { label: string; value: string | number; tone?: Tone; loading: boolean; hint?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      {loading ? (
        <Skeleton width={70} height={26} />
      ) : (
        <Text style={[styles.tileValue, { color: TONE_FG[tone] }]}>{value}</Text>
      )}
      {!!hint && !loading && <Text style={styles.tileHint}>{hint}</Text>}
    </View>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <View style={styles.tiles}>{children}</View>;
}

export function Badge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <View style={[styles.badge, { backgroundColor: TONE_BG[tone] }]}>
      <Text style={[styles.badgeText, { color: TONE_FG[tone] }]}>{label}</Text>
    </View>
  );
}

export function Tabs<T extends string>({
  tabs, value, onChange,
}: { tabs: { key: T; label: string }[]; value: T; onChange: (key: T) => void }) {
  return (
    <View style={styles.tabs}>
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && !active && styles.tabPressed]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t.label}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SearchBox({
  value, onChange, placeholder, label,
}: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <View style={styles.searchBox}>
      <Ionicons name="search" size={14} color={colors.textFaint} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        style={styles.searchInput}
        accessibilityLabel={label}
      />
    </View>
  );
}

export function TableSkeleton() {
  return (
    <View style={styles.pad}>
      <Skeleton width="100%" height={18} />
      <Skeleton width="90%" height={18} />
      <Skeleton width="95%" height={18} />
    </View>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <View style={styles.pad}>
      <Text style={styles.empty}>{children}</Text>
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.errorBox}>
      <Ionicons name="alert-circle" size={16} color={colors.danger} />
      <Text style={styles.errorText}>{message}</Text>
      {!!onRetry && (
        <Pressable onPress={onRetry} hitSlop={6} accessibilityRole="button">
          <Text style={styles.retry}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

export function InfoBanner({ children, tone = 'warn' }: { children: ReactNode; tone?: Tone }) {
  return (
    <View style={[styles.infoBox, { backgroundColor: TONE_BG[tone] }]}>
      <Ionicons name="information-circle-outline" size={16} color={TONE_FG[tone]} />
      <Text style={styles.infoText}>{children}</Text>
    </View>
  );
}

/** A horizontal bar for "share of total" comparisons. */
export function ShareBar({ label, value, total, display }: {
  label: string; value: number; total: number;
  /** What to print on the right; defaults to the raw number. Money
   *  needs formatNaira, counts do not. */
  display?: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <View style={styles.share}>
      <View style={styles.shareHead}>
        <Text style={styles.shareLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.shareValue}>{display ?? value}</Text>
      </View>
      <View style={styles.shareTrack}>
        <View style={[styles.shareFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

export const tableStyles = StyleSheet.create({
  th: { backgroundColor: colors.surfaceMuted, borderBottomWidth: 1, borderBottomColor: colors.border },
  thText: { fontSize: font.xs, fontWeight: '800', color: colors.textFaint, textTransform: 'uppercase' },
  tr: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  cell: { fontSize: font.md, color: colors.text },
  subtle: { fontSize: font.xs, color: colors.textFaint },
  strong: { fontSize: font.md, fontWeight: '700', color: colors.text },
  link: { color: colors.navy, textDecorationLine: 'underline' },
  mono: { fontSize: font.sm, color: colors.textMuted, letterSpacing: 0.3 },
  actions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong,
    backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: 6,
  },
  btnText: { color: colors.navy, fontSize: font.sm, fontWeight: '700' },
  btnGo: { backgroundColor: colors.navy, borderColor: colors.navy },
  btnGoText: { color: colors.onNavy, fontSize: font.sm, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  mRow: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 5,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  mTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  mMeta: { fontSize: font.sm, color: colors.textMuted },
});

/** Page chrome shared by all four screens. */
export const pageStyles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingBottom: spacing.xxl },
  heading: { marginBottom: spacing.lg },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl },
  gateTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  gateBtn: { backgroundColor: colors.navy, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  gateBtnText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  panelBody: { padding: spacing.lg, gap: spacing.md },
});

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginBottom: spacing.lg },
  tile: {
    flexGrow: 1, flexBasis: 160, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm,
  },
  tileLabel: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  tileValue: { fontSize: 24, fontWeight: '800' },
  tileHint: { fontSize: font.xs, color: colors.textFaint, lineHeight: 15 },

  badge: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 },
  badgeText: { fontSize: font.xs, fontWeight: '800' },

  tabs: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tab: {
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 5,
  },
  tabActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  tabPressed: { backgroundColor: colors.surfaceMuted },
  tabText: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted },
  tabTextActive: { color: colors.onNavy, fontWeight: '700' },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, height: 32, minWidth: 190,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: font.sm, color: colors.text },

  pad: { padding: spacing.lg, gap: spacing.md },
  empty: { fontSize: font.sm, color: colors.textFaint, lineHeight: 19 },

  errorBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: '#FDF2F1', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger },
  retry: { fontSize: font.sm, fontWeight: '800', color: colors.navy },
  infoBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start',
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  infoText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 18 },

  share: { gap: 5 },
  shareHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  shareLabel: { flex: 1, fontSize: font.md, color: colors.text },
  shareValue: { fontSize: font.md, fontWeight: '700', color: colors.text },
  shareTrack: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  shareFill: { height: 6, borderRadius: 3, backgroundColor: colors.orange },
});
