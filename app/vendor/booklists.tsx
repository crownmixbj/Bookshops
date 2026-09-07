import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../../theme';

/**
 * My Booklists became Requests & Quotes — the sent quotes are a tab there now, beside the incoming queue.
 *
 * Kept as a redirect rather than deleted: this path is in browser
 * histories and bookmarks, and removing the file would land anyone
 * holding one on expo-router's "Unmatched Route" page.
 *
 * `replace`, not `push`, so Back returns where the vendor actually came
 * from instead of bouncing through here again.
 */
export default function VendorBooklistsRedirect() {
  useEffect(() => {
    router.replace('/vendor/quotes');
  }, []);

  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={colors.navy} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
