import type { ReactNode } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

/**
 * The width a form is allowed to grow to.
 *
 * An unconstrained form on a 1440px monitor produces input boxes a metre
 * wide, which is both ugly and genuinely harder to read: the eye loses
 * the line between the label and the value. ~420px keeps a text field at
 * a comfortable measure and is the width people expect a sign-in card to
 * be.
 */
export const AUTH_MAX_WIDTH = 420;

interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Rendered under the card — the "no account yet?" line. */
  footer?: ReactNode;
}

/**
 * Page chrome shared by every auth route.
 *
 * This renders the card and nothing else: the header and the footer band
 * are mounted once by app/auth/_layout.tsx, above and below the router
 * slot. That split is what makes the card sit on the true optical centre
 * of the window.
 *
 * The centring, and why it is flex rather than a CSS unit:
 *
 *   #root (Expo's web template: height 100%, display flex, flex 1)
 *     └ auth layout   flex: 1
 *         ├ AuthHeader          — natural height
 *         ├ slot        flex: 1 — everything left over
 *         │   └ this ScrollView            flex: 1
 *         │       └ contentContainer  flexGrow: 1, justifyContent: center
 *         └ AuthFooter          — natural height
 *
 * An unbroken flex:1 chain from a full-height root is exactly what
 * minHeight: 100vh buys on the web, and unlike a vh unit it is a real
 * value on iOS and Android too. flexGrow (not flex) on the content
 * container is the load-bearing part: the container is at least as tall
 * as the scroll viewport, so justifyContent centres the card when there
 * is room, and it grows and scrolls normally when the form is taller
 * than the window instead of clipping the top off.
 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  const { isMobile } = useLayout();
  const insets = useSafeAreaInsets();

  const gutter = isMobile ? spacing.lg : spacing.xxl;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      // Only iOS needs this. Android handles it with windowSoftInputMode
      // and on web it would fight the browser.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.page}
        contentContainerStyle={[
          styles.scroll,
          // The layout has no SafeAreaView — the chrome bands run edge to
          // edge on purpose — so the readable content insets itself, or a
          // landscape notch clips the card.
          { paddingLeft: gutter + insets.left, paddingRight: gutter + insets.right },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.column}>
          <View style={[styles.card, { padding: isMobile ? spacing.lg : spacing.xl }]}>
            <Text style={styles.title}>{title}</Text>
            {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            <View style={styles.body}>{children}</View>
          </View>

          {!!footer && <View style={styles.footer}>{footer}</View>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: colors.page },
  scroll: {
    // flexGrow (not flex) so the content fills the screen when it is
    // shorter and scrolls normally when it is taller.
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  column: { width: '100%', maxWidth: AUTH_MAX_WIDTH },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  title: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: font.md, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 20 },
  body: { marginTop: spacing.xl, gap: spacing.lg },

  footer: { marginTop: spacing.xl, alignItems: 'center' },
});
