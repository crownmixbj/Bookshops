import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Image,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { BuyerPage, Panel } from '../../components/buyer/BuyerPage';
import { QuantityStepper } from '../../components/booklists/QuantityStepper';
import { supabase } from '../../utils/supabase';
import {
  DRAFT_STATUS,
  describeBooklistError,
  directTo,
  draftImageKey,
  guessCategory,
  pickBooklistImage,
  publishBookRequest,
  releaseImage,
  uploadBooklistImage,
  type ImageSource,
  type PickedImage,
} from '../../lib/booklistUpload';
import {
  AUTHOR_PLACEHOLDER,
  AUTHOR_REQUIRED_MESSAGE,
  authorRequiredFor,
  validateLines,
} from '../../lib/booklistValidation';
import { useLayout } from '../../hooks/useLayout';
import { colors, spacing, radius, font } from '../../theme';

/** One line the buyer is typing. Local only — nothing is saved per row. */
interface DraftLine {
  /** A client-side key. The database assigns the real id on insert. */
  key: string;
  title: string;
  /**
   * Author or publisher. Required for anything that could be a book —
   * "New General Mathematics" alone names a title four publishers print
   * in six editions, and a shop left to guess quotes the wrong one.
   */
  author: string;
  quantity: number;
}

function blankLine(): DraftLine {
  return { key: draftImageKey(), title: '', author: '', quantity: 1 };
}

/**
 * Type a booklist out by hand.
 *
 * The whole list is composed locally and written in two statements —
 * the request, then its lines — so a half-typed list costs nothing and
 * leaves nothing behind. If the lines fail to insert, the request row
 * created a moment earlier is deleted again rather than left as an
 * empty draft the buyer never asked for.
 *
 * Saved as a draft, never published: publishing puts the list in front
 * of every vendor, and that is a decision made from the booklist's own
 * page once the buyer has read back what they typed.
 */
export default function NewBooklistScreen() {
  const { isMobile } = useLayout();
  // Seeded from the chooser when the buyer named the list there, so the
  // school is asked for at most once across the whole flow. A route
  // param rather than in-memory state, so a refresh keeps it.
  const params = useLocalSearchParams<{
    school?: string | string[];
    vendor?: string | string[];
    shop?: string | string[];
  }>();
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) ?? '';
  const seededSchool = one(params.school);
  /**
   * Set when this screen was opened from a shop's page.
   *
   * A list raised here is addressed to that one shop: it publishes
   * straight to them and no other vendor can see it. Without a vendor
   * the screen behaves as before — a draft the buyer sends out later.
   */
  const targetVendorId = one(params.vendor);
  const targetShopName = one(params.shop);
  const isDirect = targetVendorId.length > 0;

  const [school, setSchool] = useState(seededSchool);
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [picking, setPicking] = useState(false);
  const [classLevel, setClassLevel] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Per-line errors appear only once they have tried to save. */
  const [showProblems, setShowProblems] = useState(false);

  /** Blank rows are scaffolding, not data. Only filled ones are saved. */
  const filled = lines.filter((l) => l.title.trim().length > 0);
  const verdict = validateLines(lines, (l) => l.key);
  const blocked = new Set(verdict.missingAuthor);
  /**
   * A photo is a list. With one attached the buyer need not type a
   * single line — the shop reads the picture and quotes off it, which is
   * what already happens over WhatsApp. Lines they DID type still have
   * to be complete, though: a half-filled row would reach the vendor
   * looking like a real one.
   */
  const linesUsable =
    verdict.missingAuthor.length === 0 && verdict.missingTitle.length === 0;
  const photoOnly = Boolean(photo) && filled.length === 0;

  /**
   * Four sentences for four situations, because "Save & Continue to
   * Quotes" is a lie when the list is going straight to one shop, and
   * "Send Photo" is a lie when they have typed twelve books.
   */
  const ctaLabel = isDirect
    ? photoOnly
      ? 'Send Photo to Shop'
      : `Send to ${targetShopName || 'this shop'}`
    : photoOnly
    ? 'Send Photo to Vendors'
    : 'Save & Continue to Quotes';
  const canSubmit =
    school.trim().length > 1 && linesUsable && (verdict.ok || photoOnly) && !saving && !picking;

  function clearError() {
    if (error) setError(null);
  }

  /**
   * Attach a photo of the paper list.
   *
   * pickBooklistImage is called synchronously inside the press handler,
   * with no await in front of it: on web a browser only opens a file
   * dialog while the click that asked for it is still the live user
   * gesture. There is no Modal on this screen, so none of the native
   * dismissal sequencing applies here.
   */
  function attachPhoto(source: ImageSource) {
    if (saving || picking) return;
    clearError();
    setPicking(true);
    pickBooklistImage(source)
      .then((picked) => {
        // Null is a cancel — leave the buyer exactly where they were.
        if (picked) setPhoto((previous) => (releaseImage(previous), picked));
      })
      .catch((e) => setError((e as Error)?.message ?? String(e)))
      .finally(() => setPicking(false));
  }

  function removePhoto() {
    setPhoto((previous) => (releaseImage(previous), null));
    clearError();
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    clearError();
  }

  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
    clearError();
  }

  function removeLine(key: string) {
    // Guarded here as well as on the button: the form should never end
    // up with nothing to type into.
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.key !== key)));
    clearError();
  }

  async function submit() {
    // Re-checked here as well as on the button: a line can be edited
    // back into an invalid state between a render and a press.
    if (!linesUsable || (!verdict.ok && !photoOnly)) {
      setShowProblems(true);
      setError(
        verdict.message ?? 'Type at least one book, or attach a photo of the list.'
      );
      return;
    }
    if (!canSubmit) return;
    setShowProblems(false);
    setSaving(true);
    setError(null);

    let requestId: string | null = null;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('You are signed out. Sign in and try again.');

      // NOTE: book_requests has no `title` column — the school name is
      // what identifies a booklist today, which is why it is required
      // and the class level is not. The owner column is `buyer_id`.
      const { data: created, error: insertError } = await supabase
        .from('book_requests')
        .insert({
          buyer_id: user.id,
          school_name: school.trim(),
          class_level: classLevel.trim(),
          status: DRAFT_STATUS,
        })
        .select('id')
        .single();
      if (insertError) throw insertError;

      requestId = created.id as string;

      // `parsed: false` is the point of this screen — these lines came
      // from a person, so no vendor needs to read them with the
      // suspicion an OCR row earns. `position` preserves typing order,
      // which is the order the school printed them in.
      // Photo-only lists have nothing to insert, and an empty insert is
      // a 400 in PostgREST rather than a no-op.
      if (filled.length) {
        const { error: itemsError } = await supabase.from('book_request_items').insert(
          filled.map((line, i) => ({
            request_id: requestId,
            title: line.title.trim(),
            // A required field for books, so it is written as a value.
            // Stationery and uniform lines legitimately have none.
            author: line.author.trim(),
            category: guessCategory(line.title),
            quantity: line.quantity,
            parsed: false,
            position: i,
          }))
        );
        if (itemsError) throw itemsError;
      }

      // Before the publish below, not after: publishBookRequest accepts
      // a list with no typed books ONLY when image_path is already set,
      // so uploading afterwards would have the photo-only case refused
      // by its own evidence.
      if (photo) {
        const path = await uploadBooklistImage(user.id, requestId, photo);
        const { error: photoError } = await supabase
          .from('book_requests')
          .update({ image_path: path })
          .eq('id', requestId);
        if (photoError) throw photoError;
      }

      // Opened from a shop's page: send it to that shop and no other.
      // Left as a draft otherwise, which is what this screen has always
      // done — the buyer chooses where it goes from My Booklists.
      if (isDirect) {
        await publishBookRequest(requestId, directTo(targetVendorId));
      }

      releaseImage(photo);
      router.replace(`/booklists/${requestId}`);
    } catch (e) {
      // The request exists but its lines do not. An empty draft is worse
      // than no draft — it shows up in My Booklists as a list the buyer
      // has to work out how to finish — so take it back out. Best
      // effort: if the delete also fails there is nothing more to do
      // here, and the message below is still the one that matters.
      if (requestId) {
        await supabase.from('book_requests').delete().eq('id', requestId);
      }
      setError(describeBooklistError(e));
      setSaving(false);
    }
  }

  return (
    <BuyerPage
      eyebrow={isDirect ? 'Booklist for one shop' : 'Booklist'}
      title="Create a new booklist"
      subtitle={
        isDirect
          ? `Snap the paper list or type it out. It goes straight to ${
              targetShopName || 'this shop'
            } and lands at the top of their queue.`
          : 'Snap the paper list or type it out, then send it. Nearby shops quote on what you send.'
      }
    >
      <Panel title="Photo of the list">
        <Text style={styles.panelHint}>
          Fastest way in: photograph the sheet the school sent home. A shop can read and quote
          straight from the picture, so you do not have to type anything below.
        </Text>

        {photo ? (
          <View style={styles.photoWrap}>
            <Image
              key={photo.uri}
              source={{ uri: photo.uri }}
              style={styles.photo}
              resizeMode="contain"
              accessibilityLabel="The booklist photo you attached"
            />
            <Pressable
              onPress={removePhoto}
              disabled={saving}
              hitSlop={6}
              style={({ pressed }) => [styles.photoRemove, pressed && styles.pressedSoft]}
              accessibilityRole="button"
              accessibilityLabel="Remove this photo"
            >
              <Ionicons name="close" size={15} color={colors.onNavy} />
            </Pressable>
          </View>
        ) : (
          <View style={[styles.pickRow, isMobile && styles.pickRowStacked]}>
            <Pressable
              onPress={() => attachPhoto('camera')}
              disabled={saving || picking}
              style={({ pressed }) => [
                styles.pick,
                pressed && styles.pickPressed,
                (saving || picking) && styles.addOff,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Take a photo of the booklist"
            >
              <Ionicons name="camera-outline" size={18} color={colors.navy} />
              <Text style={styles.pickText}>Take a photo</Text>
            </Pressable>
            <Pressable
              onPress={() => attachPhoto('library')}
              disabled={saving || picking}
              style={({ pressed }) => [
                styles.pick,
                pressed && styles.pickPressed,
                (saving || picking) && styles.addOff,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Choose a booklist photo from your gallery"
            >
              <Ionicons name="images-outline" size={18} color={colors.navy} />
              <Text style={styles.pickText}>Choose from gallery</Text>
            </Pressable>
          </View>
        )}
      </Panel>

      <Panel title="School details">
        <Field
          label="School"
          placeholder="e.g. Ise Oluwa School"
          value={school}
          onChangeText={(v) => {
            setSchool(v);
            clearError();
          }}
          editable={!saving}
          hint="Required. This is how the booklist is listed for you and for the shops."
        />
        <Field
          label="Class"
          placeholder="e.g. JSS 2"
          value={classLevel}
          onChangeText={setClassLevel}
          editable={!saving}
          hint="Optional, but it helps shops quote the right editions."
          last
        />
      </Panel>

      <Panel
        title="Books on this list"
        right={
          <Text style={styles.count}>
            {filled.length} item{filled.length === 1 ? '' : 's'}
          </Text>
        }
      >
        <Text style={styles.panelHint}>
          {photo
            ? 'Optional now that a photo is attached — add any line you want priced exactly, and leave the rest to the picture.'
            : 'One line per book, exercise book or uniform item. Give the author or publisher for each book — it is what tells a shop which edition to quote.'}
        </Text>

        <View style={styles.lines}>
          {lines.map((line, i) => (
            <LineRow
              key={line.key}
              index={i}
              line={line}
              isMobile={isMobile}
              disabled={saving}
              canRemove={lines.length > 1}
              authorMissing={showProblems && blocked.has(line.key)}
              onChange={(patch) => updateLine(line.key, patch)}
              onRemove={() => removeLine(line.key)}
            />
          ))}
        </View>

        <Pressable
          onPress={addLine}
          disabled={saving}
          style={({ pressed }) => [styles.add, pressed && styles.addPressed, saving && styles.addOff]}
          accessibilityRole="button"
          accessibilityLabel="Add another item"
        >
          <Ionicons name="add" size={16} color={colors.navy} />
          <Text style={styles.addText}>Add Another Item</Text>
        </Pressable>
      </Panel>

      <Panel>
        {!!error && (
          <View style={styles.error}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.cta,
            !canSubmit && styles.ctaOff,
            canSubmit && pressed && styles.ctaPressed,
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
        >
          {saving ? (
            <>
              <ActivityIndicator size="small" color={colors.onNavy} />
              <Text style={styles.ctaText}>{isDirect ? 'Sending…' : 'Saving…'}</Text>
            </>
          ) : (
            <>
              <Ionicons
                name={isDirect ? 'paper-plane-outline' : 'arrow-forward'}
                size={16}
                color={canSubmit ? colors.onNavy : colors.textFaint}
              />
              <Text style={[styles.ctaText, !canSubmit && styles.ctaTextOff]}>
                {ctaLabel}
              </Text>
            </>
          )}
        </Pressable>

        <Text style={styles.ctaHint}>
          {isDirect
            ? `Sent straight to ${targetShopName || 'this shop'} — addressed to them and first in their queue.`
            : 'Saved as a draft first. Nothing reaches a shop until you send it for quotes from the booklist itself.'}
        </Text>
      </Panel>

      <View style={styles.note}>
        <Ionicons name="sparkles-outline" size={16} color={colors.textMuted} />
        <Text style={styles.noteText}>
          A photo attached here is sent as-is for a shop to read. To have the titles read out
          automatically first, start from Create New Booklist on your hub.
        </Text>
      </View>
    </BuyerPage>
  );
}

/* ------------------------------------------------------------------ */

function LineRow({
  index,
  line,
  isMobile,
  disabled,
  canRemove,
  authorMissing,
  onChange,
  onRemove,
}: {
  index: number;
  line: DraftLine;
  isMobile: boolean;
  disabled: boolean;
  canRemove: boolean;
  authorMissing: boolean;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const label = line.title.trim() || `item ${index + 1}`;
  const needsAuthor = authorRequiredFor(line);

  const controls = (
    <View style={styles.controls}>
      <QuantityStepper
        value={line.quantity}
        onChange={(quantity) => onChange({ quantity })}
        label={label}
        disabled={disabled}
      />
      <Pressable
        onPress={onRemove}
        // The last row has nowhere to go: removing it would leave the
        // form with no line to type into.
        disabled={disabled || !canRemove}
        hitSlop={8}
        style={({ pressed }) => [
          styles.remove,
          (disabled || !canRemove) && styles.removeOff,
          pressed && canRemove && styles.removePressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${label}`}
        accessibilityState={{ disabled: disabled || !canRemove }}
      >
        <Ionicons
          name="trash-outline"
          size={17}
          color={canRemove && !disabled ? colors.danger : colors.textFaint}
        />
      </Pressable>
    </View>
  );

  return (
    <View style={[styles.line, isMobile && styles.lineStacked]}>
      <View style={styles.lineMain}>
        <View style={styles.lineNumber}>
          <Text style={styles.lineNumberText}>{index + 1}</Text>
        </View>

        <View style={styles.lineFields}>
          <TextInput
            value={line.title}
            onChangeText={(title) => onChange({ title })}
            placeholder="e.g. New General Mathematics JSS 2"
            placeholderTextColor={colors.textFaint}
            editable={!disabled}
            style={styles.lineInput}
            accessibilityLabel={`Item ${index + 1} title`}
            accessibilityHint="The book, exercise book or uniform item as the school wrote it"
            returnKeyType="done"
          />
          <TextInput
            value={line.author}
            onChangeText={(author) => onChange({ author })}
            placeholder={AUTHOR_PLACEHOLDER}
            placeholderTextColor={authorMissing ? colors.danger : colors.textFaint}
            editable={!disabled}
            style={[styles.lineInput, styles.lineAuthor, authorMissing && styles.lineInputInvalid]}
            accessibilityLabel={
              needsAuthor
                ? `Item ${index + 1} author or publisher, required`
                : `Item ${index + 1} author or publisher`
            }
            accessibilityHint={
              needsAuthor ? 'Shops need this to quote the right edition' : undefined
            }
            returnKeyType="done"
          />
          {authorMissing && <Text style={styles.lineError}>{AUTHOR_REQUIRED_MESSAGE}</Text>}
        </View>
      </View>

      {controls}
    </View>
  );
}

function Field({
  label,
  hint,
  last,
  ...input
}: { label: string; hint?: string; last?: boolean } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={[styles.field, last && styles.fieldLast]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.textFaint}
        accessibilityLabel={label}
        accessibilityHint={hint}
        {...input}
      />
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: spacing.lg },
  fieldLast: { marginBottom: 0 },
  label: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceMuted, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 11,
    fontSize: font.md, color: colors.text,
  },
  hint: { fontSize: font.xs, color: colors.textMuted, marginTop: 5 },

  count: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  panelHint: { fontSize: font.sm, color: colors.textMuted, lineHeight: 18, marginBottom: spacing.md },

  pickRow: { flexDirection: 'row', gap: spacing.md },
  pickRowStacked: { flexDirection: 'column' },
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
    minHeight: 56,
  },
  pickPressed: { backgroundColor: colors.surfaceMuted },
  pickText: { fontSize: font.md, fontWeight: '700', color: colors.navy },
  pressedSoft: { opacity: 0.7 },

  photoWrap: { position: 'relative' },
  photo: {
    width: '100%',
    height: 200,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoRemove: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(15,30,61,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  lines: { gap: spacing.sm },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.sm,
  },
  // On a phone the title takes the full width and the controls drop
  // beneath it: a stepper and a title box side by side leaves about
  // fifteen characters of room for a book called "Science Teacher
  // Association of Nigeria Science Project Book 1".
  lineStacked: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.sm },
  lineMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  lineFields: { flex: 1, minWidth: 0, gap: 6 },
  lineAuthor: { fontSize: font.sm },
  lineInputInvalid: { borderColor: colors.danger, backgroundColor: '#FDECEA' },
  lineError: { fontSize: font.xs, color: colors.danger, lineHeight: 15 },
  lineNumber: {
    width: 24, height: 24, borderRadius: 12, marginTop: 8,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  lineNumberText: { fontSize: font.xs, fontWeight: '800', color: colors.textMuted },
  lineInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    fontSize: font.md,
    color: colors.text,
  },
  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'flex-end' },
  remove: {
    width: 34, height: 34, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  removeOff: { opacity: 0.45 },
  removePressed: { backgroundColor: '#FDECEA', borderColor: '#F0C4BF' },

  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginTop: spacing.md,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong,
    borderRadius: radius.md, paddingVertical: 12,
  },
  addPressed: { backgroundColor: colors.surfaceMuted },
  addOff: { opacity: 0.5 },
  addText: { fontSize: font.md, fontWeight: '700', color: colors.navy },

  error: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: '#FDECEA', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.text },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.orange, borderRadius: radius.md, paddingVertical: 13,
  },
  ctaPressed: { backgroundColor: colors.orangeDark },
  ctaOff: { backgroundColor: '#E3E9F2' },
  ctaText: { fontSize: font.md, fontWeight: '800', color: colors.onNavy },
  ctaTextOff: { color: '#6B7A94' },
  ctaHint: { fontSize: font.xs, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 16, textAlign: 'center' },

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.xs },
  noteText: { flex: 1, fontSize: font.sm, color: colors.textMuted, lineHeight: 18 },
});
