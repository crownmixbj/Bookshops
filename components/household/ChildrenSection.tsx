import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Section, Field, Note } from '../settings/SettingsControls';
import { ConfirmDialog } from '../booklists/ConfirmDialog';
import { useChildren } from '../../hooks/useChildren';
import { colors, spacing, radius, font } from '../../theme';
import type { Child, EditableChild } from '../../types/db';

/**
 * Settings → My Children.
 *
 * Each child carries the school and class their lists are usually for,
 * so picking the child when creating a booklist fills both in. Deleting
 * a child keeps their booklists and orders — they simply stop being
 * labelled with a name (the column is ON DELETE SET NULL).
 */

const BLANK: EditableChild = { full_name: '', school_name: '', class_level: '' };

export function ChildrenSection({ highlight }: { highlight?: boolean }) {
  const { children, loading, error, migration, add, update, remove } = useChildren();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<EditableChild>(BLANK);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Child | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  function startNew() {
    setForm(BLANK);
    setFormError(null);
    setEditing('new');
  }
  function startEdit(child: Child) {
    setForm({ full_name: child.full_name, school_name: child.school_name ?? '', class_level: child.class_level ?? '' });
    setFormError(null);
    setEditing(child.id);
  }

  async function save() {
    setSaving(true);
    setFormError(null);
    const result = editing === 'new' ? await add(form) : await update(editing as string, form);
    setSaving(false);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setEditing(null);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    const result = await remove(deleting.id);
    setDeleteBusy(false);
    if (!result.ok) setFormError(result.message);
    setDeleting(null);
  }

  const formView = (
    <View style={styles.form}>
      <Field
        label="Child's name"
        value={form.full_name}
        onChangeText={(v) => setForm((f) => ({ ...f, full_name: v }))}
        placeholder="Tolu"
        autoCapitalize="words"
        hint="A first name is enough. Shops never see it."
      />
      <Field
        label="School"
        value={form.school_name ?? ''}
        onChangeText={(v) => setForm((f) => ({ ...f, school_name: v }))}
        placeholder="Chrisland School, Ikeja"
      />
      <Field
        label="Class / grade"
        value={form.class_level ?? ''}
        onChangeText={(v) => setForm((f) => ({ ...f, class_level: v }))}
        placeholder="JSS 2"
        error={formError ?? undefined}
      />
      <View style={styles.formActions}>
        <Pressable
          onPress={() => setEditing(null)}
          disabled={saving}
          style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.btnGhostText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={save}
          disabled={saving}
          style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.onNavy} />
          ) : (
            <Text style={styles.btnPrimaryText}>{editing === 'new' ? 'Add child' : 'Save'}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );

  return (
    <Section
      title="My Children"
      caption="Label each booklist with the child and class it is for"
      icon="people-outline"
      highlight={highlight}
    >
      {migration === 'missing' ? (
        <Note tone="warning">
          Child profiles need bookshops_buyer_portal.sql to be run on this project.
        </Note>
      ) : loading ? (
        <ActivityIndicator color={colors.navy} />
      ) : (
        <>
          {!!error && <Note tone="warning">{error}</Note>}
          {children.length === 0 && editing !== 'new' && (
            <Text style={styles.empty}>
              No children added yet. Add one per child so a household with several classes can tell
              its booklists apart at a glance.
            </Text>
          )}

          {children.map((child) =>
            editing === child.id ? (
              <View key={child.id}>{formView}</View>
            ) : (
              <View key={child.id} style={styles.row}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{child.full_name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {child.full_name}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {[child.class_level, child.school_name].filter(Boolean).join(' · ') || 'No school or class yet'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => startEdit(child)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${child.full_name}`}
                >
                  <Ionicons name="create-outline" size={18} color={colors.navy} />
                </Pressable>
                <Pressable
                  onPress={() => setDeleting(child)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${child.full_name}`}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.textFaint} />
                </Pressable>
              </View>
            )
          )}

          {editing === 'new' ? (
            formView
          ) : (
            editing === null && (
              <Pressable
                onPress={startNew}
                style={({ pressed }) => [styles.add, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Ionicons name="add-circle-outline" size={18} color={colors.navy} />
                <Text style={styles.addText}>Add a child</Text>
              </Pressable>
            )
          )}
        </>
      )}

      <ConfirmDialog
        visible={!!deleting}
        title={`Remove ${deleting?.full_name ?? 'this child'}?`}
        message="Their booklists and orders stay exactly as they are — they just stop being labelled with this name."
        confirmLabel="Remove"
        destructive
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: font.sm, color: colors.textMuted, lineHeight: 19 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FDF1E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: font.md, fontWeight: '800', color: colors.orangeDark },
  name: { fontSize: font.md, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.sm, color: colors.textFaint, marginTop: 1 },
  form: {
    gap: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  btn: {
    minHeight: 40,
    minWidth: 96,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  btnGhostText: { fontSize: font.sm, fontWeight: '700', color: colors.textMuted },
  btnPrimary: { backgroundColor: colors.navy },
  btnPrimaryText: { fontSize: font.sm, fontWeight: '700', color: colors.onNavy },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
  },
  addText: { fontSize: font.md, fontWeight: '700', color: colors.navy },
  pressed: { opacity: 0.8 },
});
