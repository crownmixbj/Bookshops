import { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { OrderCard } from '../../components/orders/OrderCard';

import { useLayout } from '../../hooks/useLayout';
import { useOrders } from '../../hooks/useOrders';
import { supabase } from '../../utils/supabase';
import { colors, spacing, radius, font } from '../../theme';
import type { OrderView } from '../../types/db';
import { Footer } from '../../components/layout/Footer';
import { useShell } from '../../components/layout/ShellContext';

interface SectionProps {
  title: string;
  caption: string;
  icon: keyof typeof Ionicons.glyphMap;
  orders: OrderView[];
  emptyText: string;
  defaultExpanded?: boolean;
  collapsible?: boolean;
  onDispute: (order: OrderView) => void;
}

function Section({
  title,
  caption,
  icon,
  orders,
  emptyText,
  defaultExpanded = false,
  collapsible = false,
  onDispute,
}: SectionProps) {
  const [collapsed, setCollapsed] = useState(collapsible);

  return (
    <View style={styles.section}>
      <Pressable
        onPress={collapsible ? () => setCollapsed((v) => !v) : undefined}
        style={styles.sectionHead}
        accessibilityRole={collapsible ? 'button' : undefined}
      >
        <Ionicons name={icon} size={17} color={colors.navy} />
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>
            {title}
            <Text style={styles.sectionCount}>  {orders.length}</Text>
          </Text>
          <Text style={styles.sectionCaption}>{caption}</Text>
        </View>
        {collapsible && (
          <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={17} color={colors.textMuted} />
        )}
      </Pressable>

      {!collapsed &&
        (orders.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{emptyText}</Text>
          </View>
        ) : (
          orders.map((o, i) => (
            <OrderCard
              key={o.id}
              order={o}
              defaultExpanded={defaultExpanded && i === 0}
              onDispute={onDispute}
            />
          ))
        ))}
    </View>
  );
}

/**
 * My Orders — tracking and history for a buyer's placed orders.
 *
 * A dispute opens the existing support drawer rather than a bespoke
 * form: there is no disputes table, and inventing a form that writes
 * nowhere would be worse than a channel that actually reaches someone.
 */
export default function OrdersScreen() {
  const { isMobile, contentPadding } = useLayout();
  // The search box lives in the shell's top bar so its text survives
  // navigation; this screen just reads what was typed.
  const { search, openSupportChat } = useShell();

  const { sections, loading, refreshing, error, refresh } = useOrders();

  // Checkout redirects here with ?placed=<order id> after a successful
  // charge. The confirmation belongs on this screen rather than on
  // checkout: the buyer's next question is "where is my order", and the
  // answer is the list they are now looking at.
  const { placed } = useLocalSearchParams<{ placed?: string | string[] }>();
  const placedId = Array.isArray(placed) ? placed[0] : placed ?? null;
  const [confirmationShown, setConfirmationShown] = useState(true);
  const justPlaced = placedId && confirmationShown ? placedId : null;


  function handleDispute(order: OrderView) {
    openSupportChat(
      `Order ${order.reference} — ${order.vendor?.store_name ?? 'vendor'}\n` +
        `Placed ${new Date(order.placed_at ?? order.created_at).toLocaleDateString('en-NG')}\n` +
        `${order.itemCount} item(s)\n\n` +
        `What went wrong:\n`
    );
  }

  const q = search.trim().toLowerCase();
  const filter = useMemo(
    () => (list: OrderView[]) =>
      q
        ? list.filter(
            (o) =>
              o.reference.toLowerCase().includes(q) ||
              (o.vendor?.store_name ?? '').toLowerCase().includes(q) ||
              (o.request?.school_name ?? '').toLowerCase().includes(q) ||
              o.items.some((i) => i.title.toLowerCase().includes(q))
          )
        : list,
    [q]
  );

  const total = sections.active.length + sections.completed.length + sections.cancelled.length;

  return (
    <>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { padding: contentPadding }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heading}>
            <Text style={styles.h1}>My Orders</Text>
            <Text style={styles.h2}>
              {total === 0
                ? 'Orders you place will be tracked here'
                : `${total} order${total === 1 ? '' : 's'} in total`}
            </Text>
          </View>

          {!!justPlaced && (
            <View style={styles.placed}>
              <Ionicons name="shield-checkmark" size={18} color={colors.success} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.placedTitle}>Payment successful</Text>
                <Text style={styles.placedBody}>
                  Your money is held in LOCI Escrow and the shop has been notified to dispatch. It
                  is released only after you confirm the books arrived.
                </Text>
              </View>
              <Pressable
                onPress={() => setConfirmationShown(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Dismiss"
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            </View>
          )}

          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error.message}</Text>
              <Pressable onPress={refresh} hitSlop={6}>
                <Text style={styles.retry}>Retry</Text>
              </Pressable>
            </View>
          )}

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.navy} />
            </View>
          ) : (
            <>
              <Section
                title="In progress"
                caption="Being prepared, or on the way to you"
                icon="navigate-outline"
                orders={filter(sections.active)}
                defaultExpanded
                onDispute={handleDispute}
                emptyText="Nothing in progress. Accept a quote on one of your booklists to place an order."
              />
              <Section
                title="Delivered"
                caption="Completed orders, with receipts"
                icon="checkmark-done-outline"
                orders={filter(sections.completed)}
                onDispute={handleDispute}
                emptyText="No completed orders yet."
              />
              {sections.cancelled.length > 0 && (
                <Section
                  title="Cancelled"
                  caption="Orders that did not go ahead"
                  icon="close-circle-outline"
                  orders={filter(sections.cancelled)}
                  collapsible
                  onDispute={handleDispute}
                  emptyText="Nothing cancelled."
                />
              )}
            </>
          )}

          <View style={{ height: isMobile ? spacing.xxl : 0 }} />
          <Footer />
        </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  body: { flex: 1, flexDirection: 'row' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  heading: { marginBottom: spacing.xl },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  section: { marginBottom: spacing.xl },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  sectionCount: { color: colors.textFaint, fontWeight: '700' },
  sectionCaption: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  empty: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    padding: spacing.xl,
  },
  emptyText: { fontSize: font.md, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },

  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },

  placed: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#EAF6EF',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  placedTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  placedBody: { fontSize: font.sm, color: colors.textMuted, lineHeight: 18, marginTop: 1 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FCEAE8',
    borderColor: '#F0C4BF',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger },
  retry: { fontSize: font.sm, fontWeight: '800', color: colors.navy },
});
