import { useMemo, useState } from 'react';
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
import { useVendorDirectory } from '../../hooks/useVendorDirectory';
import { OPEN_MARKET, directTo, type Dispatch } from '../../lib/booklistUpload';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

interface Props {
  /** Named in the header so the buyer knows what they are sending. */
  schoolName: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (dispatch: Dispatch) => void;
}

/**
 * Where should this booklist go?
 *
 * Mount this only while it is open — it loads the vendor directory, and
 * a permanently mounted copy would fetch every shop on every render of
 * the page behind it.
 *
 * The two options are not cosmetic. 'direct' is enforced by the queue
 * RPC and by requests_select_visible, so choosing one shop genuinely
 * hides the list from every other — which is why the confirm button
 * spells out what is about to happen rather than just saying "Send".
 */
export function DispatchModal({ schoolName, busy = false, onCancel, onConfirm }: Props) {
  const { isMobile } = useLayout();
  const [mode, setMode] = useState<'open_market' | 'direct'>('open_market');
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const { shops, loading, error } = useVendorDirectory();

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? shops.filter(
            (s) =>
              s.store_name.toLowerCase().includes(q) || (s.city ?? '').toLowerCase().includes(q)
          )
        : shops,
    [shops, q]
  );

  const chosen = shops.find((s) => s.id === vendorId) ?? null;
  const canSend = !busy && (mode === 'open_market' || chosen !== null);

  function confirm() {
    if (!canSend) return;
    onConfirm(mode === 'direct' && vendorId ? directTo(vendorId) : OPEN_MARKET);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={busy ? undefined : onCancel}>
      <Pressable style={styles.scrim} onPress={busy ? undefined : onCancel} accessibilityLabel="Cancel" />
      <View style={styles.centre} pointerEvents="box-none">
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Send this booklist</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {schoolName || 'Your booklist'}
              </Text>
            </View>
            <Pressable onPress={onCancel} disabled={busy} hitSlop={8} accessibilityLabel="Cancel">
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Option
              icon="globe-outline"
              title="Open Marketplace"
              caption="Every verified shop can see it and quote. Most quotes, best chance of a good price."
              recommended
              selected={mode === 'open_market'}
              onPress={() => setMode('open_market')}
            />

            <Option
              icon="storefront-outline"
              title="Direct to one shop"
              caption="Only the shop you pick will see this list. Nobody else can quote it."
              selected={mode === 'direct'}
              onPress={() => setMode('direct')}
            />

            {mode === 'direct' && (
              <View style={styles.picker}>
                <View style={styles.searchBox}>
                  <Ionicons name="search" size={15} color={colors.textFaint} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search shops"
                    placeholderTextColor={colors.textFaint}
                    style={styles.searchInput}
                    accessibilityLabel="Search shops"
                  />
                </View>

                {loading ? (
                  <View style={styles.pickerLoading}>
                    <ActivityIndicator color={colors.navy} />
                  </View>
                ) : error ? (
                  <Text style={styles.pickerEmpty}>{error.message}</Text>
                ) : visible.length === 0 ? (
                  <Text style={styles.pickerEmpty}>
                    {shops.length === 0
                      ? 'No shops have been approved yet — send to the open marketplace instead.'
                      : 'No shops match that search.'}
                  </Text>
                ) : (
                  visible.map((shop) => {
                    const isChosen = shop.id === vendorId;
                    return (
                      <Pressable
                        key={shop.id}
                        onPress={() => setVendorId(isChosen ? null : shop.id)}
                        style={({ pressed }) => [
                          styles.shop,
                          isChosen && styles.shopOn,
                          pressed && styles.pressed,
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: isChosen }}
                        accessibilityLabel={shop.store_name}
                      >
                        <View style={styles.shopLogo}>
                          <Text style={styles.shopLogoText}>
                            {(shop.store_name || '?').slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.shopName} numberOfLines={1}>
                            {shop.store_name}
                          </Text>
                          <Text style={styles.shopMeta} numberOfLines={1}>
                            {[
                              shop.city,
                              shop.rating != null ? `${shop.rating.toFixed(1)} ★` : 'No ratings yet',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </View>
                        <Ionicons
                          name={isChosen ? 'radio-button-on' : 'radio-button-off'}
                          size={19}
                          color={isChosen ? colors.navy : colors.borderStrong}
                        />
                      </Pressable>
                    );
                  })
                )}
              </View>
            )}

            <View style={{ height: spacing.md }} />
          </ScrollView>

          <View style={[styles.actions, isMobile && styles.actionsMobile]}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={confirm}
              disabled={!canSend}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                !canSend && styles.btnDisabled,
                pressed && canSend && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                mode === 'direct'
                  ? `Send to ${chosen?.store_name ?? 'the shop you pick'}`
                  : 'Send to every verified shop'
              }
            >
              {busy ? (
                <View style={styles.busy}>
                  <ActivityIndicator size="small" color={colors.onNavy} />
                  <Text style={styles.btnPrimaryText}>Sending…</Text>
                </View>
              ) : (
                <Text style={styles.btnPrimaryText} numberOfLines={1}>
                  {mode === 'direct'
                    ? chosen
                      ? `Send to ${chosen.store_name}`
                      : 'Pick a shop'
                    : 'Send to all shops'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Option({
  icon,
  title,
  caption,
  selected,
  recommended = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  caption: string;
  selected: boolean;
  recommended?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.option, selected && styles.optionOn, pressed && styles.pressed]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      accessibilityHint={caption}
    >
      <View style={[styles.optionIcon, selected && styles.optionIconOn]}>
        <Ionicons name={icon} size={19} color={selected ? colors.onNavy : colors.navy} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.optionTitleRow}>
          <Text style={styles.optionTitle}>{title}</Text>
          {recommended && (
            <View style={styles.tag}>
              <Text style={styles.tagText}>Recommended</Text>
            </View>
          )}
        </View>
        <Text style={styles.optionCaption}>{caption}</Text>
      </View>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={19}
        color={selected ? colors.navy : colors.borderStrong}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    ...shadow.raised,
  },
  cardMobile: { maxWidth: '100%' },

  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },

  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },

  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  optionOn: { borderColor: colors.navy, backgroundColor: colors.surfaceMuted },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconOn: { backgroundColor: colors.navy },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  optionTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  optionCaption: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, lineHeight: 18 },
  tag: {
    backgroundColor: '#E4F2E8',
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tagText: { fontSize: font.xs, fontWeight: '800', color: colors.success },

  picker: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginBottom: spacing.md,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 40,
  },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: 8 },
  pickerLoading: { paddingVertical: spacing.xl, alignItems: 'center' },
  pickerEmpty: {
    fontSize: font.sm,
    color: colors.textMuted,
    lineHeight: 18,
    paddingVertical: spacing.md,
  },

  shop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: 52,
  },
  shopOn: { borderColor: colors.navy, backgroundColor: colors.surfaceMuted },
  shopLogo: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shopLogoText: { color: colors.onNavy, fontWeight: '800', fontSize: font.md },
  shopName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  shopMeta: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionsMobile: { flexDirection: 'column-reverse' },
  btn: {
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnGhost: { flex: 1, borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.textMuted, fontWeight: '700', fontSize: font.md },
  btnPrimary: { flex: 1, backgroundColor: colors.orange },
  btnPrimaryText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  btnDisabled: { backgroundColor: colors.borderStrong },
  busy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pressed: { opacity: 0.85 },
});
