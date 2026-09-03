import { View, StyleSheet } from 'react-native';
import { Slot } from 'expo-router';
import { AuthHeader } from '../../components/auth/AuthHeader';
import { AuthFooter } from '../../components/auth/AuthFooter';
import { colors } from '../../theme';

/**
 * Chrome for the signed-out routes.
 *
 * Three rows, and only the middle one flexes:
 *
 *   AuthHeader   natural height   LOCI, and the way back out
 *   <Slot/>      flex: 1          the screen, which centres its own card
 *   AuthFooter   natural height   one line of legal
 *
 * Because the footer is a sibling of the slot rather than the last thing
 * inside the screen's scroll view, the slot's height is genuinely
 * "window minus the two bands" — so a card centred inside it lands on
 * the optical centre of the window, at any window height, without a
 * tall footer dragging it upwards.
 *
 * There is no SafeAreaView here on purpose. It would inset the two bands
 * and leave page-coloured strips above the header and below the footer;
 * instead each band applies the insets to its own padding, so the colour
 * runs to the edge of the display and the text still clears the notch.
 *
 * The root layout renders the auth group without AppShell, so this is
 * the only chrome here — there is no second header underneath.
 */
export default function AuthLayout() {
  return (
    <View style={styles.page}>
      <AuthHeader />
      {/* minHeight: 0 lets this actually shrink inside the flex column.
          Without it a tall scroll child can push the footer off the
          bottom of the window on web. */}
      <View style={styles.body}>
        <Slot />
      </View>
      <AuthFooter />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  body: { flex: 1, minWidth: 0, minHeight: 0 },
});
