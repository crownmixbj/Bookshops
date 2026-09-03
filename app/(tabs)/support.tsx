import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { Footer } from '../../components/layout/Footer';
import { useShell } from '../../components/layout/ShellContext';
import { useLayout } from '../../hooks/useLayout';
import { useOrders } from '../../hooks/useOrders';
import { SUPPORT, SUPPORT_TEL, supportMailto } from '../../lib/support';
import { colors, spacing, radius, font, shadow } from '../../theme';
import type { OrderView } from '../../types/db';

/**
 * Help & Support.
 *
 * HONEST STATE OF THIS SCREEN: there is no ticketing backend. The schema
 * has no support_tickets table, so nothing here can create a ticket the
 * buyer could come back and track.
 *
 * Rather than render a form that accepts a complaint and drops it — the
 * worst possible outcome for someone whose order has gone wrong — every
 * action on this page ends somewhere a human actually reads: the support
 * line, or a pre-filled email carrying the order's reference so the team
 * can find it without asking. The same choice SupportDrawer already made.
 *
 * TODO(backend): to make disputes trackable in-app, add `support_tickets`
 * (id, buyer_id, order_id, subject, body, status) and `support_messages`
 * with RLS scoping rows to their owner, plus an admin queue to answer
 * them. app/admin/support.tsx is already the place that would list them.
 * This screen's layout does not change; only `openDispute` does.
 */

interface Faq {
  q: string;
  a: string;
}

/**
 * The questions buyers actually arrive with, in the order they arrive:
 * quotes first (the top of the funnel), then delivery, then money.
 */
const FAQS: Faq[] = [
  {
    q: 'How long until shops quote my booklist?',
    a: 'Most open-market lists get their first quote within a day, and several within two. If a list has had no quotes after 48 hours, check that it has actually been published — a draft sits in My Booklists and no shop can see it.',
  },
  {
    q: 'I sent my list to one shop and nobody else replied.',
    a: 'That is how a direct request works: only the shop you picked can see it. To open it up, edit the list and send it to the open marketplace instead, and every verified shop will be able to quote.',
  },
  {
    q: 'Can I change a booklist after sending it?',
    a: 'Yes — open it from My Booklists and press Edit List. Do it before you accept a quote: a shop that has already priced your list is pricing the version it saw, so large changes are better sent as a new list.',
  },
  {
    q: 'A book on my list is the wrong edition.',
    a: 'Edit the line and add the author or publisher. On Nigerian school lists that is what separates two editions of the same title, and it is the single most useful thing you can give a shop.',
  },
  {
    q: 'How long does delivery take?',
    a: 'Delivery times are set by the shop, not by LOCI, and are quoted with the price. Track any order from My Orders — it moves through Processing, Ready, Dispatched and Delivered, and the shop adds tracking details where they have them.',
  },
  {
    q: 'My order says delivered but nothing arrived.',
    a: 'Use "Report a problem with an order" below. Send it the same day if you can — it reaches the team with your order reference attached, which is what lets them chase the shop straight away.',
  },
  {
    q: 'Can I pay part now and part on delivery?',
    a: 'No. An order is paid in full when you accept a quote, which is what protects both sides — the shop knows the books are sold before buying them in, and your money is tied to a specific order.',
  },
  {
    q: 'How do refunds work?',
    a: 'If a shop cannot fulfil an order after payment, it is cancelled and refunded to the account you paid from. Report anything unresolved after seven days below.',
  },
];

export default function SupportScreen() {
  const { contentPadding, isMobile } = useLayout();
  const { displayName } = useShell();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [pickingOrder, setPickingOrder] = useState(false);

  const { orders, loading } = useOrders();

  /**
   * Opens a mail addressed to support with the order's reference in the
   * subject line.
   *
   * The reference is the whole point. Without it the first reply is
   * always "which order?", which costs a day on something that is
   * already going wrong.
   */
  function openDispute(order: OrderView | null) {
    const subject = order
      ? `Problem with order ${order.reference}`
      : 'Help with my LOCI account';

    const body = order
      ? [
          `Order reference: ${order.reference}`,
          `Shop: ${order.vendor?.store_name ?? 'unknown'}`,
          `Status: ${order.fulfillment_status}`,
          '',
          'What went wrong:',
          '',
        ].join('\n')
      : ['What I need help with:', '', ''].join('\n');

    setPickingOrder(false);
    Linking.openURL(supportMailto({ subject, body }));
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text style={styles.h1}>Help &amp; Support</Text>
        <Text style={styles.h2}>
          {displayName ? `Hello ${displayName}. ` : ''}
          We answer {SUPPORT.hours}.
        </Text>
      </View>

      {/* Contact first. Someone who opens this page because an order has
          gone wrong should not have to scroll past eight FAQs to find a
          phone number. */}
      <View style={[styles.contactRow, isMobile && styles.contactRowMobile]}>
        <ContactCard
          icon="call-outline"
          label="Call us"
          value={SUPPORT.phoneDisplay}
          onPress={() => Linking.openURL(SUPPORT_TEL)}
        />
        <ContactCard
          icon="mail-outline"
          label="Email us"
          value={SUPPORT.email}
          onPress={() => Linking.openURL(supportMailto({ subject: 'Help with my LOCI account' }))}
        />
      </View>

      {/* --- order disputes --- */}
      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.navy} />
          <Text style={styles.panelTitle}>Report a problem with an order</Text>
        </View>
        <Text style={styles.panelCaption}>
          Missing delivery, wrong books, or a shop that has gone quiet. Pick the order and we will
          have its reference in front of us before we reply.
        </Text>

        {!pickingOrder ? (
          <Pressable
            onPress={() => setPickingOrder(true)}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Choose an order to report a problem with"
          >
            <Text style={styles.primaryText}>Choose an order</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.onNavy} />
          </Pressable>
        ) : loading ? (
          <Text style={styles.muted}>Loading your orders…</Text>
        ) : orders.length === 0 ? (
          <View style={styles.noOrders}>
            <Text style={styles.muted}>
              You have no orders yet. If this is about a quote or a booklist, email us and we will
              pick it up.
            </Text>
            <Pressable
              onPress={() => openDispute(null)}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>Email support instead</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.orderList}>
            {orders.slice(0, 8).map((order) => (
              <Pressable
                key={order.id}
                onPress={() => openDispute(order)}
                style={({ pressed }) => [styles.order, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Report a problem with order ${order.reference}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderRef}>{order.reference}</Text>
                  <Text style={styles.orderMeta} numberOfLines={1}>
                    {[order.vendor?.store_name, order.request?.school_name, order.fulfillment_status]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </Pressable>
            ))}
            <Pressable
              onPress={() => setPickingOrder(false)}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* --- FAQs --- */}
      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <Ionicons name="help-circle-outline" size={18} color={colors.navy} />
          <Text style={styles.panelTitle}>Common questions</Text>
        </View>

        {FAQS.map((faq, i) => {
          const open = openFaq === i;
          return (
            <View key={faq.q} style={styles.faq}>
              <Pressable
                onPress={() => setOpenFaq(open ? null : i)}
                style={({ pressed }) => [styles.faqHead, pressed && styles.faqHeadPressed]}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                // react-native-web does not translate accessibilityState
                // `expanded` into aria-expanded, so a screen reader on the
                // web build would announce a plain button with no hint
                // that it opens anything.
                aria-expanded={open}
                accessibilityLabel={faq.q}
              >
                <Text style={styles.faqQ}>{faq.q}</Text>
                <Ionicons
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textMuted}
                />
              </Pressable>
              {open && <Text style={styles.faqA}>{faq.a}</Text>}
            </View>
          );
        })}
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <Ionicons name="book-outline" size={18} color={colors.navy} />
          <Text style={styles.panelTitle}>Guides</Text>
        </View>
        <LinkRow label="How LOCI works" onPress={() => router.push('/how-it-works')} />
        <LinkRow label="Delivery and shipping" onPress={() => router.push('/services/shipping')} />
        <LinkRow label="Returns and refunds" onPress={() => router.push('/services/returns')} />
        <LinkRow label="Buyer protection" onPress={() => router.push('/services/protection')} />
      </View>

      <Footer />
    </ScrollView>
  );
}

function ContactCard({
  icon,
  label,
  value,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.contact, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
    >
      <View style={styles.contactIcon}>
        <Ionicons name={icon} size={19} color={colors.navy} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text style={styles.contactValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </Pressable>
  );
}

function LinkRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, pressed && styles.faqHeadPressed]}
      accessibilityRole="link"
      accessibilityLabel={label}
    >
      <Text style={styles.linkText}>{label}</Text>
      <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  heading: { marginBottom: spacing.lg },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  contactRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  contactRowMobile: { flexDirection: 'column' },
  contact: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    minHeight: 44,
    ...shadow.card,
  },
  contactIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactLabel: { fontSize: font.sm, color: colors.textMuted },
  contactValue: { fontSize: font.md, fontWeight: '700', color: colors.text, marginTop: 1 },

  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  panelTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  panelCaption: { fontSize: font.md, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.md },
  muted: { fontSize: font.md, color: colors.textMuted, lineHeight: 20 },

  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingVertical: 12,
    minHeight: 44,
  },
  primaryText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  secondary: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 11,
    minHeight: 44,
  },
  secondaryText: { color: colors.textMuted, fontWeight: '700', fontSize: font.md },

  noOrders: { gap: spacing.md },
  orderList: { gap: spacing.sm },
  order: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 52,
  },
  orderRef: { fontSize: font.md, fontWeight: '700', color: colors.text },
  orderMeta: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  faq: { borderTopWidth: 1, borderTopColor: colors.border },
  faqHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  faqHeadPressed: { opacity: 0.6 },
  faqQ: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.text },
  faqA: {
    fontSize: font.md,
    color: colors.textMuted,
    lineHeight: 21,
    paddingBottom: spacing.md,
  },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    minHeight: 44,
  },
  linkText: { fontSize: font.md, fontWeight: '600', color: colors.navy },

  pressed: { opacity: 0.85 },
});
