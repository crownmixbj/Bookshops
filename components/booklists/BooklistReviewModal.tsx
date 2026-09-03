import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  Image,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../utils/supabase';
import {
  uploadBooklistImage,
  parseBooklistImage,
  draftImageKey,
  blankItem,
  guessCategory,
  DRAFT_STATUS,
  PUBLISHED_STATUS,
  describeBooklistError,
  type PickedImage,
  type ParsedItem,
} from '../../lib/booklistUpload';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

interface Props {
  visible: boolean;
  userId: string | null;
  /** The photo the hub already picked. Upload and parsing start from it. */
  image: PickedImage | null;
  onClose: () => void;
  /** Called after the request row and its items exist. */
  onSubmitted: (message: string) => void | Promise<void>;
}

type Phase = 'working' | 'review' | 'submitting';

/** Which button is mid-flight, so only that one shows a spinner. */
type Pending = 'draft' | 'publish' | null;

/**
 * Review and edit a parsed booklist before anything is sent for quotes.
 *
 * The order here is the whole point of the screen: the photo is uploaded
 * and parsed, and then EVERYTHING stops until a human confirms it. No
 * book_requests row is written while this modal is open — a buyer who
 * closes it leaves nothing behind but an orphaned object in storage.
 *
 * That is the opposite of CreateBooklistModal, which inserts first and
 * treats the photo as best-effort decoration. It is the right trade for
 * a typed list and the wrong one for a parsed one: OCR gets titles
 * wrong, and a wrong title is a wrong quote.
 */
export function BooklistReviewModal({ visible, userId, image, onClose, onSubmitted }: Props) {
  const { isMobile } = useLayout();

  const [phase, setPhase] = useState<Phase>('working');
  const [pending, setPending] = useState<Pending>(null);
  const [step, setStep] = useState('Uploading your photo…');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [school, setSchool] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);

  const reset = useCallback(() => {
    setPhase('working');
    setPending(null);
    setStep('Uploading your photo…');
    setError(null);
    setNotice(null);
    setSchool('');
    setClassLevel('');
    setItems([]);
    setImagePath(null);
    setShowPhoto(false);
  }, []);

  /**
   * Upload, then parse.
   *
   * `cancelled` guards every setState after an await: the buyer can
   * close this modal mid-parse, and without the guard the parse would
   * come back and repopulate a form that is no longer on screen — so
   * reopening it showed the previous photo's books.
   */
  useEffect(() => {
    if (!visible || !image || !userId) return;
    let cancelled = false;

    (async () => {
      reset();
      let path: string | null = null;

      try {
        setStep('Uploading your photo…');
        path = await uploadBooklistImage(userId, draftImageKey(), image);
        if (cancelled) return;
        setImagePath(path);
      } catch (e) {
        if (cancelled) return;
        // Not fatal. The photo is a reference for the buyer and for the
        // vendor; the list itself is what gets quoted. Fall through to
        // an empty review form rather than dead-ending them.
        setNotice(
          `Your photo could not be uploaded (${(e as Error).message}). You can still add the books by hand.`
        );
      }

      try {
        setStep('Reading your list…');
        const result = path
          ? await parseBooklistImage(path)
          : { school_name: '', class_level: '', items: [], parsed: false, note: '' };
        if (cancelled) return;

        setSchool(result.school_name);
        setClassLevel(result.class_level);
        setItems(result.items.length ? result.items : [blankItem()]);
        if (result.note) setNotice(result.note);
      } catch (e) {
        if (cancelled) return;
        setNotice(
          `The list could not be read automatically (${(e as Error).message}). Add the books yourself and vendors will quote them.`
        );
        setItems([blankItem()]);
      } finally {
        if (!cancelled) setPhase('review');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, image, userId, reset]);

  /* ---------------- item editing ---------------- */

  function patchItem(id: string, patch: Partial<ParsedItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function addItem() {
    setItems((current) => [...current, blankItem()]);
  }

  const selected = items.filter((item) => item.selected && item.title.trim().length > 0);
  const canSubmit =
    phase === 'review' && Boolean(userId) && school.trim().length > 0 && selected.length > 0;

  /* ---------------- submission ---------------- */

  /**
   * Saves the reviewed list.
   *
   * `publish` decides the status in the SAME insert rather than an
   * insert-then-update: a second call that fails would leave the buyer
   * looking at a success message for a list no vendor can see.
   */
  async function handleSave(publish: boolean) {
    if (!canSubmit || !userId) return;
    setPhase('submitting');
    setPending(publish ? 'publish' : 'draft');
    setError(null);

    try {
      const { data: created, error: insertError } = await supabase
        .from('book_requests')
        .insert({
          buyer_id: userId,
          school_name: school.trim(),
          class_level: classLevel.trim(),
          image_path: imagePath,
          // PUBLISHED_STATUS is the SINGULAR 'pending_quote' — the value
          // vendor_request_queue() filters on. See lib/booklistUpload.ts.
          status: publish ? PUBLISHED_STATUS : DRAFT_STATUS,
        })
        .select('id')
        .single();
      if (insertError) throw insertError;

      const requestId = created.id as string;

      // Only the checked lines. An unchecked line means "I already own
      // this", and sending it anyway is how a buyer ends up paying for a
      // second copy of a book that is on their shelf.
      const rows = selected.map((item, i) => ({
        request_id: requestId,
        title: item.title.trim(),
        author: item.author.trim() || null,
        category: item.title.trim() ? guessCategory(item.title) : item.category,
        quantity: item.quantity,
        // True only for lines that came back from the parser untouched
        // in origin — it flags rows a vendor should read with suspicion.
        parsed: item.id.startsWith('mock-') || item.id.startsWith('parsed-'),
        position: i,
      }));

      const { error: itemsError } = await supabase.from('book_request_items').insert(rows);

      if (itemsError) {
        // bookshops_booklist_author.sql may not have been run on this
        // project yet. Dropping the author and retrying keeps the
        // booklist usable instead of failing the whole submission over
        // one optional field.
        const missingAuthor =
          /author/i.test(itemsError.message) &&
          /(column|schema cache|does not exist)/i.test(itemsError.message);
        if (!missingAuthor) throw itemsError;

        const { error: retryError } = await supabase
          .from('book_request_items')
          .insert(rows.map(({ author, ...rest }) => rest));
        if (retryError) throw retryError;
      }

      const count = `${selected.length} item${selected.length === 1 ? '' : 's'}`;
      await onSubmitted(
        publish
          ? `Booklist sent for quotes — ${count} for ${school.trim()}.`
          : `Draft saved — ${count} for ${school.trim()}. Publish it when you're ready for quotes.`
      );
      reset();
      onClose();
    } catch (e) {
      setError(describeBooklistError(e));
      setPhase('review');
      setPending(null);
    }
  }

  /* ---------------- render ---------------- */

  const busy = phase === 'working' || phase === 'submitting';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? undefined : onClose}>
      <Pressable
        style={styles.scrim}
        onPress={busy ? undefined : onClose}
        accessibilityLabel="Close"
      />
      <View style={styles.centre} pointerEvents="box-none">
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Check your booklist</Text>
              <Text style={styles.subtitle}>
                Fix anything we read wrong, and untick books you already own.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              disabled={phase === 'submitting'}
              hitSlop={8}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          {phase === 'working' ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.navy} />
              <Text style={styles.loadingText}>{step}</Text>
            </View>
          ) : (
            <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
              {/* ---- header info ---- */}
              <Text style={styles.label}>School</Text>
              <TextInput
                value={school}
                onChangeText={setSchool}
                placeholder="St. Columbanus Secondary School"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                autoCapitalize="words"
                accessibilityLabel="School name"
                accessibilityHint="Required. The school this booklist is for."
              />

              <Text style={styles.label}>Class or grade</Text>
              <TextInput
                value={classLevel}
                onChangeText={setClassLevel}
                placeholder="JSS 1"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                accessibilityLabel="Class or grade level"
                accessibilityHint="Optional. Helps shops quote the right editions."
              />

              {/* ---- original photo, for cross-checking ---- */}
              {image && (
                <>
                  <Pressable
                    onPress={() => setShowPhoto((v) => !v)}
                    style={({ pressed }) => [styles.photoToggle, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showPhoto }}
                    accessibilityLabel={showPhoto ? 'Hide the original photo' : 'Show the original photo'}
                  >
                    <Ionicons name="image-outline" size={17} color={colors.navy} />
                    <Text style={styles.photoToggleText}>
                      {showPhoto ? 'Hide original photo' : 'Show original photo'}
                    </Text>
                    <Ionicons
                      name={showPhoto ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.textMuted}
                    />
                  </Pressable>

                  {showPhoto && (
                    // The local uri, not a signed URL: the file is already
                    // on the device, so it renders instantly and still
                    // works if the upload failed.
                    <Image
                      source={{ uri: image.uri }}
                      style={styles.photo}
                      resizeMode="contain"
                      accessibilityLabel="The booklist photo you uploaded"
                    />
                  )}
                </>
              )}

              {notice && (
                <View style={styles.notice}>
                  <Ionicons name="information-circle" size={15} color={colors.warning} />
                  <Text style={styles.noticeText}>{notice}</Text>
                </View>
              )}

              {/* ---- the list ---- */}
              <View style={styles.itemsHead}>
                <Text style={styles.label}>Books and items</Text>
                <Text style={styles.selectedCount}>
                  {selected.length} of {items.length} selected
                </Text>
              </View>

              {items.map((item) => (
                <View key={item.id} style={[styles.row, !item.selected && styles.rowOff]}>
                  <Pressable
                    onPress={() => patchItem(item.id, { selected: !item.selected })}
                    hitSlop={8}
                    style={styles.check}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.selected }}
                    accessibilityLabel={item.title || 'Untitled item'}
                    accessibilityHint="Untick if you already own this one"
                  >
                    <Ionicons
                      name={item.selected ? 'checkbox' : 'square-outline'}
                      size={21}
                      color={item.selected ? colors.navy : colors.borderStrong}
                    />
                  </Pressable>

                  <View style={styles.rowFields}>
                    <TextInput
                      value={item.title}
                      onChangeText={(title) => patchItem(item.id, { title })}
                      placeholder="Book or item title"
                      placeholderTextColor={colors.textFaint}
                      style={[styles.rowInput, styles.rowTitle]}
                      multiline
                      accessibilityLabel="Title"
                    />
                    <TextInput
                      value={item.author}
                      onChangeText={(author) => patchItem(item.id, { author })}
                      placeholder="Author or publisher (optional)"
                      placeholderTextColor={colors.textFaint}
                      style={[styles.rowInput, styles.rowAuthor]}
                      accessibilityLabel="Author or publisher"
                    />
                  </View>

                  <Pressable
                    onPress={() => removeItem(item.id)}
                    hitSlop={8}
                    style={styles.delete}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.title || 'this line'}`}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                </View>
              ))}

              <Pressable
                onPress={addItem}
                style={({ pressed }) => [styles.add, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Add an item"
              >
                <Ionicons name="add" size={18} color={colors.navy} />
                <Text style={styles.addText}>Add item</Text>
              </Pressable>

              {error && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={15} color={colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <View style={{ height: spacing.md }} />
            </ScrollView>
          )}

          {/* Two ways out, because a booklist is rarely finished in one
              sitting: keep it private and keep editing, or send it now.
              Same pair as EditBooklistModal, so the two screens behave
              alike. */}
          <View style={[styles.actions, isMobile && styles.actionsMobile]}>
            <Pressable
              onPress={() => handleSave(false)}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.btn,
                styles.btnGhost,
                !canSubmit && styles.btnGhostDisabled,
                pressed && canSubmit && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save as a draft"
              accessibilityHint="Keeps the list private so you can finish it later."
            >
              {pending === 'draft' ? (
                <View style={styles.busy}>
                  <ActivityIndicator size="small" color={colors.textMuted} />
                  <Text style={styles.btnGhostText}>Saving…</Text>
                </View>
              ) : (
                <Text style={styles.btnGhostText} numberOfLines={1}>
                  Save as Draft
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => handleSave(true)}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                !canSubmit && styles.btnDisabled,
                pressed && canSubmit && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Send this booklist to vendors for quotes"
            >
              {pending === 'publish' ? (
                <View style={styles.busy}>
                  <ActivityIndicator size="small" color={colors.onNavy} />
                  <Text style={styles.btnPrimaryText}>Sending…</Text>
                </View>
              ) : (
                <Text style={styles.btnPrimaryText} numberOfLines={1}>
                  Send to Vendors{selected.length > 0 ? ` (${selected.length})` : ''}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '92%',
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
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, lineHeight: 17 },

  loading: { padding: spacing.xxl, alignItems: 'center', gap: spacing.md },
  loadingText: { fontSize: font.md, color: colors.textMuted },

  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted, marginBottom: 5 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: font.md,
    color: colors.text,
    marginBottom: spacing.md,
  },

  photoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.md,
    minHeight: 44,
  },
  photoToggleText: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.navy },
  photo: {
    width: '100%',
    height: 320,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.md,
  },

  itemsHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  selectedCount: { fontSize: font.sm, color: colors.textFaint, fontWeight: '600' },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  // Dimmed, not hidden: the buyer can see what they excluded and change
  // their mind without re-typing it.
  rowOff: { opacity: 0.45, backgroundColor: colors.surfaceMuted },
  check: { paddingTop: 8 },
  rowFields: { flex: 1 },
  rowInput: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    color: colors.text,
    borderRadius: radius.sm,
  },
  rowTitle: { fontSize: font.md, fontWeight: '600', minHeight: 34 },
  rowAuthor: { fontSize: font.sm, color: colors.textMuted },
  delete: { paddingTop: 8, paddingHorizontal: 2 },

  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: 12,
    marginTop: spacing.xs,
    minHeight: 44,
  },
  addText: { fontSize: font.md, fontWeight: '700', color: colors.navy },

  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeText: { flex: 1, fontSize: font.sm, color: colors.warning, lineHeight: 18 },
  errorBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: '#FCEAE8',
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger, lineHeight: 18 },

  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  btn: {
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  actionsMobile: { flexDirection: 'column-reverse' },
  btnGhost: { flex: 1, borderWidth: 1, borderColor: colors.border, minWidth: 96 },
  btnGhostDisabled: { opacity: 0.5 },
  btnGhostText: { color: colors.textMuted, fontWeight: '700', fontSize: font.md },
  btnPrimary: { flex: 1, backgroundColor: colors.orange },
  btnPrimaryText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  btnDisabled: { backgroundColor: colors.borderStrong },
  busy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pressed: { opacity: 0.85 },
});
