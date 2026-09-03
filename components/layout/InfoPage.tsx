import type { ReactNode } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, spacing, radius, font } from '../../theme';
import { useLayout } from '../../hooks/useLayout';
import { Footer } from './Footer';
import { useShell } from './ShellContext';

interface InfoPageProps {
  /** Small label above the title: 'Services', 'About', 'Legal'. */
  eyebrow: string;
  title: string;
  /** One sentence saying what the page will cover. */
  summary: string;
  children?: ReactNode;
}

/**
 * The shell every footer destination shares.
 *
 * These pages exist because the footer links to them. A link that lands
 * on Expo Router's "Unmatched Route" screen is worse than no link, so
 * each one gets a real route — but the copy is genuinely not written
 * yet, and the page says so rather than inventing terms, a refund window
 * or a cookie disclosure that nobody has approved.
 *
 * Reachable signed out: app/_layout.js treats these groups as public.
 */
export function InfoPage({ eyebrow, title, summary, children }: InfoPageProps) {
  const { isMobile, contentPadding } = useLayout();
  const { insideShell } = useShell();

  // Signed in, AppShell wraps this and owns the safe area. Signed out
  // there is no shell, so the page has to inset itself or the content
  // slides under the notch. Nesting two SafeAreaViews would pad twice.
  const Frame = insideShell ? PlainFrame : SafeAreaFrame;

  return (
    <Frame>
      <ScrollView contentContainerStyle={[styles.scroll, { padding: contentPadding }]}>
        <View style={[styles.column, isMobile && styles.columnMobile]}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            hitSlop={8}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={16} color={colors.navy} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          <View style={styles.card}>
            <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.summary}>{summary}</Text>

            <View style={styles.pending}>
              <Ionicons name="document-text-outline" size={16} color={colors.warning} />
              <Text style={styles.pendingText}>
                This page has no content yet. The route and the layout are in place so the footer
                link works; the wording still needs to be written and, for the legal pages,
                reviewed before launch.
              </Text>
            </View>

            {children}
          </View>

          <Footer />
        </View>
      </ScrollView>
    </Frame>
  );
}

function SafeAreaFrame({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {children}
    </SafeAreaView>
  );
}

function PlainFrame({ children }: { children: ReactNode }) {
  return <View style={styles.safe}>{children}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  scroll: { flexGrow: 1, alignItems: 'center' },
  // Long-form reading measure, centred, exactly like the auth card.
  column: { width: '100%', maxWidth: 820 },
  columnMobile: { maxWidth: '100%' },

  back: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.lg },
  backText: { fontSize: font.md, fontWeight: '700', color: colors.navy },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  eyebrow: { fontSize: font.xs, fontWeight: '800', color: colors.textFaint, letterSpacing: 0.7 },
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
});
