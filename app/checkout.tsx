import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { BuyerPage, Panel, NotBuiltPanel } from '../components/buyer/BuyerPage';
import { colors, spacing, radius, font } from '../theme';

/**
 * Checkout.
 *
 * The route exists so "Proceed to Secure Payment" goes somewhere, and
 * the screen is explicit that it cannot take money, because a checkout
 * that looks real and is not is the single worst thing to fake.
 *
 * What IS in place: `orders` has an `orders_insert_own` policy, an
 * `amount` column and the delivery fields, so an order row can be
 * written once there is a payment to write it against. What is missing
 * is the payment itself — no Paystack keys, no initialise call, no
 * webhook to confirm a charge — and a way to pick which quote is being
 * accepted. The hub's total is computed from the ticked lines of a
 * booklist request, not from an accepted quote, so there is no priced
 * agreement to charge for.
 */
export default function CheckoutScreen() {
  return (
    <BuyerPage
      eyebrow="Checkout"
      title="Payment is not connected yet"
      subtitle="Nothing has been charged and no order has been placed."
    >
      <View style={styles.stop}>
        <Ionicons name="shield-outline" size={18} color={colors.danger} />
        <Text style={styles.stopText}>
          This screen deliberately does not take card details. Until the payment provider is wired
          up, any form here would be collecting money it cannot process.
        </Text>
      </View>

      <NotBuiltPanel
        what="What checkout still needs"
        missing={[
          'A payment provider. Paystack is the intended rail for Naira but no keys, initialise call or webhook exist yet.',
          'A selected quote. Today the hub totals the ticked lines of a booklist request, which is a wish list, not a price a shop has agreed to.',
          'Delivery details on the order. The columns are there (delivery_name, phone, address, city) and the profile already stores defaults — they just need collecting here.',
        ]}
      />

      <Panel title="What already works">
        <Text style={styles.body}>
          Accepting a quote and recording an order is close: `orders` has an insert policy for the
          buyer, an `amount` column and every delivery field. The missing piece is the charge, not
          the record.
        </Text>
      </Panel>

      <View style={styles.actions}>
        <Pressable
          onPress={() => router.replace('/')}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Back to Booklist Hub</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/orders')}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>See my orders</Text>
        </Pressable>
      </View>
    </BuyerPage>
  );
}

const styles = StyleSheet.create({
  stop: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: '#FDECEA', borderRadius: radius.md, padding: spacing.lg,
  },
  stopText: { flex: 1, fontSize: font.md, color: colors.text, lineHeight: 20 },
  body: { fontSize: font.md, color: colors.text, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  secondary: {
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong,
    backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: 12,
  },
  secondaryPressed: { backgroundColor: colors.surfaceMuted },
  secondaryText: { fontSize: font.md, fontWeight: '700', color: colors.navy },
});
