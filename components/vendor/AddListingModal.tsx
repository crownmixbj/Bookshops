import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  InventoryListing,
  ListingDraft,
  ProductMatch,
} from '../../hooks/useVendorInventory';
import type { Category } from '../../types/catalog';
import { useLayout } from '../../hooks/useLayout';
import { colors, spacing, radius, font, shadow } from '../../theme';

interface Props {
  visible: boolean;
  categories: Category[];
  /** Set when editing; null when adding. */
  editing: InventoryListing | null;
  saving: boolean;
  error: string | null;
  onSearchProducts: (term: string) => Promise<ProductMatch[]>;
  onSave: (draft: ListingDraft) => void;
  onClose: () => void;
}

/**
 * Add a book to a shop's inventory, or change what it costs.
 *
 * The search comes first on purpose. `products` is shared by every shop,
 * so two bookshops stocking "New General Mathematics" should point at
 * one row — that is what lets a buyer compare prices for the same book
 * rather than for two rows that happen to be spelled alike. Typing a
 * title searches what is already there; creating a new entry is the
 * fallback when nothing matches.
 */
export function AddListingModal({
  visible,
  categories,
  editing,
  saving,
  error,
  onSearchProducts,
  onSave,
  onClose,
}: Props) {
  const { isMobile } = useLayout();

  const [productId, setProductId] = useState<string | undefined>();
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [publisher, setPublisher] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [available, setAvailable] = useState(true);
  const [matches, setMatches] = useState<ProductMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [touched, setTouched] = useState(false);

  // Seeded on open, not on every render, so typing is not undone.
  useEffect(() => {
    if (!visible) return;
    setTouched(false);
    setMatches([]);
    if (editing) {
      setProductId(editing.productId);
      setTitle(editing.title);
      setAuthor(editing.author ?? '');
      setPublisher(editing.publisher ?? '');
      setCategoryId(editing.categoryId);
      setPrice(String(editing.price));
      setStock(String(editing.stockQuantity));
      setAvailable(editing.isAvailable);
    } else {
      setProductId(undefined);
      setTitle('');
      setAuthor('');
      setPublisher('');
      setCategoryId(null);
      setPrice('');
      setStock('0');
      setAvailable(true);
    }
  }, [visible, editing]);

  // Debounced so a title is not one query per keystroke.
  useEffect(() => {
    if (!visible || editing || productId) return;
    const term = title.trim();
    if (term.length < 3) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      onSearchProducts(term)
        .then((found) => !cancelled && setMatches(found))
        .finally(() => !cancelled && setSearching(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, editing, productId, title, onSearchProducts]);

  const priceValue = Number(price);
  const stockValue = Number(stock);
  const priceValid = Number.isFinite(priceValue) && priceValue >= 0 && price.trim() !== '';
  const stockValid = Number.isInteger(stockValue) && stockValue >= 0;
  const canSave = title.trim().length > 0 && priceValid && stockValid && !saving;

  function pickExisting(match: ProductMatch) {
    setProductId(match.id);
    setTitle(match.title);
    setAuthor(match.author ?? '');
    setPublisher(match.publisher ?? '');
    setCategoryId(match.categoryId);
    setMatches([]);
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isMobile ? 'slide' : 'fade'}
      onRequestClose={saving ? undefined : onClose}
    >
      <Pressable
        style={styles.scrim}
        onPress={saving ? undefined : onClose}
        accessibilityLabel="Close"
      />
      <View
        style={[styles.wrap, isMobile ? styles.wrapMobile : styles.wrapCentre]}
        pointerEvents="box-none"
      >
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          <View style={styles.head}>
            <Text style={styles.title}>{editing ? 'Edit listing' : 'Add to inventory'}</Text>
            <Pressable onPress={onClose} disabled={saving} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Field label="Title" hint="What the book or item is called.">
              <TextInput
                value={title}
                onChangeText={(v) => {
                  setTitle(v);
                  // Typing over a picked product detaches it: the name no
                  // longer describes the row that was chosen.
                  if (productId && !editing) setProductId(undefined);
                }}
                placeholder="e.g. New General Mathematics JSS 2"
                placeholderTextColor={colors.textFaint}
                editable={!saving && !editing}
                style={[styles.input, touched && !title.trim() && styles.inputInvalid]}
                accessibilityLabel="Product title"
              />
            </Field>

            {searching && <Text style={styles.searching}>Checking the catalogue…</Text>}

            {matches.length > 0 && (
              <View style={styles.matches}>
                <Text style={styles.matchesHint}>
                  Already in the catalogue — pick one so buyers can compare your price with
                  other shops'.
                </Text>
                {matches.map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => pickExisting(m)}
                    style={({ pressed }) => [styles.match, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`List ${m.title}`}
                  >
                    <Ionicons name="link-outline" size={16} color={colors.navy} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.matchTitle} numberOfLines={1}>
                        {m.title}
                      </Text>
                      {!!(m.author || m.publisher) && (
                        <Text style={styles.matchMeta} numberOfLines={1}>
                          {[m.author, m.publisher].filter(Boolean).join(' · ')}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {!!productId && !editing && (
              <View style={styles.linked}>
                <Ionicons name="checkmark-circle" size={15} color={colors.success} />
                <Text style={styles.linkedText}>
                  Listing an existing catalogue entry. Buyers will see your price beside other
                  shops'.
                </Text>
              </View>
            )}

            <Field label="Author" hint="Who wrote it, as printed on the school's list.">
              <TextInput
                value={author}
                onChangeText={setAuthor}
                placeholder="e.g. A.O. Kalejaiye"
                placeholderTextColor={colors.textFaint}
                editable={!saving && !productId}
                style={styles.input}
                accessibilityLabel="Author"
              />
            </Field>

            <Field label="Publisher" hint="Which edition. This is what stops a wrong-book order.">
              <TextInput
                value={publisher}
                onChangeText={setPublisher}
                placeholder="e.g. Evans"
                placeholderTextColor={colors.textFaint}
                editable={!saving && !productId}
                style={styles.input}
                accessibilityLabel="Publisher"
              />
            </Field>

            <Field label="Category">
              <View style={styles.chips}>
                {categories.map((c) => {
                  const on = categoryId === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setCategoryId(on ? null : c.id)}
                      disabled={saving || Boolean(productId)}
                      style={({ pressed }) => [
                        styles.chip,
                        on && styles.chipOn,
                        pressed && styles.pressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={c.name}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Field>

            <View style={styles.row}>
              <View style={styles.rowItem}>
                <Field label="Unit price (₦)">
                  <TextInput
                    value={price}
                    onChangeText={setPrice}
                    placeholder="4500"
                    placeholderTextColor={colors.textFaint}
                    keyboardType="numeric"
                    editable={!saving}
                    style={[styles.input, touched && !priceValid && styles.inputInvalid]}
                    accessibilityLabel="Unit price in naira"
                  />
                </Field>
              </View>
              <View style={styles.rowItem}>
                <Field label="Stock quantity">
                  <TextInput
                    value={stock}
                    onChangeText={setStock}
                    placeholder="0"
                    placeholderTextColor={colors.textFaint}
                    keyboardType="number-pad"
                    editable={!saving}
                    style={[styles.input, touched && !stockValid && styles.inputInvalid]}
                    accessibilityLabel="Stock quantity"
                  />
                </Field>
              </View>
            </View>

            <Pressable
              onPress={() => setAvailable((v) => !v)}
              disabled={saving}
              style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
              accessibilityRole="switch"
              accessibilityState={{ checked: available }}
              accessibilityLabel="Available to buyers"
            >
              <Ionicons
                name={available ? 'checkbox' : 'square-outline'}
                size={21}
                color={available ? colors.navy : colors.borderStrong}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleText}>Available to buyers</Text>
                <Text style={styles.toggleHint}>
                  Untick to keep the listing but hide it while you are out of stock.
                </Text>
              </View>
            </Pressable>

            {!!error && (
              <View style={styles.error}>
                <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={onClose}
              disabled={saving}
              style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setTouched(true);
                if (!canSave) return;
                onSave({
                  listingId: editing?.id,
                  productId,
                  categoryId,
                  title,
                  author,
                  publisher,
                  price: priceValue,
                  stockQuantity: stockValue,
                  isAvailable: available,
                });
              }}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                !canSave && styles.btnDisabled,
                pressed && canSave && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave }}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.onNavy} />
              ) : (
                <Text style={styles.btnPrimaryText}>{editing ? 'Save changes' : 'Add listing'}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  wrap: { flex: 1 },
  wrapMobile: { justifyContent: 'flex-end' },
  wrapCentre: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    ...shadow.raised,
  },
  cardMobile: { maxWidth: '100%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },

  field: { marginBottom: spacing.md },
  label: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginBottom: 6 },
  hint: { fontSize: font.xs, color: colors.textMuted, marginTop: 5 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: font.md,
    color: colors.text,
  },
  inputInvalid: { borderColor: colors.danger, backgroundColor: '#FDECEA' },

  searching: { fontSize: font.xs, color: colors.textMuted, marginTop: -spacing.sm, marginBottom: spacing.md },
  matches: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  matchesHint: { fontSize: font.xs, color: colors.textMuted, padding: spacing.xs, lineHeight: 16 },
  match: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  matchTitle: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  matchMeta: { fontSize: font.xs, color: colors.textMuted },

  linked: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#E4F2E8',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  linkedText: { flex: 1, fontSize: font.xs, color: colors.success, lineHeight: 16 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    minHeight: 38,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  chipTextOn: { color: colors.onNavy },

  row: { flexDirection: 'row', gap: spacing.md },
  rowItem: { flex: 1 },

  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  toggleText: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  toggleHint: { fontSize: font.xs, color: colors.textMuted, marginTop: 1, lineHeight: 15 },

  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: '#FDECEA',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 18 },

  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  btn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.textMuted, fontWeight: '700', fontSize: font.md },
  btnPrimary: { backgroundColor: colors.orange },
  btnPrimaryText: { color: colors.onNavy, fontWeight: '800', fontSize: font.md },
  btnDisabled: { backgroundColor: colors.borderStrong },
  pressed: { opacity: 0.85 },
});
