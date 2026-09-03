import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { BuyerPage, Panel } from '../../components/buyer/BuyerPage';
import { supabase } from '../../utils/supabase';
import { DRAFT_STATUS, describeBooklistError } from '../../lib/booklistUpload';
import { colors, spacing, radius, font } from '../../theme';

/**
 * Start a booklist.
 *
 * The same insert the hub's inline box performs, on its own route so
 * "Create New Booklist" is linkable and survives a refresh. On success
 * it opens the new booklist rather than dropping you back on the hub —
 * the next thing you want is to add its lines.
 *
 * The photo route is deliberately not a button yet: the `booklists`
 * storage bucket exists but carries no policies, so an upload is
 * refused for every signed-in user. A camera button that always fails
 * is worse than one that is honest about not being connected.
 */
export default function NewBooklistScreen() {
  const [school, setSchool] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = school.trim().length > 1 && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You are signed out. Sign in and try again.');

      // NOTE: book_requests has no `title` column — the school name is
      // what identifies a booklist today, which is why it is required
      // and the class level is not.
      const { data, error: insertError } = await supabase
        .from('book_requests')
        .insert({
          buyer_id: user.id,
          school_name: school.trim(),
          class_level: classLevel.trim(),
          // A draft: this route creates the list before any lines exist,
          // and publishing it empty would put an unpriceable row in
          // every vendor's queue. Publish from the hub once it has books.
          status: DRAFT_STATUS,
        })
        .select('id')
        .single();

      if (insertError) throw insertError;
      router.replace(`/booklists/${data.id}`);
    } catch (e) {
      setError(describeBooklistError(e));
      setSaving(false);
    }
  }

  return (
    <BuyerPage
      eyebrow="Booklist"
      title="Create a new booklist"
      subtitle="Name the school and class, then add the items. Nearby shops quote on what you send."
    >
      <Panel>
        <Field
          label="School"
          placeholder="e.g. Ise Oluwa School"
          value={school}
          onChangeText={(v) => {
            setSchool(v);
            if (error) setError(null);
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
        />

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
              <Text style={styles.ctaText}>Creating…</Text>
            </>
          ) : (
            <>
              <Ionicons name="add" size={16} color={canSubmit ? colors.onNavy : colors.textFaint} />
              <Text style={[styles.ctaText, !canSubmit && styles.ctaTextOff]}>Create booklist</Text>
            </>
          )}
        </Pressable>
      </Panel>

      <View style={styles.note}>
        <Ionicons name="camera-outline" size={16} color={colors.textMuted} />
        <Text style={styles.noteText}>
          Photographing a printed booklist is not connected yet — the storage bucket has no upload
          policy, so every upload would be refused. Type the items in for now.
        </Text>
      </View>
    </BuyerPage>
  );
}

function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
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
  label: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceMuted, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 11,
    fontSize: font.md, color: colors.text,
  },
  hint: { fontSize: font.xs, color: colors.textMuted, marginTop: 5 },

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

  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.xs },
  noteText: { flex: 1, fontSize: font.sm, color: colors.textMuted, lineHeight: 18 },
});
