import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../../theme';

/**
 * Saved Shops used to be a screen. It is a tab inside Bookshops now — a
 * shortlist of shops is a filter over the directory, not a different
 * place to be.
 *
 * This file stays behind as a redirect rather than being deleted:
 * /saved is in browser histories, in bookmarks, and hardcoded in a few
 * older screens' navigation maps. Deleting it would land those on
 * expo-router's "Unmatched Route" page.
 *
 * `replace`, not `push`, so the back button returns to wherever the
 * buyer actually came from instead of bouncing through here again.
 */
export default function SavedShopsRedirect() {
  useEffect(() => {
    router.replace('/shops');
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
