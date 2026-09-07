import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { colors, spacing, font } from '../../theme';

/**
 * Keeps an old admin URL working after the section was renamed.
 *
 * The console's paths were reordered to match how the marketplace is
 * actually operated, which moved three of them. A bookmark, a link in
 * an email, or the admin landing route pointing at the old path would
 * otherwise land on Expo Router's "Unmatched Route" screen — so each
 * old path keeps a file that replaces itself with the new one.
 *
 * `replace`, not `push`: the old URL should not sit in the back stack,
 * or Back from the new screen returns here and bounces forward again.
 */
export function AdminRedirect({ to, label }: { to: Parameters<typeof router.replace>[0]; label: string }) {
  useEffect(() => {
    router.replace(to);
  }, [to]);

  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={colors.navy} />
      <Text style={styles.text}>Taking you to {label}…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  text: { fontSize: font.md, color: colors.textMuted },
});
