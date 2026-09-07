import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { WorkspaceFooter } from '../../components/layout/WorkspaceFooter';
import { useLayout } from '../../hooks/useLayout';
import { useVendorIdentity } from '../../hooks/useVendorIdentity';
import { SUPPORT, SUPPORT_TEL, supportMailto } from '../../lib/support';
import { colors, spacing, radius, font, shadow } from '../../theme';

/**
 * Vendor Support.
 *
 * HONEST STATE OF THIS SCREEN: there is no ticketing backend. The schema
 * has no support_tickets table, so nothing here can raise a ticket a
 * shop could come back and track.
 *
 * Every action therefore ends somewhere a human reads — the support
 * line, or an email pre-filled with the shop's name and the topic, so
 * the team is not starting from "which shop is this?". The buyer-side
 * /support screen makes the same choice for the same reason.
 *
 * TODO(backend): add `support_tickets` (id, raised_by, subject, body,
 * status) and `support_messages` with RLS scoping rows to their owner,
 * then swap `openTopic` for an insert. app/admin/support.tsx is already
 * the screen that would answer them. Nothing else here changes.
 */

interface Topic {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  caption: string;
  subject: string;
}

/**
 * What shops actually write in about, in rough order of how urgent it
 * is to them: money first, then disputes, then the rest.
 */
const TOPICS: Topic[] = [
  {
    key: 'payout',
    icon: 'wallet-outline',
    title: 'A payout has not arrived',
    caption: 'Withdrawals that are late, missing, or sent to the wrong account.',
    subject: 'Payout problem',
  },
  {
    key: 'dispute',
    icon: 'alert-circle-outline',
    title: 'Dispute an order or a refund',
    caption: 'A buyer says the books never arrived, or is asking for money back.',
    subject: 'Order dispute',
  },
  {
    key: 'buyer',
    icon: 'person-outline',
    title: 'Report a buyer',
    caption: 'Abusive messages, repeated no-shows, or a suspected fake order.',
    subject: 'Report a buyer',
  },
  {
    key: 'account',
    icon: 'storefront-outline',
    title: 'Shop verification or account access',
    caption: 'Verification, approval, a suspended account, or changing the owner.',
    subject: 'Shop account help',
  },
  {
    key: 'other',
    icon: 'help-circle-outline',
    title: 'Something else',
    caption: 'Anything the topics above do not cover.',
    subject: 'Vendor support request',
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: 'Why is a request not in my queue?',
    a: 'Two reasons. Either the buyer sent it direct to one shop and that shop is not you — a direct request is visible only to its target — or you declined it earlier, which removes it from your queue and nobody else’s.',
  },
  {
    q: 'Can I change a quote after sending it?',
    a: 'Yes, until the buyer accepts. Open Requests & Quotes, find it under Sent Quotes, and press Edit Quote. Once it is accepted the price is what the buyer paid, so it is locked.',
  },
  {
    q: 'What does marking an item out of stock do?',
    a: 'It keeps the line on the quote but excludes it from the total, so the buyer can see you read their whole list and still compare your price fairly. It is usually better than dropping the line silently.',
  },
  {
    q: 'When do I get paid?',
    a: 'Funds move into your withdrawable balance once an order reaches Delivered. Request a withdrawal from Payouts; the minimum and the schedule are shown on that screen.',
  },
  {
    q: 'What is Busy mode?',
    a: 'A flag on your shop that tells buyers you are at capacity. You keep receiving requests, but buyers see the signal before they wait on a quote. Toggle it from the top bar.',
  },
];

export default function VendorSupportScreen() {
  const { contentPadding, isMobile } = useLayout();
  const { vendor } = useVendorIdentity(true);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  /**
   * Opens a mail carrying the shop's name and id.
   *
   * The id is the point. Shop names repeat across Lagos, and support
   * chasing the right "Campus Books" costs a day on something that is
   * usually about money.
   */
  function openTopic(topic: Topic) {
    const body = [
      `Shop: ${vendor?.store_name ?? 'unknown'}`,
      vendor?.id ? `Shop ID: ${vendor.id}` : null,
      vendor?.city ? `City: ${vendor.city}` : null,
      '',
      'What I need help with:',
      '',
    ]
      .filter((line) => line !== null)
      .join('\n');

    Linking.openURL(
      supportMailto({
        subject: `[Vendor] ${topic.subject}${vendor?.store_name ? ` — ${vendor.store_name}` : ''}`,
        body,
      })
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heading}>
        <Text style={styles.h1}>Support</Text>
        <Text style={styles.h2}>
          {vendor?.store_name ? `${vendor.store_name} · ` : ''}We answer {SUPPORT.hours}.
        </Text>
      </View>

      <View style={[styles.contactRow, isMobile && styles.contactRowMobile]}>
        <ContactCard
          icon="call-outline"
          label="Vendor line"
          value={SUPPORT.phoneDisplay}
          onPress={() => Linking.openURL(SUPPORT_TEL)}
        />
        <ContactCard
          icon="mail-outline"
          label="Email us"
          value={SUPPORT.email}
          onPress={() =>
            openTopic(TOPICS[TOPICS.length - 1])
          }
        />
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <Ionicons name="chatbox-ellipses-outline" size={18} color={colors.navy} />
          <Text style={styles.panelTitle}>What do you need help with?</Text>
        </View>
        <Text style={styles.panelCaption}>
          Each of these opens an email with your shop details already filled in.
        </Text>

        {TOPICS.map((topic) => (
          <Pressable
            key={topic.key}
            onPress={() => openTopic(topic)}
            style={({ pressed }) => [styles.topic, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={topic.title}
            accessibilityHint={topic.caption}
          >
            <View style={styles.topicIcon}>
              <Ionicons name={topic.icon} size={18} color={colors.navy} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.topicTitle}>{topic.title}</Text>
              <Text style={styles.topicCaption}>{topic.caption}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </Pressable>
        ))}
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <Ionicons name="help-circle-outline" size={18} color={colors.navy} />
          <Text style={styles.panelTitle}>Selling on LOCI</Text>
        </View>

        {FAQS.map((faq, i) => {
          const open = openFaq === i;
          return (
            <View key={faq.q} style={styles.faq}>
              <Pressable
                onPress={() => setOpenFaq(open ? null : i)}
                style={({ pressed }) => [styles.faqHead, pressed && styles.pressedSoft]}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                // react-native-web does not translate accessibilityState
                // `expanded` into aria-expanded, so on the web build a
                // screen reader would announce a plain button with no
                // hint that it opens anything.
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
          <Ionicons name="document-text-outline" size={18} color={colors.navy} />
          <Text style={styles.panelTitle}>Platform guidance</Text>
        </View>
        <LinkRow label="Selling on LOCI" onPress={() => router.push('/services/sell')} />
        <LinkRow label="Delivery and shipping" onPress={() => router.push('/services/shipping')} />
        <LinkRow label="Returns and refunds" onPress={() => router.push('/services/returns')} />
        <LinkRow label="Community guidelines" onPress={() => router.push('/legal/guidelines')} />
        <LinkRow label="Terms of service" onPress={() => router.push('/legal/terms')} />
      </View>

      <WorkspaceFooter />
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
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressedSoft]}
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
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  panelTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  panelCaption: {
    fontSize: font.md,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: spacing.md,
  },

  topic: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 56,
  },
  topicIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topicTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  topicCaption: { fontSize: font.sm, color: colors.textMuted, marginTop: 1, lineHeight: 18 },

  faq: { borderTopWidth: 1, borderTopColor: colors.border },
  faqHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  faqQ: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.text },
  faqA: { fontSize: font.md, color: colors.textMuted, lineHeight: 21, paddingBottom: spacing.md },

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
  pressedSoft: { opacity: 0.6 },
});
