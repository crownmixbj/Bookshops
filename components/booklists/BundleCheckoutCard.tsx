import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';
import type { Booklist, Quote } from '../../types/db';

/**
 * "Pay for several lists at once."
 *
 * A household with three children at two schools gets three sets of
 * quotes. Paying for them one by one is three trips through Paystack
 * and three delivery fees even when one shop quoted two of the lists.
 * This card picks one quote per list (the cheapest by default, any of
 * them by tapping) and sends the set to /checkout?quotes=…, which
 * charges once and delivers once per shop.
 *
 * The figure shown here is the items only, and says so: the delivery
 * fee and the final total come from checkout_bundle() on the server,
 * which is the same function the charge is priced from.
 */

interface Props {
  /** Active booklists — quoted and waiting on the buyer. */
  booklists: Booklist[];
}

function openQuotes(b: Booklist): Quote[] {
  return b.quotes
    .filter((q) => q.status === 'sent')
    .sort((x, y) => Number(x.total_price) - Number(y.total_price));
}

export function BundleCheckoutCard({ booklists }: Props) {
  const eligible = useMemo(() => booklists.filter((b) => !b.order && openQuotes(b).length > 0), [booklists]);

  /** booklist id -> chosen quote id, or null when left out of the bundle. */
  const [choice, setChoice] = useState<Record<string, string | null>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  // New lists default to their cheapest quote; lists that are gone drop out.
  useEffect(() => {
    setChoice((prev) => {
      const next: Record<string, string | null> = {};
      for (const b of eligible) {
        const quotes = openQuotes(b);
        const kept = prev[b.id];
        next[b.id] =
          kept === null ? null : kept && quotes.some((q) => q.id === kept) ? kept : quotes[0]?.id ?? null;
      }
      return next;
    });
  }, [eligible]);

  if (eligible.length < 2) return null;

  const chosen = eligible
    .map((b) => ({ b, quote: openQuotes(b).find((q) => q.id === choice[b.id]) ?? null }))
    .filter((x): x is { b: Booklist; quote: Quote } => !!x.quote);
  const itemsTotal = chosen.reduce((sum, x) => sum + Number(x.quote.total_price || 0), 0);
  const shops = new Set(chosen.map((x) => x.quote.vendor_id)).size;

  function checkout() {
    if (chosen.length === 0) return;
    router.push({ pathname: '/checkout', params: { quotes: chosen.map((x) => x.quote.id).join(',') } });
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Ionicons name="basket-outline" size={18} color={colors.orangeDark} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>Check out several lists together</Text>
          <Text style={styles.caption}>
            One payment, and one delivery fee per shop — lists quoted by the same shop travel together.
          </Text>
        </View>
      </View>

      {eligible.map((b) => {
        const quotes = openQuotes(b);
        const picked = choice[b.id] ?? null;
        const pickedQuote = quotes.find((q) => q.id === picked) ?? null;
        const included = !!pickedQuote;
        const who = [b.child?.full_name, b.school_name, b.class_level].filter(Boolean).join(' · ');
        return (
          <View key={b.id} style={styles.row}>
            <Pressable
              onPress={() =>
                setChoice((c) => ({ ...c, [b.id]: included ? null : quotes[0]?.id ?? null }))
              }
              hitSlop={6}
              style={styles.checkWrap}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: included }}
              accessibilityLabel={`Include ${who}`}
            >
              <Ionicons
                name={included ? 'checkbox' : 'square-outline'}
                size={20}
                color={included ? colors.navy : colors.textFaint}
              />
            </Pressable>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.rowTitle, !included && styles.muted]} numberOfLines={1}>
                {who}
              </Text>
              <Pressable
                onPress={() => setExpanded((e) => (e === b.id ? null : b.id))}
                disabled={quotes.length < 2}
                style={styles.shopLine}
                accessibilityRole="button"
                accessibilityLabel={`Shop: ${pickedQuote?.vendors?.store_name ?? 'none'}. ${quotes.length} quotes`}
              >
                <Text style={styles.rowSub} numberOfLines={1}>
                  {pickedQuote
                    ? `${pickedQuote.vendors?.store_name ?? 'Shop'}`
                    : `Not included · ${quotes.length} quote${quotes.length === 1 ? '' : 's'}`}
                </Text>
                {quotes.length > 1 && (
                  <Text style={styles.change}>{expanded === b.id ? 'Done' : `Change (${quotes.length})`}</Text>
                )}
              </Pressable>
              {expanded === b.id && (
                <View style={styles.options}>
                  {quotes.map((q) => {
                    const on = q.id === picked;
                    return (
                      <Pressable
                        key={q.id}
                        onPress={() => setChoice((c) => ({ ...c, [b.id]: q.id }))}
                        style={[styles.option, on && styles.optionOn]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[styles.optionText, on && styles.optionTextOn]} numberOfLines={1}>
                          {q.vendors?.store_name ?? 'Shop'} · {formatNaira(q.total_price)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
            <Text style={[styles.price, !included && styles.muted]}>
              {pickedQuote ? formatNaira(pickedQuote.total_price) : '—'}
            </Text>
          </View>
        );
      })}

      <View style={styles.foot}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.total}>{formatNaira(itemsTotal)}</Text>
          <Text style={styles.caption}>
            Books for {chosen.length} list{chosen.length === 1 ? '' : 's'} from {shops} shop
            {shops === 1 ? '' : 's'}. Delivery is added at checkout.
          </Text>
        </View>
        <Pressable
          onPress={checkout}
          disabled={chosen.length === 0}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed, chosen.length === 0 && styles.ctaOff]}
          accessibilityRole="button"
          accessibilityLabel={`Check out ${chosen.length} booklists together`}
        >
          <Ionicons name="lock-closed" size={14} color={colors.onNavy} />
          <Text style={styles.ctaText}>
            Check out {chosen.length} list{chosen.length === 1 ? '' : 's'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#F6D2B8',
    padding: spacing.lg,
    marginBottom: spacing.xl,
    gap: spacing.sm,
    ...shadow.card,
  },
  head: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', marginBottom: spacing.sm },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: '#FDF1E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  caption: { fontSize: font.sm, color: colors.textMuted, lineHeight: 18, marginTop: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  checkWrap: { paddingTop: 1 },
  rowTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: font.sm, color: colors.textMuted, flexShrink: 1 },
  shopLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 1 },
  change: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  muted: { color: colors.textFaint },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  option: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  optionOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  optionText: { fontSize: font.sm, color: colors.navy, fontWeight: '600' },
  optionTextOn: { color: colors.onNavy },
  price: { fontSize: font.md, fontWeight: '800', color: colors.text },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  total: { fontSize: font.xl, fontWeight: '800', color: colors.navy },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.orange,
    paddingHorizontal: spacing.lg,
  },
  ctaPressed: { backgroundColor: colors.orangeDark },
  ctaOff: { opacity: 0.5 },
  ctaText: { fontSize: font.md, fontWeight: '800', color: colors.onNavy },
});
