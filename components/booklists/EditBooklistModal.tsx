import { useEffect, useState } from 'react';
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
import {
  updateBookRequest,
  signBooklistImage,
  toEditableItems,
  blankEditableItem,
  DRAFT_STATUS,
  PUBLISHED_STATUS,
  describeBooklistError,
  type EditableItem,
} from '../../lib/booklistUpload';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';
import type { Booklist } from '../../types/db';

interface Props {
  /** The booklist to edit. Null closes the modal. */
  booklist: Booklist | null;
  onClose: () => void;
  /** Called after a successful save, with something to show on the hub. */
  onSaved: (message: string) => void | Promise<void>;
}

/** Which button is mid-flight, so only that one shows a spinner. */
type Pending = 'draft' | 'publish' | null;

/**
 * Edit a saved booklist: its school and class, and every line on it.
 *
 * Seeded from the `Booklist` the hub already holds rather than re-reading
 * it — useBooklists has the items, the quotes and the order in memory, so
 * a second query would only add a spinner between the press and the form.
 *
 * The photo is the exception. image_path is an object path in a private
 * bucket, so it has to be signed, and the signature is fetched only when
 * the buyer actually opens the preview: most edits never look at it, and
 * a signed URL that goes unused is a wasted round trip on a phone.
 */
export function EditBooklistModal({ booklist, onClose, onSaved }: Props) {
  const { isMobile } = useLayout();

  const [school, setSchool] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [items, setItems] = useState<EditableItem[]>([]);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);

  const [showPhoto, setShowPhoto] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  const visible = booklist !== null;
  const isDraft = booklist?.status === DRAFT_STATUS;

  // Seed from the booklist, keyed on its id: re-seeding on every render
  // would overwrite what the buyer is typing, and keying on the object
  // would do the same on every refresh tick from the hub.
  useEffect(() => {
    if (!booklist) return;
    setSchool(booklist.school_name);
    setClassLevel(booklist.class_level);
    setItems(toEditableItems(booklist.items));
    setError(null);
    setPending(null);
    setShowPhoto(false);
    setPhotoUrl(null);
  }, [booklist?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function togglePhoto() {
    if (showPhoto) {
      setShowPhoto(false);
      return;
    }
    setShowPhoto(true);
    if (photoUrl || !booklist?.image_path) return;

    setPhotoLoading(true);
    const url = await signBooklistImage(booklist.image_path);
    setPhotoUrl(url);
    setPhotoLoading(false);
  }

  function patchItem(key: string, patch: Partial<EditableItem>) {
    setItems((current) => current.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  }

  function removeItem(key: string) {
    setItems((current) => current.filter((i) => i.key !== key));
  }

  function addItem() {
    setItems((current) => [...current, blankEditableItem()]);
  }

  const filled = items.filter((i) => i.title.trim().length > 0);
  const canSave = Boolean(booklist) && school.trim().length > 0 && pending === null;

  async function save(publish: boolean) {
    if (!canSave || !booklist) return;
    setPending(publish ? 'publish' : 'draft');
    setError(null);

    try {
      // Publishing an empty list puts a row in every vendor's queue with
      // nothing to price. Caught here so the buyer sees it beside the
      // button rather than after a round trip.
      if (publish && filled.length === 0) {
        throw new Error('Add at least one book before sending this list to vendors.');
      }

      await updateBookRequest(
        booklist.id,
        {
          school_name: school,
          class_level: classLevel,
          // A published list stays published: re-saving it must not
          // quietly pull it back out of vendors' queues while they are
          // part-way through pricing it.
          status: publish ? PUBLISHED_STATUS : isDraft ? DRAFT_STATUS : undefined,
        },
        items
      );

      await onSaved(
        publish
          ? `Booklist sent to vendors — ${filled.length} item${filled.length === 1 ? '' : 's'}.`
          : 'Changes saved.'
      );
      onClose();
    } catch (e) {
      setError(describeBooklistError(e));
      setPending(null);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={pending ? undefined : onClose}>
      <Pressable style={styles.scrim} onPress={pending ? undefined : onClose} accessibilityLabel="Close" />
      <View style={styles.centre} pointerEvents="box-none">
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Edit booklist</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {isDraft ? 'Draft — no vendor has seen this yet' : 'Already sent to vendors'}
              </Text>
            </View>
            <Pressable onPress={onClose} disabled={pending !== null} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>School</Text>
            <TextInput
              value={school}
              onChangeText={setSchool}
              placeholder="St. Columbanus Secondary School"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              autoCapitalize="words"
              accessibilityLabel="School name"
              accessibilityHint="Required."
            />

            <Text style={styles.label}>Class or grade</Text>
            <TextInput
              value={classLevel}
              onChangeText={setClassLevel}
              placeholder="JSS 1"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              accessibilityLabel="Class or grade level"
            />

            {booklist?.image_path && (
              <>
                <Pressable
                  onPress={togglePhoto}
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

                {showPhoto &&
                  (photoLoading ? (
                    <View style={styles.photoLoading}>
                      <ActivityIndicator color={colors.navy} />
                    </View>
                  ) : photoUrl ? (
                    <Image
                      source={{ uri: photoUrl }}
                      style={styles.photo}
                      resizeMode="contain"
                      accessibilityLabel="The original booklist photo"
                    />
                  ) : (
                    <Text style={styles.photoFailed}>
                      That photo could not be loaded. The link may have expired — close and reopen
                      this list to try again.
                    </Text>
                  ))}
              </>
            )}

            <View style={styles.itemsHead}>
              <Text style={styles.label}>Books and items</Text>
              <Text style={styles.count}>
                {filled.length} item{filled.length === 1 ? '' : 's'}
              </Text>
            </View>

            {items.length === 0 && (
              <Text style={styles.empty}>
                Nothing on this list yet. Add the books and vendors will price them.
              </Text>
            )}

            {items.map((item) => (
              <View key={item.key} style={styles.row}>
                <View style={styles.rowFields}>
                  <TextInput
                    value={item.title}
                    onChangeText={(title) => patchItem(item.key, { title })}
                    placeholder="Book or item title"
                    placeholderTextColor={colors.textFaint}
                    style={[styles.rowInput, styles.rowTitle]}
                    multiline
                    accessibilityLabel="Title"
                  />
                  <TextInput
                    value={item.author}
                    onChangeText={(author) => patchItem(item.key, { author })}
                    placeholder="Author or publisher (optional)"
                    placeholderTextColor={colors.textFaint}
                    style={[styles.rowInput, styles.rowAuthor]}
                    accessibilityLabel="Author or publisher"
                  />
                </View>
                <Pressable
                  onPress={() => removeItem(item.key)}
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
              accessibilityLabel="Add a book item"
            >
              <Ionicons name="add" size={18} color={colors.navy} />
              <Text style={styles.addText}>Add Book Item</Text>
            </Pressable>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={15} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={{ height: spacing.md }} />
          </ScrollView>

          <View style={[styles.actions, isMobile && styles.actionsMobile]}>
            <Pressable
              onPress={() => save(false)}
              disabled={!canSave}
              style={({ pressed }) => [
                styles.btn,
                styles.btnGhost,
                !canSave && styles.btnGhostDisabled,
                pressed && canSave && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save changes without sending to vendors"
            >
              {pending === 'draft' ? (
                <View style={styles.busy}>
                  <ActivityIndicator size="small" color={colors.textMuted} />
                  <Text style={styles.btnGhostText}>Saving…</Text>
                </View>
              ) : (
                <Text style={styles.btnGhostText} numberOfLines={1}>
                  {isDraft ? 'Save Draft' : 'Save Changes'}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => save(true)}
              disabled={!canSave}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                !canSave && styles.btnDisabled,
                pressed && canSave && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Save and send this booklist to vendors"
            >
              {pending === 'publish' ? (
                <View style={styles.busy}>
                  <ActivityIndicator size="small" color={colors.onNavy} />
                  <Text style={styles.btnPrimaryText}>Sending…</Text>
                </View>
              ) : (
                <Text style={styles.btnPrimaryText} numberOfLines={1}>
                  Save &amp; Send to Vendors
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
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },

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
  photoLoading: {
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  photoFailed: {
    fontSize: font.sm,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.md,
  },

  itemsHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  count: { fontSize: font.sm, color: colors.textFaint, fontWeight: '600' },
  empty: {
    fontSize: font.sm,
    color: colors.textMuted,
    paddingVertical: spacing.md,
    lineHeight: 18,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
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
  btnGhostDisabled: { opacity: 0.5 },
  btnGhostText: { color: colors.textMuted, fontWeight: '700', fontSize: font.md },
  btnPrimary: { flex: 1, backgroundColor: colors.orange },
  btnPrimaryText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  btnDisabled: { backgroundColor: colors.borderStrong },
  busy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pressed: { opacity: 0.85 },
});
