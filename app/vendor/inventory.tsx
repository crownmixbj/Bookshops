import { useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Panel } from '../../components/vendor/VendorShell';
import { AddListingModal } from '../../components/vendor/AddListingModal';
import { WorkspaceFooter } from '../../components/layout/WorkspaceFooter';
import {
  useVendorInventory,
  type InventoryListing,
  type ListingDraft,
} from '../../hooks/useVendorInventory';
import { useLayout } from '../../hooks/useLayout';
import { colors, spacing, radius, font, formatNaira } from '../../theme';

/**
 * What this shop sells, and for how much.
 *
 * The other side of the marketplace from Requests & Quotes: that screen
 * answers what a buyer asked for, this one publishes what is on the
 * shelf so buyers can find it without asking. Backed by shop_listings,
 * which RLS scopes to this vendor for writing and to available rows from
 * approved shops for everyone else.
 */
export default function VendorInventoryScreen() {
  const { isMobile, contentPadding } = useLayout();
  const {
    listings,
    categories,
    vendorId,
    loading,
    error,
    refresh,
    setAvailability,
    saveListing,
    // Stable across renders (useCallback in the hook), which matters:
    // the modal debounces on it in an effect, so a new identity every
    // render would restart the timer forever and never fire the query.
    searchProducts,
  } = useVendorInventory();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryListing | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function handleSave(draft: ListingDraft) {
    setSaving(true);
    setFormError(null);
    try {
      await saveListing(draft);
      setFormOpen(false);
      setEditing(null);
    } catch (e) {
      setFormError((e as Error)?.message ?? 'That could not be saved.');
    } finally {
      // Unconditional: a refusal must not leave the button spinning.
      setSaving(false);
    }
  }

  async function handleToggle(listing: InventoryListing) {
    setTogglingId(listing.id);
    setRowError(null);
    try {
      await setAvailability(listing.id, !listing.isAvailable);
    } catch (e) {
      setRowError((e as Error)?.message ?? 'That could not be changed.');
    } finally {
      setTogglingId(null);
    }
  }

  const available = listings.filter((l) => l.isAvailable).length;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={{ padding: contentPadding }}>
      <View style={styles.heading}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.h1}>Inventory</Text>
          <Text style={styles.h2}>
            {loading
              ? 'Loading what your shop has listed…'
              : listings.length === 0
              ? 'Nothing listed yet'
              : `${listings.length} listing${listings.length === 1 ? '' : 's'} · ${available} available to buyers`}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            setEditing(null);
            setFormError(null);
            setFormOpen(true);
          }}
          disabled={!vendorId}
          style={({ pressed }) => [styles.add, pressed && styles.pressed, !vendorId && styles.addOff]}
          accessibilityRole="button"
          accessibilityLabel="Add an item to your inventory"
        >
          <Ionicons name="add" size={16} color={colors.onNavy} />
          <Text style={styles.addText}>Add item</Text>
        </Pressable>
      </View>

      {!!rowError && (
        <View style={styles.error}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{rowError}</Text>
        </View>
      )}

      <Panel title="Listed Items">
        {loading ? (
          <View style={{ gap: spacing.sm }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeleton} />
            ))}
          </View>
        ) : error ? (
          <View style={styles.empty}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.danger} />
            <Text style={styles.emptyTitle}>This did not load</Text>
            <Text style={styles.emptyBody}>{error.message}</Text>
            <Pressable
              onPress={refresh}
              style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : !vendorId ? (
          <View style={styles.empty}>
            <Ionicons name="storefront-outline" size={24} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No shop on this account</Text>
            <Text style={styles.emptyBody}>
              Inventory belongs to a shop. Finish setting yours up in Settings and it will appear
              here.
            </Text>
          </View>
        ) : listings.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="cube-outline" size={24} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Your inventory is empty</Text>
            <Text style={styles.emptyBody}>
              Add books, uniforms, or stationery to start receiving orders and quotes.
            </Text>
            <Pressable
              onPress={() => {
                setEditing(null);
                setFormError(null);
                setFormOpen(true);
              }}
              style={({ pressed }) => [styles.add, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={16} color={colors.onNavy} />
              <Text style={styles.addText}>Add your first item</Text>
            </Pressable>
          </View>
        ) : (
          <View>
            {listings.map((listing, i) => (
              <ListingRow
                key={listing.id}
                listing={listing}
                divider={i > 0}
                isMobile={isMobile}
                toggling={togglingId === listing.id}
                onEdit={() => {
                  setEditing(listing);
                  setFormError(null);
                  setFormOpen(true);
                }}
                onToggle={() => handleToggle(listing)}
              />
            ))}
          </View>
        )}
      </Panel>

      <AddListingModal
        visible={formOpen}
        categories={categories}
        editing={editing}
        saving={saving}
        error={formError}
        onSearchProducts={searchProducts}
        onSave={handleSave}
        onClose={() => {
          if (saving) return;
          setFormOpen(false);
          setEditing(null);
          setFormError(null);
        }}
      />

      <WorkspaceFooter />
    </ScrollView>
  );
}

function ListingRow({
  listing,
  divider,
  isMobile,
  toggling,
  onEdit,
  onToggle,
}: {
  listing: InventoryListing;
  divider: boolean;
  isMobile: boolean;
  toggling: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const attribution = [listing.author, listing.publisher].filter(Boolean).join(' · ');
  const out = listing.stockQuantity <= 0;

  return (
    <View style={[styles.row, divider && styles.rowDivider, isMobile && styles.rowStacked]}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {listing.title}
        </Text>
        {/* Only from real values — an "Author unknown" line under every
            row is noise, and the gap already says it. */}
        {!!attribution && (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {attribution}
          </Text>
        )}
        <Text style={styles.rowCategory}>{listing.categoryName ?? 'Uncategorised'}</Text>
      </View>

      <View style={styles.rowNumbers}>
        <Text style={styles.price}>{formatNaira(listing.price)}</Text>
        <Text style={[styles.stock, out && styles.stockOut]}>
          {out ? 'No stock' : `${listing.stockQuantity} in stock`}
        </Text>
      </View>

      <View style={styles.rowActions}>
        <Pressable
          onPress={onToggle}
          disabled={toggling}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
          accessibilityRole="switch"
          accessibilityState={{ checked: listing.isAvailable, disabled: toggling }}
          accessibilityLabel={`${listing.title} available to buyers`}
        >
          {toggling ? (
            <ActivityIndicator size="small" color={colors.navy} />
          ) : (
            <>
              <Ionicons
                name={listing.isAvailable ? 'toggle' : 'toggle-outline'}
                size={22}
                color={listing.isAvailable ? colors.success : colors.textFaint}
              />
              <Text style={[styles.toggleText, listing.isAvailable && styles.toggleTextOn]}>
                {listing.isAvailable ? 'Available' : 'Hidden'}
              </Text>
            </>
          )}
        </Pressable>

        <Pressable
          onPress={onEdit}
          hitSlop={6}
          style={({ pressed }) => [styles.edit, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${listing.title}`}
        >
          <Ionicons name="create-outline" size={17} color={colors.navy} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.page },
  heading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  h1: { fontSize: 22, fontWeight: '800', color: colors.text },
  h2: { fontSize: font.md, color: colors.textMuted, marginTop: 2 },

  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
  },
  addOff: { backgroundColor: colors.borderStrong },
  addText: { color: colors.onNavy, fontWeight: '800', fontSize: font.md },

  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FDECEA',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.text },

  skeleton: { height: 66, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowStacked: { flexWrap: 'wrap' },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: font.md, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: font.sm, color: colors.textMuted },
  rowCategory: { fontSize: font.xs, color: colors.textFaint },

  rowNumbers: { alignItems: 'flex-end', minWidth: 96 },
  price: { fontSize: font.md, fontWeight: '800', color: colors.text },
  stock: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  stockOut: { color: colors.warning, fontWeight: '700' },

  rowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 104,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  toggleText: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted },
  toggleTextOn: { color: colors.success },
  edit: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },

  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptyBody: {
    fontSize: font.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 380,
    marginBottom: spacing.sm,
  },
  retry: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    minHeight: 40,
    justifyContent: 'center',
  },
  retryText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  pressed: { opacity: 0.85 },
});
