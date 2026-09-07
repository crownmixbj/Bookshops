import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../utils/supabase';
import { Footer } from '../../components/layout/Footer';
import { useLayout } from '../../hooks/useLayout';
import { pageStyles, TableSkeleton, ErrorBanner, SearchBox } from '../../components/admin/AdminTable';
import { colors, spacing, radius, font } from '../../theme';

interface Row {
  id: string;
  store_name: string;
  city: string | null;
  featured: boolean;
  approval_status: string;
  is_active: boolean;
  rating: number | null;
  completed_orders: number;
}

/**
 * Banners & Marketing.
 *
 * One part of this section is real and one is not, and the screen is
 * explicit about which is which.
 *
 * Featured vendors work: `vendors.featured` is a column, `admin_set_featured`
 * is a SECURITY DEFINER function that flips it and writes an admin_actions
 * row, and the buyer dashboard already reads featured shops. So that panel
 * is a working control, not a mock-up.
 *
 * Banners and promos are not: there is no table for a banner, its image,
 * its placement, its schedule or its click-through, and no storage bucket
 * for the artwork. Rather than draw an empty banner manager, the screen
 * says what it would take.
 */
export default function AdminCmsScreen() {
  const { contentPadding, isMobile } = useLayout();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: readError } = await supabase
      .from('vendors')
      .select('id, store_name, city, featured, approval_status, is_active, rating, completed_orders')
      .order('featured', { ascending: false })
      .order('store_name', { ascending: true });
    if (readError) setError(readError.message);
    else setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
  }, [load]);

  async function toggle(row: Row) {
    setBusy(row.id);
    setError(null);
    const next = !row.featured;
    const { error: rpcError } = await supabase.rpc('admin_set_featured', {
      p_vendor: row.id,
      p_featured: next,
    });
    if (rpcError) setError(rpcError.message);
    // Re-read rather than patching state: the RPC also writes an
    // admin_actions row, and a refusal must not leave the switch showing
    // a change that did not happen.
    else await load();
    setBusy(null);
  }

  const q = query.trim().toLowerCase();
  const visible = q
    ? rows.filter((r) => `${r.store_name} ${r.city ?? ''}`.toLowerCase().includes(q))
    : rows;
  const featuredCount = rows.filter((r) => r.featured).length;

  return (
    <ScrollView contentContainerStyle={[pageStyles.content, { padding: contentPadding }]}>
      <View style={pageStyles.heading}>
        <Text style={pageStyles.h1}>Banners & Marketing</Text>
        <Text style={pageStyles.h2}>Homepage banners, promos and featured vendors</Text>
      </View>

      {!!error && <ErrorBanner message={error} onRetry={load} />}

      <View style={styles.panel}>
        <View style={styles.panelHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.panelTitle}>Featured Vendors</Text>
            <Text style={styles.panelSub}>
              {featuredCount} shop{featuredCount === 1 ? '' : 's'} featured. Featured shops appear
              ahead of others on the buyer dashboard.
            </Text>
          </View>
        </View>

        <View style={styles.panelBody}>
          <SearchBox value={query} onChange={setQuery} placeholder="Filter shops" label="Filter shops" />

          {loading ? (
            <TableSkeleton />
          ) : visible.length === 0 ? (
            <Text style={styles.empty}>
              {rows.length === 0 ? 'No shops on the marketplace yet.' : 'No shop matches that filter.'}
            </Text>
          ) : (
            <View style={styles.list}>
              {visible.map((row, i) => {
                // Only an approved, active shop should be promoted — the
                // buyer dashboard would otherwise surface a shop that
                // cannot take an order.
                const promotable = row.approval_status === 'approved' && row.is_active;
                return (
                  <View key={row.id} style={[styles.row, i > 0 && styles.rowDivider, isMobile && styles.rowStacked]}>
                    <View style={styles.rowText}>
                      <Text style={styles.name} numberOfLines={1}>
                        {row.store_name}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {row.city ?? 'No city'} · {row.completed_orders} order
                        {row.completed_orders === 1 ? '' : 's'}
                        {row.rating == null ? '' : ` · ${Number(row.rating).toFixed(1)}★`}
                        {promotable ? '' : ` · ${row.is_active ? row.approval_status : 'inactive'}`}
                      </Text>
                    </View>

                    <Pressable
                      onPress={() => toggle(row)}
                      disabled={busy === row.id || (!row.featured && !promotable)}
                      style={({ pressed }) => [
                        styles.toggle,
                        row.featured && styles.toggleOn,
                        !row.featured && !promotable && styles.toggleOff,
                        pressed && styles.pressed,
                      ]}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: row.featured, disabled: !row.featured && !promotable }}
                      accessibilityLabel={`${row.featured ? 'Remove' : 'Feature'} ${row.store_name}`}
                      accessibilityHint={
                        !row.featured && !promotable
                          ? 'Only an approved, active shop can be featured'
                          : undefined
                      }
                    >
                      <Ionicons
                        name={row.featured ? 'star' : 'star-outline'}
                        size={14}
                        color={row.featured ? colors.onNavy : promotable ? colors.navy : colors.textFaint}
                      />
                      <Text
                        style={[
                          styles.toggleText,
                          row.featured && styles.toggleTextOn,
                          !row.featured && !promotable && styles.toggleTextOff,
                        ]}
                      >
                        {busy === row.id ? 'Saving…' : row.featured ? 'Featured' : 'Feature'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </View>

      <View style={styles.notice}>
        <Ionicons name="image-outline" size={18} color={colors.warning} />
        <View style={{ flex: 1 }}>
          <Text style={styles.noticeTitle}>Banners and promos are not built yet</Text>
          <Text style={styles.noticeBody}>
            Featuring a shop above is a real control. A banner manager is not: nothing stores a
            banner's artwork, where it appears, when it runs, or what it links to. It would need a
            banners table (image path, placement, start and end dates, target link, active flag), a
            public storage bucket for the artwork, and a slot on the buyer dashboard to render into.
            Promo codes are a separate model again — nothing applies a discount to an order today.
          </Text>
        </View>
      </View>

      <Footer audience="admin" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, marginBottom: spacing.lg,
  },
  panelHead: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm,
  },
  panelTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  panelSub: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, lineHeight: 18 },
  panelBody: { padding: spacing.lg, gap: spacing.md },

  empty: { fontSize: font.md, color: colors.textMuted },
  list: {},
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: spacing.sm },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontSize: font.md, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  toggle: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.navy,
    paddingHorizontal: spacing.md, paddingVertical: 7,
  },
  toggleOn: { backgroundColor: colors.navy },
  toggleOff: { borderColor: colors.border, backgroundColor: colors.surfaceMuted },
  pressed: { opacity: 0.75 },
  toggleText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  toggleTextOn: { color: colors.onNavy },
  toggleTextOff: { color: colors.textFaint },

  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.warningBg, borderRadius: radius.md, padding: spacing.lg,
  },
  noticeTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  noticeBody: { fontSize: font.sm, color: colors.text, lineHeight: 19, marginTop: 3 },
});
