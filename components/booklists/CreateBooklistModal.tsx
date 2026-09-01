import { useState } from 'react';
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
  pickBooklistImage,
  uploadBooklistImage,
  parseBooklistImage,
  type PickedImage,
} from '../../lib/booklistUpload';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

interface Props {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}

/**
 * Create-booklist flow: name the list, optionally attach a photo of it,
 * then submit for quotes.
 *
 * Order of operations matters. The request row is inserted FIRST so the
 * storage object can be keyed by its id, and so a failed upload leaves a
 * usable request behind rather than losing what the user typed. The
 * upload and the parse are then best-effort: neither failing should
 * discard a booklist the user has already created.
 */
export function CreateBooklistModal({ visible, userId, onClose, onCreated }: Props) {
  const { isMobile } = useLayout();
  const [school, setSchool] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [image, setImage] = useState<PickedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reset() {
    setSchool('');
    setClassLevel('');
    setImage(null);
    setError(null);
    setNotice(null);
    setStep(null);
  }

  async function handlePick(source: 'library' | 'camera') {
    setError(null);
    try {
      const picked = await pickBooklistImage(source);
      if (picked) setImage(picked);
    } catch (e) {
      setError(e as Error);
    }
  }

  async function handleSubmit() {
    if (!userId || !school.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setStep('Creating booklist…');
      const { data: created, error: insertError } = await supabase
        .from('book_requests')
        .insert({
          buyer_id: userId,
          school_name: school.trim(),
          class_level: classLevel.trim(),
          status: 'pending_quote',
        })
        .select('id')
        .single();
      if (insertError) throw insertError;

      const requestId = created.id as string;

      if (image) {
        try {
          setStep('Uploading photo…');
          const path = await uploadBooklistImage(userId, requestId, image);

          await supabase.from('book_requests').update({ image_path: path }).eq('id', requestId);

          setStep('Reading the list…');
          const result = await parseBooklistImage(path);
          if (result.items.length > 0) {
            await supabase.from('book_request_items').insert(
              result.items.map((item, i) => ({
                request_id: requestId,
                title: item.title,
                category: item.category,
                quantity: item.quantity,
                unit_price: item.unit_price,
                parsed: true,
                position: i,
              }))
            );
          } else {
            setNotice(result.note);
          }
        } catch (uploadError) {
          // The booklist exists; only the photo failed. Say so plainly
          // rather than rolling back work the user has done.
          setNotice(
            `Booklist created, but the photo could not be uploaded: ${
              (uploadError as Error).message
            }`
          );
        }
      }

      await onCreated();
      if (!notice) {
        reset();
        onClose();
      }
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  const canSubmit = Boolean(userId) && school.trim().length > 0 && !busy;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={busy ? undefined : onClose} accessibilityLabel="Close" />
      <View style={styles.centre} pointerEvents="box-none">
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          <View style={styles.head}>
            <Text style={styles.title}>New Booklist</Text>
            <Pressable onPress={onClose} disabled={busy} hitSlop={8} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>School</Text>
            <TextInput
              value={school}
              onChangeText={setSchool}
              placeholder="Chrisland College"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              autoCapitalize="words"
            />

            <Text style={styles.label}>Class</Text>
            <TextInput
              value={classLevel}
              onChangeText={setClassLevel}
              placeholder="JSS2"
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              autoCapitalize="characters"
            />

            <Text style={styles.label}>Photo of the list (optional)</Text>
            {image ? (
              <View style={styles.preview}>
                <Image source={{ uri: image.uri }} style={styles.previewImage} resizeMode="cover" />
                <Pressable
                  onPress={() => setImage(null)}
                  style={styles.previewRemove}
                  accessibilityLabel="Remove photo"
                  hitSlop={6}
                >
                  <Ionicons name="close" size={15} color={colors.onNavy} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.pickRow}>
                <Pressable
                  onPress={() => handlePick('camera')}
                  style={({ pressed }) => [styles.pick, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Ionicons name="camera-outline" size={18} color={colors.navy} />
                  <Text style={styles.pickText}>Take photo</Text>
                </Pressable>
                <Pressable
                  onPress={() => handlePick('library')}
                  style={({ pressed }) => [styles.pick, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Ionicons name="image-outline" size={18} color={colors.navy} />
                  <Text style={styles.pickText}>Choose file</Text>
                </Pressable>
              </View>
            )}

            {notice && (
              <View style={styles.notice}>
                <Ionicons name="information-circle" size={15} color={colors.warning} />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            )}
            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={15} color={colors.danger} />
                <Text style={styles.errorText}>{error.message}</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                reset();
                onClose();
              }}
              disabled={busy}
              style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.btnGhostText}>{notice ? 'Done' : 'Cancel'}</Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                !canSubmit && styles.btnDisabled,
                pressed && canSubmit && styles.pressed,
              ]}
              accessibilityRole="button"
            >
              {busy ? (
                <View style={styles.busy}>
                  <ActivityIndicator size="small" color={colors.onNavy} />
                  <Text style={styles.btnPrimaryText}>{step ?? 'Working…'}</Text>
                </View>
              ) : (
                <Text style={styles.btnPrimaryText}>Create & request quotes</Text>
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
    maxWidth: 460,
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    ...shadow.raised,
  },
  cardMobile: { maxWidth: '100%' },

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

  pickRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  pick: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
  },
  pickText: { fontSize: font.md, fontWeight: '600', color: colors.navy },

  preview: { marginBottom: spacing.md },
  previewImage: {
    width: '100%',
    height: 160,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  previewRemove: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(15,30,61,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },

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
    marginBottom: spacing.md,
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
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.textMuted, fontWeight: '700', fontSize: font.md },
  btnPrimary: { backgroundColor: colors.orange },
  btnPrimaryText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  btnDisabled: { backgroundColor: colors.borderStrong },
  busy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pressed: { opacity: 0.85 },
});
