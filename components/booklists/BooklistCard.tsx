import { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, Modal, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CATEGORY_LABEL } from '../../hooks/useBooklists';
import { LINE_PRICE_LABEL, linePriceState } from '../../lib/booklistPricing';
import { signBooklistImage } from '../../lib/booklistUpload';
import type { Booklist, FulfillmentStatus, PricedBooklistItem, RequestStatus } from '../../types/db';
import { colors, spacing, radius, font, shadow, formatNaira } from '../../theme';

const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  textbook: 'book-outline',
  stationery: 'pencil-outline',
  uniform: 'shirt-outline',
  other: 'cube-outline',
};

/** How each stage should read to a parent, not to a database. */
const STATUS_COPY: Record<RequestStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  draft: { label: 'Draft — not sent yet', tone: 'neutral' },
  pending_quote: { label: 'Waiting for quotes', tone: 'warning' },
  quoted: { label: 'Quotes received', tone: 'info' },
  ordered: { label: 'Ordered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const FULFILMENT_COPY: Record<FulfillmentStatus, string> = {
  processing: 'Being prepared',
  ready: 'Ready for pickup',
  dispatched: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

function Chip({ label, tone = 'neutral', icon }: {
  label: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning';
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const t =
    tone === 'success'
      ? { bg: '#E4F2E8', fg: colors.success }
      : tone === 'warning'
      ? { bg: colors.warningBg, fg: colors.warning }
      : tone === 'info'
      ? { bg: '#E4EAF5', fg: colors.navy }
      : { bg: colors.surfaceMuted, fg: colors.textMuted };
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      {icon && <Ionicons name={icon} size={11} color={t.fg} />}
      <Text style={[styles.chipText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

function ItemRow({
  item,
  serial,
  hasQuote,
}: {
  item: PricedBooklistItem;
  serial: number;
  hasQuote: boolean;
}) {
  // Shared with the dashboard accordion, so the same line cannot be
  // described two different ways on two screens.
  const authorText = (item.author ?? '').trim();
  const state = linePriceState(item, hasQuote);
  const priceLabel =
    state === 'priced' ? formatNaira(item.lineTotal as number) : LINE_PRICE_LABEL[state];

  const showsUnitPrice =
    item.isAvailable && item.lineTotal != null && item.effectiveQuantity > 1;

  return (
    <View style={styles.itemRow}>
      {/* Position on the list, running unbroken across the category
          groups — this is what a parent reads off against the paper
          the school sent home. Faint and plain on purpose: the two
          numbers on this row must not look alike. */}
      <Text style={styles.itemSerial}>{serial}.</Text>

      <View style={{ flex: 1 }}>
        <View style={styles.itemTitleLine}>
          {/* Shown only when it is not 1. A column of "1×" against every
              line is noise, and 1 is what the absence of a badge means.
              A filled chip beside the bare serial keeps the two numbers
              on this row from reading as one. */}
          {item.quantity > 1 && (
            <View style={styles.itemQty}>
              <Text style={styles.itemQtyText}>{item.quantity}×</Text>
            </View>
          )}
          <Text style={styles.itemTitle} numberOfLines={2}>
            {item.title}
          </Text>
        </View>
        {/* The edition, in effect. Two shops quoting "New General
            Mathematics" are not necessarily quoting the same book, and
            this line is what settles it — so it is shown even when
            empty, because a missing author is itself worth seeing. */}
        <Text
          style={[styles.itemAuthor, !authorText && styles.itemAuthorMissing]}
          numberOfLines={1}
        >
          {authorText || 'Author / publisher not specified'}
        </Text>
        {item.parsed && <Text style={styles.itemParsed}>read from photo — check this line</Text>}
      </View>

      <View style={styles.itemPriceWrap}>
        <Text
          style={[
            styles.itemPrice,
            item.lineTotal == null && styles.itemPriceMuted,
            !item.isAvailable && styles.itemPriceOut,
          ]}
        >
          {priceLabel}
        </Text>
        {/* The per-copy figure, so a three-copy line reads as a price
            times a count rather than an unexplained larger number. */}
        {showsUnitPrice && (
          <Text style={styles.itemUnitPrice}>
            {formatNaira(item.effectiveUnitPrice as number)} each
          </Text>
        )}
        {/* The shop quoted fewer copies than were asked for. Silently
            billing for two when three were requested is the kind of gap
            a parent finds at the counter. */}
        {item.isAvailable && item.effectiveQuantity !== item.quantity && (
          <Text style={styles.itemQtyWarn}>
            {item.effectiveQuantity} of {item.quantity} quoted
          </Text>
        )}
      </View>
    </View>
  );
}

interface Props {
  booklist: Booklist;
  defaultExpanded?: boolean;
  onPressQuotes?: (booklist: Booklist) => void;
  onEdit?: (booklist: Booklist) => void;
  onPublish?: (booklist: Booklist) => void;
  onDelete?: (booklist: Booklist) => void;
  /** True while this card's Publish is in flight. */
  publishing?: boolean;
}

export function BooklistCard({
  booklist,
  defaultExpanded = false,
  onPressQuotes,
  onEdit,
  onPublish,
  onDelete,
  publishing = false,
}: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  /**
   * The photo lives in a private bucket, so it cannot be rendered from
   * its stored path — it has to be signed first, and only when someone
   * actually asks to see it. Most cards are never opened; a signed URL
   * nobody looks at is a wasted round trip on a phone.
   */
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const openPhoto = useCallback(async () => {
    if (!booklist.image_path) return;
    setPhotoOpen(true);
    // Signed once per card. The URL outlives the time anyone spends
    // looking at it, so re-signing on every open would be waste.
    if (photoUrl) return;

    setPhotoLoading(true);
    setPhotoError(null);
    try {
      const url = await signBooklistImage(booklist.image_path);
      if (!url) throw new Error('That photo could not be opened.');
      setPhotoUrl(url);
    } catch (e) {
      setPhotoError((e as Error)?.message ?? 'That photo could not be opened.');
    } finally {
      // Unconditional: a failed signature must not leave a spinner
      // turning over an empty modal.
      setPhotoLoading(false);
    }
  }, [booklist.image_path, photoUrl]);

  const status = STATUS_COPY[booklist.status];
  const liveQuotes = booklist.quotes.filter((q) => q.status === 'sent').length;

  /**
   * Line id -> its number on the list.
   *
   * Built once over the groups in the order they render, rather than
   * numbering within each group: the card splits a list into Textbooks /
   * Stationery / Uniforms, and restarting at 1 in each would give a
   * twelve-line booklist two items numbered 1. Walking the groups here
   * means Textbooks 1-6 is followed by Other items 7-12, and the last
   * number equals the line count in the header.
   */
  const serials = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const group of booklist.groups) {
      for (const item of group.items) map.set(item.id, ++n);
    }
    return map;
  }, [booklist.groups]);

  const isDraft = booklist.status === 'draft';
  /** Still out with shops: nobody has been paid and quotes may still land. */
  const isAwaitingQuotes =
    booklist.status === 'pending_quote' || booklist.status === 'quoted';
  // Editing and deleting stay available right up until a vendor commits
  // time to the list. `requests_delete_own` draws the same line in the
  // database, so a button shown past this point would fail at the policy
  // rather than at the UI.
  const isEditable = isDraft || booklist.status === 'pending_quote';

  // A quote is in play once any line was priced from one, or once the
  // headline figure itself came from a quote. Below that, a line with no
  // money on it is still awaiting an answer rather than skipped.
  const hasPricingQuote =
    booklist.totalSource === 'quote' ||
    booklist.totalSource === 'order' ||
    booklist.items.some((i) => i.priceSource === 'quote');

  // 'none' means no quote and no buyer estimate: there is no figure to
  // headline, so the whole block goes rather than showing a bare dash.
  const hasTotal = booklist.totalSource !== 'none' && booklist.estimatedTotal > 0;

  const totalCaption =
    booklist.totalSource === 'order'
      ? 'Order total'
      : booklist.totalSource === 'quote'
      ? liveQuotes > 1
        ? 'Best quote'
        : 'Quoted'
      : booklist.totalSource === 'items'
      ? 'Your estimate'
      : 'No price yet';

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${booklist.school_name}, ${status.label}`}
      >
        <View style={styles.thumb}>
          <Ionicons name="documents-outline" size={17} color={colors.navy} />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.school} numberOfLines={1}>
            {booklist.school_name || 'Untitled booklist'}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {/* Lines first, because that is what the serial numbers
                count up to — the two must never disagree. The copy
                total is appended only when a line has more than one,
                so the usual card stays short. */}
            {[
              booklist.class_level,
              `${booklist.lineCount} item${booklist.lineCount === 1 ? '' : 's'}`,
              booklist.itemCount !== booklist.lineCount ? `${booklist.itemCount} copies` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View style={styles.chipRow}>
            <Chip label={status.label} tone={status.tone} />
            {booklist.order && (
              <Chip
                label={FULFILMENT_COPY[booklist.order.fulfillment_status]}
                tone={booklist.order.fulfillment_status === 'delivered' ? 'success' : 'info'}
                icon="cube-outline"
              />
            )}
            {liveQuotes > 0 && (
              <Chip label={`${liveQuotes} quote${liveQuotes === 1 ? '' : 's'}`} tone="info" />
            )}
            {/* Where this list went, named.
                Keyed off target_vendor_id rather than dispatch_type: the
                id is on every database, dispatch_type only after
                bookshops_dispatch_routing.sql, and gating on the latter
                meant this badge never appeared at all. */}
            {booklist.target_vendor_id ? (
              // A named shop stays worth showing at every stage — it is
              // who the buyer is dealing with, ordered or not.
              !isDraft && (
                <Chip
                  label={`Direct to: ${booklist.target_vendor?.store_name ?? 'one shop'}`}
                  tone="info"
                  icon="storefront-outline"
                />
              )
            ) : (
              // "Sent to nearby shops" is a statement about a list still
              // out for quotes. Once it is ordered — or was never sent —
              // it describes nothing that is still happening, and next to
              // an order chip it reads as though shops are still bidding
              // on something already bought.
              isAwaitingQuotes && <Chip label="Sent to nearby shops" icon="business-outline" />
            )}
            {booklist.image_path && (
              <Pressable
                onPress={openPhoto}
                hitSlop={6}
                style={({ pressed }) => pressed && styles.pressed}
                accessibilityRole="button"
                accessibilityLabel="View the attached booklist photo"
              >
                <Chip label="Photo attached" icon="image-outline" />
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.totalWrap}>
          {/* No quote, no total. A caption over a dash is a price the
              buyer cannot act on, and it reads as though something has
              gone wrong rather than as "no shop has answered yet". */}
          {hasTotal && (
            <>
              <Text style={styles.totalCaption}>{totalCaption}</Text>
              <Text style={styles.total}>{formatNaira(booklist.estimatedTotal)}</Text>
            </>
          )}
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
            style={{ alignSelf: 'flex-end', marginTop: 2 }}
          />
        </View>
      </Pressable>

      {open && (
        <View style={styles.body}>
          {booklist.groups.length === 0 ? (
            <Text style={styles.empty}>
              No items on this list yet. Add them so vendors know what to quote.
            </Text>
          ) : (
            booklist.groups.map((group) => (
              <View key={group.category} style={styles.group}>
                <View style={styles.groupHead}>
                  <Ionicons
                    name={CATEGORY_ICON[group.category] ?? 'cube-outline'}
                    size={14}
                    color={colors.textMuted}
                  />
                  <Text style={styles.groupTitle}>{CATEGORY_LABEL[group.category]}</Text>
                  <Text style={styles.groupSubtotal}>
                    {group.subtotal > 0 ? formatNaira(group.subtotal) : '—'}
                  </Text>
                </View>
                {group.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    serial={serials.get(item.id) ?? 0}
                    hasQuote={hasPricingQuote}
                  />
                ))}
                {group.unpricedCount > 0 && (
                  <Text style={styles.groupNote}>
                    {group.unpricedCount} line{group.unpricedCount === 1 ? '' : 's'} awaiting a price
                  </Text>
                )}
              </View>
            ))
          )}

          {booklist.unavailableCount > 0 && (
            <Text style={styles.caveat}>
              {booklist.unavailableCount} line{booklist.unavailableCount === 1 ? '' : 's'} out of
              stock at this shop — not included in the total.
            </Text>
          )}

          {booklist.hasUnpricedItems && booklist.totalSource !== 'none' && (
            <Text style={styles.caveat}>
              This total covers only the lines that have a price — it isn't the full cost yet.
            </Text>
          )}

          {/* quotes.total_price is kept equal to the sum of the quote's
              available lines by a database trigger, so this should never
              fire. If it does, the two numbers on screen disagree and
              saying so is better than picking one and hoping. */}
          {!booklist.totalMatchesLines && (
            <Text style={styles.caveat}>
              The shop's total doesn't match these lines. Open the quote before paying.
            </Text>
          )}

          {isEditable && (onEdit || onPublish || onDelete) && (
            <View style={styles.actions}>
              {onEdit && (
                <Pressable
                  onPress={() => onEdit(booklist)}
                  style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit the booklist for ${booklist.school_name}`}
                >
                  <Ionicons name="create-outline" size={16} color={colors.navy} />
                  <Text style={styles.actionText}>Edit List</Text>
                </Pressable>
              )}

              {/* Publish only from 'draft'. A list already in the queue
                  has nowhere to be published to. */}
              {isDraft && onPublish && (
                <Pressable
                  onPress={() => onPublish(booklist)}
                  disabled={publishing}
                  style={({ pressed }) => [
                    styles.action,
                    styles.actionPrimary,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Publish ${booklist.school_name} to vendors`}
                >
                  <Ionicons
                    name={publishing ? 'hourglass-outline' : 'send-outline'}
                    size={15}
                    color={colors.onNavy}
                  />
                  <Text style={styles.actionPrimaryText}>
                    {publishing ? 'Publishing…' : 'Publish'}
                  </Text>
                </Pressable>
              )}

              {onDelete && (
                <Pressable
                  onPress={() => onDelete(booklist)}
                  style={({ pressed }) => [styles.action, styles.actionDanger, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete the booklist for ${booklist.school_name}`}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  <Text style={styles.actionDangerText}>Delete List</Text>
                </Pressable>
              )}
            </View>
          )}

          {liveQuotes > 0 && (
            <Pressable
              onPress={() => onPressQuotes?.(booklist)}
              style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>
                Compare {liveQuotes} quote{liveQuotes === 1 ? '' : 's'}
              </Text>
              <Ionicons name="arrow-forward" size={15} color={colors.onNavy} />
            </Pressable>
          )}
        </View>
      )}

      {/* The original photo, full size.
          Mounted only while open so a page of cards does not hold a
          page of decoded images in memory. */}
      <Modal
        visible={photoOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoOpen(false)}
      >
        <Pressable
          style={styles.lightbox}
          onPress={() => setPhotoOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close the photo"
        >
          {/* Swallows the press so tapping the picture itself does not
              close the thing you are trying to look at. */}
          <Pressable style={styles.lightboxInner} onPress={() => {}}>
            <View style={styles.lightboxHead}>
              <Text style={styles.lightboxTitle} numberOfLines={1}>
                {booklist.school_name || 'Booklist photo'}
              </Text>
              <Pressable
                onPress={() => setPhotoOpen(false)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={22} color={colors.onNavy} />
              </Pressable>
            </View>

            {photoLoading ? (
              <View style={styles.lightboxState}>
                <ActivityIndicator color={colors.onNavy} />
                <Text style={styles.lightboxNote}>Opening the photo…</Text>
              </View>
            ) : photoError ? (
              <View style={styles.lightboxState}>
                <Ionicons name="alert-circle-outline" size={22} color={colors.onNavy} />
                <Text style={styles.lightboxNote}>{photoError}</Text>
              </View>
            ) : photoUrl ? (
              <Image
                source={{ uri: photoUrl }}
                style={styles.lightboxImage}
                resizeMode="contain"
                accessibilityLabel={`The booklist photo for ${booklist.school_name}`}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...shadow.card,
  },
  head: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, alignItems: 'flex-start' },
  thumb: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  school: { fontSize: font.md, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  chipText: { fontSize: font.xs, fontWeight: '700' },

  totalWrap: { alignItems: 'flex-end', minWidth: 92 },
  totalCaption: { fontSize: font.xs, color: colors.textFaint },
  total: { fontSize: font.lg, fontWeight: '800', color: colors.navy },

  body: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  empty: { fontSize: font.md, color: colors.textMuted, paddingVertical: spacing.lg },

  group: { marginTop: spacing.lg },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  groupTitle: { flex: 1, fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  groupSubtotal: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  groupNote: { fontSize: font.xs, color: colors.warning, marginTop: 5 },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  // Fixed width so every title starts on the same x, up to "12." and
  // beyond; tabular-ish alignment without a monospace font.
  itemSerial: {
    fontSize: font.sm,
    fontWeight: '600',
    color: colors.textFaint,
    minWidth: 24,
    paddingTop: 1,
  },
  itemTitleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  // A filled chip, where the serial is bare faint text. Same information
  // density, deliberately different shape, so "1." and "2×" sitting
  // beside each other cannot be read as one number.
  itemQty: {
    backgroundColor: '#E4EAF5',
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 1,
  },
  itemQtyText: { fontSize: font.xs, fontWeight: '800', color: colors.navy },
  itemTitle: { fontSize: font.md, color: colors.text },
  itemAuthor: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  itemAuthorMissing: { color: colors.textFaint, fontStyle: 'italic' },
  itemParsed: { fontSize: font.xs, color: colors.orangeDark, fontStyle: 'italic', marginTop: 1 },
  itemPriceWrap: { alignItems: 'flex-end', minWidth: 78 },
  itemPrice: { fontSize: font.md, fontWeight: '700', color: colors.text },
  itemPriceMuted: { color: colors.textFaint, fontWeight: '500', fontSize: font.sm },
  itemPriceOut: { color: colors.textMuted, fontWeight: '600', fontSize: font.sm },
  itemUnitPrice: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  itemQtyWarn: { fontSize: font.xs, color: colors.warning, marginTop: 1 },

  lightbox: {
    flex: 1,
    backgroundColor: 'rgba(9,17,34,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  lightboxInner: { width: '100%', maxWidth: 720, gap: spacing.md },
  lightboxHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  lightboxTitle: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.onNavy },
  lightboxImage: {
    width: '100%',
    height: 460,
    maxHeight: '80%',
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  lightboxState: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  lightboxNote: { fontSize: font.sm, color: colors.onNavy, textAlign: 'center' },

  caveat: { fontSize: font.xs, color: colors.warning, marginTop: spacing.md, lineHeight: 16 },

  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    // 44 tall: these sit close together and one of them is destructive.
    minHeight: 44,
  },
  actionText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  actionPrimary: { backgroundColor: colors.navy, borderColor: colors.navy },
  actionPrimaryText: { fontSize: font.sm, fontWeight: '700', color: colors.onNavy },
  actionDanger: { borderColor: '#F0C4BF' },
  actionDangerText: { fontSize: font.sm, fontWeight: '700', color: colors.danger },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: radius.md,
    paddingVertical: 11,
    marginTop: spacing.lg,
  },
  ctaText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  pressed: { opacity: 0.85 },
});
