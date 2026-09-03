import type { ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Footer } from '../layout/Footer';
import { useLayout } from '../../hooks/useLayout';
import { colors, spacing, radius, font, shadow } from '../../theme';

/**
 * The frame the buyer's detail screens share.
 *
 * These routes are opened from a card on the Booklist Hub, so every one
 * of them needs the same three things: a way back, a title that says
 * what you opened, and one reading column rather than a full-width
 * sprawl. AppShell already supplies the header, sidebar and safe area —
 * this is only the page body.
 */
export function BuyerPage({
  title,
  subtitle,
  eyebrow,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const { contentPadding, isMobile } = useLayout();

  return (
    <ScrollView contentContainerStyle={[styles.scroll, { padding: contentPadding }]}>
      <View style={styles.column}>
        <Pressable
          // canGoBack is false on a cold load of a deep link — a shared
          // URL, or a refresh — where there is no history to pop. The
          // hub is the right home for every one of these screens.
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={8}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={16} color={colors.navy} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>

        <View style={[styles.head, isMobile && styles.headStacked]}>
          <View style={styles.headText}>
            {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>}
            <Text style={styles.title}>{title}</Text>
            {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
          {right}
        </View>

        <View style={styles.body}>{children}</View>

        <Footer />
      </View>
    </ScrollView>
  );
}

/** Grey block standing in for content that is still loading. */
export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: any }) {
  return <View style={[styles.skeleton, { height, width }]} />;
}

/** A query that failed, with the reason and a way to try again. */
export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.error}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
      <View style={styles.errorText}>
        <Text style={styles.errorTitle}>This did not load</Text>
        <Text style={styles.errorBody}>{message}</Text>
      </View>
      {!!onRetry && (
        <Pressable
          onPress={onRetry}
          style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * A screen that exists so a link works, but whose content the data model
 * cannot support yet.
 *
 * It names what is missing rather than showing an empty state, because
 * an empty state reads as "you have nothing here" when the truth is
 * "this was never built".
 */
export function NotBuiltPanel({ what, missing }: { what: string; missing: string[] }) {
  return (
    <View style={styles.pending}>
      <View style={styles.pendingHead}>
        <Ionicons name="construct-outline" size={18} color={colors.warning} />
        <Text style={styles.pendingTitle}>{what}</Text>
      </View>
      <Text style={styles.pendingBody}>Before this screen can show anything real it needs:</Text>
      {missing.map((m) => (
        <View key={m} style={styles.pendingRow}>
          <Text style={styles.bullet}>•</Text>
          <Text style={styles.pendingItem}>{m}</Text>
        </View>
      ))}
    </View>
  );
}

/** White panel, matching the hub's cards. */
export function Panel({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.panel}>
      {(title || right) && (
        <View style={styles.panelHead}>
          {title ? <Text style={styles.panelTitle}>{title}</Text> : <View />}
          {right}
        </View>
      )}
      <View style={styles.panelBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, alignItems: 'center' },
  column: { width: '100%', maxWidth: 900 },

  back: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.lg, alignSelf: 'flex-start' },
  backPressed: { opacity: 0.6 },
  backText: { fontSize: font.md, fontWeight: '700', color: colors.navy },

  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md },
  headStacked: { flexDirection: 'column', alignItems: 'stretch' },
  headText: { flex: 1, minWidth: 0 },
  eyebrow: { fontSize: font.xs, fontWeight: '800', color: colors.textFaint, letterSpacing: 0.7 },
  title: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: font.md, color: colors.textMuted, marginTop: 2, lineHeight: 20 },
  body: { gap: spacing.lg, marginTop: spacing.lg },

  skeleton: { backgroundColor: colors.surfaceMuted, borderRadius: radius.sm },

  error: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: '#FDECEA', borderRadius: radius.md, padding: spacing.md,
  },
  errorText: { flex: 1, minWidth: 0 },
  errorTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  errorBody: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
  retry: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  retryPressed: { backgroundColor: colors.surfaceMuted },
  retryText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },

  pending: { backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  pendingHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 2 },
  pendingTitle: { flex: 1, fontSize: font.lg, fontWeight: '700', color: colors.text },
  pendingBody: { fontSize: font.md, color: colors.text, lineHeight: 20, marginBottom: spacing.xs },
  pendingRow: { flexDirection: 'row', gap: spacing.sm, paddingLeft: 2 },
  bullet: { fontSize: font.md, color: colors.warning },
  pendingItem: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 19 },

  panel: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadow.card },
  panelHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm,
  },
  panelTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  panelBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
});
