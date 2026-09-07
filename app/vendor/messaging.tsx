import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../../theme';

/**
 * Renamed to /vendor/messages.
 *
 * Kept as a redirect rather than deleted: this path is in browser
 * histories and bookmarks, and removing the file would land anyone
 * holding one on expo-router's "Unmatched Route" page.
 *
 * `replace`, not `push`, so Back returns where the vendor actually came
 * from instead of bouncing through here again.
 */
export default function VendorMessagingRedirect() {
  useEffect(() => {
    router.replace('/vendor/messages');
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
