import {
  View,
  Text,
  TextInput,
  Pressable,
  Switch,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { VendorQueueRow } from '../../types/db';
import type { DraftLine } from '../../hooks/useVendorDashboard';
import { colors, spacing, radius, font, formatNaira } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

interface Props {
  request: VendorQueueRow;
  lines: DraftLine[];
  totals: {
    itemCount: number;
    unavailableCount: number;
    unpricedCount: number;
    estimatedTotal: number;
  };
  loading: boolean;
  saving: boolean;
  notice: string | null;
  error: Error | null;
  onPriceChange: (requestItemId: string, text: string) => void;
  onAvailabilityChange: (requestItemId: string, available: boolean) => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  onClose: () => void;
}

function LineRow({
  line,
  compact,
  onPriceChange,
  onAvailabilityChange,
}: {
  line: DraftLine;
  compact: boolean;
  onPriceChange: (id: string, text: string) => void;
  onAvailabilityChange: (id: string, available: boolean) => void;
}) {
  const price = Number(line.priceText.replace(/[^0-9.]/g, ''));
  const subtotal =
    line.is_available && line.priceText && Number.isFinite(price) ? price * line.quantity : null;

  const priceInput = (
    <TextInput
      value={line.priceText}
      onChangeText={(t) => onPriceChange(line.request_item_id, t)}
      editable={line.is_available}
      placeholder={line.is_available ? '0.00' : '—'}
      placeholderTextColor={colors.textFaint}
      keyboardType="decimal-pad"
      style={[styles.priceInput, !line.is_available && styles.priceInputOff]}
      accessibilityLabel={`Unit price for ${line.title}`}
    />
  );

  const availability = (
    <View style={styles.switchWrap}>
      <Switch
        value={line.is_available}
        onValueChange={(v) => onAvailabilityChange(line.request_item_id, v)}
        trackColor={{ false: colors.borderStrong, true: colors.success }}
        thumbColor={colors.surface}
        accessibilityLabel={`${line.title} in stock`}
      />
      <Text style={[styles.switchText, line.is_available && styles.switchTextOn]}>
        {line.is_available ? 'ON' : 'OFF'}
      </Text>
    </View>
  );

  if (compact) {
    return (
      <View style={[styles.cardLine, !line.is_available && styles.lineOff]}>
        <Text style={styles.lineTitle} numberOfLines={2}>
          {line.title}
        </Text>
        <Text style={styles.lineQty}>Qty {line.quantity}</Text>
        <View style={styles.cardLineControls}>
          {priceInput}
          {availability}
        </View>
        <Text style={styles.lineSubtotal}>
          {subtotal == null ? '—' : formatNaira(subtotal)}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.row, !line.is_available && styles.lineOff]}>
      <Text style={[styles.cell, styles.colTitle]} numberOfLines={2}>
        {line.title}
      </Text>
      <Text style={[styles.cell, styles.colQty]}>{line.quantity}</Text>
      <View style={styles.colPrice}>{priceInput}</View>
      <View style={styles.colAvail}>{availability}</View>
      <Text style={[styles.cellStrong, styles.colSubtotal]}>
        {subtotal == null ? '—' : formatNaira(subtotal)}
      </Text>
    </View>
  );
}

/**
 * The itemised quote editor.
 *
 * Prices are held as text while typing, so a half-entered "2," never
 * gets coerced to a number and fights the input. They become numbers
 * only at save time and when computing the running total.
 *
 * Turning a line OFF keeps it on the quote but drops it from the total,
 * so the buyer can see the item was considered and is unavailable rather
 * than silently missing from their list.
 */
export function QuoteEditor({
  request,
  lines,
  totals,
  loading,
  saving,
  notice,
  error,
  onPriceChange,
  onAvailabilityChange,
  onSaveDraft,
  onSubmit,
  onClose,
}: Props) {
  const { isMobile } = useLayout();
  const alreadySent = request.my_quote_status === 'sent' || request.my_quote_status === 'accepted';

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {request.customer_name ?? request.reference} — Active Request Details
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {[request.school_name, request.class_level].filter(Boolean).join(' · ')}
            {request.customer_phone ? ` · ${request.customer_phone}` : ''}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close request details">
          <Ionicons name="chevron-up" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.navy} />
        </View>
      ) : lines.length === 0 ? (
        <View style={styles.loading}>
          <Text style={styles.emptyText}>
            This booklist has no itemised lines yet, so there is nothing to price. The buyer
            may have uploaded a photo without adding the items.
          </Text>
        </View>
      ) : (
        <>
          {!isMobile && (
            <View style={styles.headRow}>
              <Text style={[styles.th, styles.colTitle]}>Book Title</Text>
              <Text style={[styles.th, styles.colQty]}>Qty</Text>
              <Text style={[styles.th, styles.colPrice]}>Unit Price (₦)</Text>
              <Text style={[styles.th, styles.colAvail]}>Availability</Text>
              <Text style={[styles.th, styles.colSubtotal]}>Subtotal</Text>
            </View>
          )}

          <ScrollView style={styles.lines} nestedScrollEnabled>
            {lines.map((line) => (
              <LineRow
                key={line.request_item_id}
                line={line}
                compact={isMobile}
                onPriceChange={onPriceChange}
                onAvailabilityChange={onAvailabilityChange}
              />
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.footerInfo}>
              <Text style={styles.footerCount}>
                Total items: {totals.itemCount}
                {totals.unavailableCount > 0
                  ? ` (${totals.unavailableCount} unavailable)`
                  : ''}
              </Text>
              {totals.unpricedCount > 0 && (
                <Text style={styles.footerWarn}>
                  {totals.unpricedCount} item{totals.unpricedCount === 1 ? '' : 's'} still need a
                  price before you can submit
                </Text>
              )}
            </View>

            <View style={styles.footerTotal}>
              <Text style={styles.footerTotalLabel}>Est. Total</Text>
              <Text style={styles.footerTotalValue}>{formatNaira(totals.estimatedTotal)}</Text>
            </View>
          </View>

          {(notice || error) && (
            <View style={[styles.message, error ? styles.messageError : styles.messageOk]}>
              <Ionicons
                name={error ? 'alert-circle' : 'checkmark-circle'}
                size={15}
                color={error ? colors.danger : colors.success}
              />
              <Text style={[styles.messageText, { color: error ? colors.danger : colors.success }]}>
                {error ? error.message : notice}
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={onSubmit}
              disabled={saving || totals.unpricedCount > 0}
              style={({ pressed }) => [
                styles.action,
                styles.actionPrimary,
                (saving || totals.unpricedCount > 0) && styles.actionDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.onNavy} />
              ) : (
                <Text style={styles.actionPrimaryText}>
                  {alreadySent ? 'Resend Updated Quote' : 'Submit Quote to Customer'}
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={onSaveDraft}
              disabled={saving}
              style={({ pressed }) => [styles.action, styles.actionGhost, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.actionGhostText}>Save as Draft</Text>
            </Pressable>
          </View>

          <Text style={styles.draftNote}>
            Drafts are private to your shop — the customer sees nothing until you submit.
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  th: { fontSize: font.xs, fontWeight: '800', color: colors.textMuted },

  lines: { maxHeight: 420 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineOff: { backgroundColor: colors.surfaceMuted },
  cell: { fontSize: font.md, color: colors.text },
  cellStrong: { fontSize: font.md, color: colors.text, fontWeight: '700' },

  colTitle: { flex: 3, paddingRight: spacing.md },
  colQty: { flex: 0.6, paddingRight: spacing.sm },
  colPrice: { flex: 1.6, paddingRight: spacing.md },
  colAvail: { flex: 1.2, paddingRight: spacing.md },
  colSubtotal: { flex: 1.2, textAlign: 'right' },

  priceInput: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    fontSize: font.md,
    color: colors.text,
    backgroundColor: colors.surface,
    minWidth: 90,
  },
  priceInputOff: { backgroundColor: colors.surfaceMuted, color: colors.textFaint },

  switchWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  switchText: { fontSize: 10, fontWeight: '800', color: colors.textFaint },
  switchTextOn: { color: colors.success },

  cardLine: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  cardLineControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  lineTitle: { fontSize: font.md, fontWeight: '600', color: colors.text },
  lineQty: { fontSize: font.sm, color: colors.textMuted },
  lineSubtotal: { fontSize: font.md, fontWeight: '700', color: colors.text, textAlign: 'right' },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  footerInfo: { flex: 1, minWidth: 180 },
  footerCount: { fontSize: font.md, fontWeight: '700', color: colors.text },
  footerWarn: { fontSize: font.xs, color: colors.warning, marginTop: 2 },
  footerTotal: { alignItems: 'flex-end' },
  footerTotalLabel: { fontSize: font.xs, color: colors.textMuted, fontWeight: '600' },
  footerTotalValue: { fontSize: font.xl, fontWeight: '800', color: colors.navy },

  message: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  messageOk: { backgroundColor: '#E4F2E8' },
  messageError: { backgroundColor: '#FCEAE8' },
  messageText: { flex: 1, fontSize: font.sm, lineHeight: 18 },

  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  action: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    flexGrow: 1,
  },
  actionPrimary: { backgroundColor: colors.navy },
  actionPrimaryText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  actionGhost: { borderWidth: 1, borderColor: colors.navy },
  actionGhostText: { color: colors.navy, fontWeight: '700', fontSize: font.md },
  actionDisabled: { backgroundColor: colors.borderStrong },

  draftNote: {
    fontSize: font.xs,
    color: colors.textFaint,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },

  loading: { padding: spacing.xxl, alignItems: 'center' },
  emptyText: {
    fontSize: font.md,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 380,
    lineHeight: 20,
  },
  pressed: { opacity: 0.85 },
});
