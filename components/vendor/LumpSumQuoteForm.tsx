import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NOTE_MAX, useLumpSumQuote } from '../../hooks/useLumpSumQuote';
import {
  MAX_RESPONSE_FILES,
  chooseResponseFiles,
  formatBytes,
  isPdf,
  takeResponsePhoto,
} from '../../lib/quoteFiles';
import {
  FileTile,
  FilesViewer,
  useSignedFileUrls,
  type ViewerItem,
} from '../booklists/QuoteResponseGallery';
import type { VendorQueueRow } from '../../types/db';
import { colors, spacing, radius, font, formatNaira } from '../../theme';

/**
 * Quote a photo-only booklist the way most shops already do: price it on
 * paper (or in a spreadsheet), attach that, and give one total.
 *
 * Shown by QuoteEditor only when the request has no itemised lines.
 * Anything with lines is priced line by line, and the server refuses a
 * single-total quote on such a request.
 */
export function LumpSumQuoteForm({
  vendorId,
  request,
  onSaved,
}: {
  vendorId: string | null;
  request: VendorQueueRow;
  onSaved: (status: 'draft' | 'sent') => void;
}) {
  const q = useLumpSumQuote({
    vendorId,
    requestId: request.request_id,
    initialQuoteId: request.my_quote_id,
  });
  const [picking, setPicking] = useState<'camera' | 'file' | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  // Uploaded pages need signed URLs for their thumbnails; waiting pages
  // are still local files and show straight from their own URI.
  const storedPaths = useMemo(
    () => q.pages.flatMap((p) => (p.kind === 'stored' ? [p.file.path] : [])),
    [q.pages]
  );
  const { urls } = useSignedFileUrls(storedPaths);
  const viewerItems: ViewerItem[] = q.pages.map((p) =>
    p.kind === 'stored'
      ? { url: urls[p.file.path] ?? null, type: p.file.type, name: p.file.name }
      : { url: p.file.uri, type: p.file.mimeType, name: p.file.fileName }
  );

  async function pick(kind: 'camera' | 'file') {
    setPicking(kind);
    q.clearError();
    try {
      if (kind === 'camera') {
        const photo = await takeResponsePhoto();
        if (photo) await q.addFiles([photo]);
      } else {
        const { files, rejected } = await chooseResponseFiles();
        if (files.length || rejected.length) await q.addFiles(files, rejected);
      }
    } catch (e) {
      q.setError((e as Error).message);
    } finally {
      setPicking(null);
    }
  }

  async function save(status: 'draft' | 'sent') {
    if (await q.save(status)) onSaved(status);
  }

  if (q.loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.navy} />
      </View>
    );
  }

  const alreadySent = q.status === 'sent';

  return (
    <View style={styles.wrap}>
      <View style={styles.intro}>
        <Ionicons name="document-attach-outline" size={18} color={colors.navy} />
        <View style={{ flex: 1 }}>
          <Text style={styles.introTitle}>Quote with your own priced sheet</Text>
          <Text style={styles.introText}>
            Price the list your usual way, then attach every page of it (photos or PDFs) and
            enter the total. The customer sees your pages, your note and the total, and pays the
            total.
          </Text>
        </View>
      </View>

      {q.locked && (
        <View style={[styles.message, styles.messageOk]}>
          <Ionicons name="lock-closed" size={15} color={colors.success} />
          <Text style={[styles.messageText, { color: colors.success }]}>
            {q.status === 'rejected'
              ? 'The customer declined this quote. It is closed.'
              : 'The customer accepted this quote. It can no longer be changed.'}
          </Text>
        </View>
      )}

      {/* 1. The pages */}
      <Text style={styles.label}>
        Your priced sheet{q.pages.length ? ` · ${q.pages.length} of ${MAX_RESPONSE_FILES} files` : ''}
      </Text>
      {q.pages.length === 0 && q.preparing === 0 ? (
        <Text style={styles.hint}>
          Add each page of your marked-up list: photos or PDFs, up to {MAX_RESPONSE_FILES} files,
          5 MB each. Large photos are shrunk automatically and stay readable.
        </Text>
      ) : (
        <View style={styles.grid}>
          {q.pages.map((page, i) => {
            const pending = page.kind === 'pending';
            const type = pending ? page.file.mimeType : page.file.type;
            const name = pending ? page.file.fileName : page.file.name;
            const size = page.file.size;
            return (
              <FileTile
                key={page.key}
                label={`Page ${i + 1}`}
                name={name}
                type={type}
                uri={isPdf(type) ? null : pending ? page.file.uri : urls[page.file.path] ?? null}
                meta={[formatBytes(size), pending ? 'not saved yet' : ''].filter(Boolean).join(' · ')}
                onPress={() => setViewing(i)}
                onRemove={q.locked || q.saving ? undefined : () => q.removePage(page.key)}
                onMoveEarlier={
                  q.locked || q.saving || i === 0 ? undefined : () => q.movePage(page.key, -1)
                }
                onMoveLater={
                  q.locked || q.saving || i === q.pages.length - 1
                    ? undefined
                    : () => q.movePage(page.key, 1)
                }
              />
            );
          })}
          {q.preparing > 0 && (
            <View style={styles.preparing}>
              <ActivityIndicator color={colors.navy} />
              <Text style={styles.hint}>Preparing {q.preparing}…</Text>
            </View>
          )}
        </View>
      )}

      {!q.locked && (
        <View style={styles.pickRow}>
          <PickButton
            icon="camera-outline"
            label={q.pages.length ? 'Photograph another page' : 'Take photo'}
            busy={picking === 'camera'}
            disabled={!!picking || q.busy || q.roomLeft <= 0}
            onPress={() => pick('camera')}
          />
          <PickButton
            icon="folder-open-outline"
            label={q.pages.length ? 'Add more files' : 'Choose photos or PDFs'}
            busy={picking === 'file'}
            disabled={!!picking || q.busy || q.roomLeft <= 0}
            onPress={() => pick('file')}
          />
        </View>
      )}

      <FilesViewer
        items={viewerItems}
        index={viewing != null && viewing < viewerItems.length ? viewing : null}
        onIndexChange={setViewing}
        onClose={() => setViewing(null)}
      />

      {/* 2. The total */}
      <Text style={styles.label}>Items total for this booklist (₦)</Text>
      <View style={styles.totalRow}>
        <TextInput
          value={q.totalText}
          onChangeText={q.setTotalText}
          editable={!q.locked}
          placeholder="0.00"
          placeholderTextColor={colors.textFaint}
          keyboardType="decimal-pad"
          style={[styles.input, styles.totalInput]}
          accessibilityLabel="Total price for this booklist in naira"
        />
        <Text style={styles.totalPreview}>
          {q.total != null && q.total > 0 ? formatNaira(q.total) : ''}
        </Text>
      </View>
      <Text style={styles.hint}>Books and items only — delivery goes in its own box below.</Text>

      {/* 2b. Delivery, as its own number */}
      <Text style={styles.label}>Delivery cost (₦)</Text>
      <View style={styles.totalRow}>
        <TextInput
          value={q.deliveryText}
          onChangeText={(t) => q.setDeliveryText(t.replace(/[^0-9.]/g, ''))}
          editable={!q.locked}
          placeholder="e.g. 2000 — or 0"
          placeholderTextColor={colors.textFaint}
          keyboardType="decimal-pad"
          style={[styles.input, styles.totalInput]}
          accessibilityLabel="Delivery cost in naira"
        />
        <Text style={styles.totalPreview}>
          {q.deliveryFee == null ? '' : q.deliveryFee === 0 ? 'Free' : formatNaira(q.deliveryFee)}
        </Text>
      </View>
      <Text style={styles.hint}>Required to submit. Enter 0 if delivery is free.</Text>

      {/* What the buyer will see before paying. */}
      <View style={styles.breakdown} accessibilityLabel="Quote breakdown the buyer will see">
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Items total</Text>
          <Text style={styles.breakdownValue}>{q.total != null ? formatNaira(q.total) : '—'}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Delivery fee</Text>
          <Text style={styles.breakdownValue}>
            {q.deliveryFee == null ? '—' : q.deliveryFee === 0 ? 'Free' : formatNaira(q.deliveryFee)}
          </Text>
        </View>
        <View style={[styles.breakdownRow, styles.breakdownTotalRow]}>
          <Text style={styles.breakdownTotalLabel}>Buyer pays</Text>
          <Text style={styles.breakdownTotalValue}>
            {formatNaira((q.total ?? 0) + (q.deliveryFee ?? 0))}
          </Text>
        </View>
      </View>

      {/* 3. The note */}
      <Text style={styles.label}>Note to the customer (optional)</Text>
      <TextInput
        value={q.note}
        onChangeText={q.setNote}
        editable={!q.locked}
        multiline
        maxLength={NOTE_MAX}
        placeholder="e.g. Two titles are out of stock and marked on the sheet. Ready for pickup in 2 days."
        placeholderTextColor={colors.textFaint}
        style={[styles.input, styles.noteInput]}
        accessibilityLabel="Note to the customer"
      />
      <Text style={styles.counter}>
        {q.note.length}/{NOTE_MAX}
      </Text>

      {(q.notice || q.error) && (
        <View style={[styles.message, q.error ? styles.messageError : styles.messageOk]}>
          <Ionicons
            name={q.error ? 'alert-circle' : 'checkmark-circle'}
            size={15}
            color={q.error ? colors.danger : colors.success}
          />
          <Text style={[styles.messageText, { color: q.error ? colors.danger : colors.success }]}>
            {q.error ?? q.notice}
          </Text>
        </View>
      )}

      {!q.locked && (
        <>
          <View style={styles.actions}>
            <Pressable
              onPress={() => save('sent')}
              disabled={!q.canSend}
              style={({ pressed }) => [
                styles.action,
                styles.actionPrimary,
                !q.canSend && styles.actionDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
            >
              {q.saving ? (
                <ActivityIndicator size="small" color={colors.onNavy} />
              ) : (
                <Text style={styles.actionPrimaryText}>
                  {alreadySent ? 'Resend Updated Quote' : 'Submit Quote to Customer'}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => save('draft')}
              disabled={q.busy}
              style={({ pressed }) => [styles.action, styles.actionGhost, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.actionGhostText}>Save as Draft</Text>
            </Pressable>
          </View>
          {!q.canSend && !q.saving && (
            <Text style={styles.hint}>
              {q.preparing > 0
                ? 'Preparing your files…'
                : !q.pages.length
                  ? 'Attach your priced sheet and enter a total to submit.'
                  : q.total == null || q.total <= 0
                    ? 'Enter a total above ₦0 to submit.'
                    : 'Enter your delivery cost (0 for free delivery) to submit.'}
            </Text>
          )}
          <Text style={styles.draftNote}>
            Drafts are private to your shop. The customer sees nothing until you submit.
          </Text>
        </>
      )}
    </View>
  );
}

function PickButton({
  icon,
  label,
  busy,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.pickBtn, disabled && styles.pickBtnOff, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.navy} />
      ) : (
        <Ionicons name={icon} size={16} color={colors.navy} />
      )}
      <Text style={styles.pickText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.sm },
  loading: { padding: spacing.xxl, alignItems: 'center' },
  pressed: { opacity: 0.85 },

  intro: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  introTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  introText: { fontSize: font.sm, color: colors.textMuted, lineHeight: 18, marginTop: 2 },

  label: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginTop: spacing.md },
  hint: { fontSize: font.xs, color: colors.textFaint, lineHeight: 16 },
  breakdown: {
    gap: 4,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    maxWidth: 360,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg },
  breakdownLabel: { fontSize: font.sm, color: colors.textMuted },
  breakdownValue: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  breakdownTotalRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6, marginTop: 2 },
  breakdownTotalLabel: { fontSize: font.md, fontWeight: '800', color: colors.text },
  breakdownTotalValue: { fontSize: font.md, fontWeight: '800', color: colors.navy },
  counter: { fontSize: font.xs, color: colors.textFaint, textAlign: 'right' },

  pickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    minHeight: 40,
  },
  pickBtnOff: { opacity: 0.5 },
  pickText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  preparing: {
    width: 104,
    height: 135,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },

  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontSize: font.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  totalInput: { width: 180 },
  totalPreview: { fontSize: font.lg, fontWeight: '800', color: colors.navy },
  noteInput: { minHeight: 84, textAlignVertical: 'top' },

  message: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  messageOk: { backgroundColor: '#E4F2E8' },
  messageError: { backgroundColor: '#FCEAE8' },
  messageText: { flex: 1, fontSize: font.sm, lineHeight: 18 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
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
  draftNote: { fontSize: font.xs, color: colors.textFaint },
});
