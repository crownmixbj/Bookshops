import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../../theme';

/**
 * Vendor settings live in the shared /settings screen, which already
 * branches on role and holds the store fields — name, address, city,
 * busy mode — alongside the account and notification settings every
 * role has.
 *
 * This route exists so the vendor sidebar can point at /vendor/settings
 * as specced without a second copy of the store form. Two screens
 * editing vendors.address is how the two end up disagreeing.
 */
export default function VendorSettingsRedirect() {
  useEffect(() => {
    router.replace('/settings');
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
