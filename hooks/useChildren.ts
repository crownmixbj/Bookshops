import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { getSessionUserId, subscribeToAuthReloads } from '../lib/loadState';
import type { Child, EditableChild } from '../types/db';

/**
 * The buyer's household: one profile per child, with the school and
 * class the child's booklists are usually for.
 *
 * RLS (children_*_own) scopes every read and write to the parent, so
 * the eq('parent_id') filters below are for efficiency, not security.
 *
 * `migration` is 'missing' until bookshops_buyer_portal.sql has run.
 * Every screen that uses this hides or explains the feature in that
 * state rather than showing a broken form.
 */

/** undefined_table, undefined_function, and PostgREST's two "not in the schema cache". */
export const MISSING_CODES = new Set(['42P01', '42883', '42703', 'PGRST202', 'PGRST204', 'PGRST205']);

export type MigrationState = 'unknown' | 'ok' | 'missing';

export function useChildren() {
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migration, setMigration] = useState<MigrationState>('unknown');
  const alive = useRef(true);

  const load = useCallback(async () => {
    setError(null);
    const uid = await getSessionUserId();
    if (!alive.current) return;
    if (!uid) {
      setChildren([]);
      setLoading(false);
      return;
    }
    const { data, error: qError } = await supabase
      .from('children')
      .select('id, parent_id, full_name, school_name, class_level, created_at, updated_at')
      .eq('parent_id', uid)
      .order('created_at', { ascending: true });
    if (!alive.current) return;
    if (qError) {
      if (MISSING_CODES.has(qError.code ?? '')) setMigration('missing');
      else setError(qError.message);
      setChildren([]);
    } else {
      setMigration('ok');
      setChildren((data ?? []) as Child[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const unsubscribe = subscribeToAuthReloads(load);
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [load]);

  const add = useCallback(
    async (input: EditableChild): Promise<{ ok: true; child: Child } | { ok: false; message: string }> => {
      const problem = validateChild(input);
      if (problem) return { ok: false, message: problem };
      const { data, error: insertError } = await supabase
        .from('children')
        .insert(clean(input))
        .select('id, parent_id, full_name, school_name, class_level, created_at, updated_at')
        .single();
      if (insertError) return { ok: false, message: insertError.message };
      const child = data as Child;
      setChildren((prev) => [...prev, child]);
      return { ok: true, child };
    },
    []
  );

  const update = useCallback(
    async (id: string, input: EditableChild): Promise<{ ok: true } | { ok: false; message: string }> => {
      const problem = validateChild(input);
      if (problem) return { ok: false, message: problem };
      const { data, error: updateError } = await supabase
        .from('children')
        .update(clean(input))
        .eq('id', id)
        .select('id, parent_id, full_name, school_name, class_level, created_at, updated_at')
        .single();
      if (updateError) return { ok: false, message: updateError.message };
      setChildren((prev) => prev.map((c) => (c.id === id ? (data as Child) : c)));
      return { ok: true };
    },
    []
  );

  const remove = useCallback(async (id: string): Promise<{ ok: true } | { ok: false; message: string }> => {
    const { error: deleteError } = await supabase.from('children').delete().eq('id', id);
    if (deleteError) return { ok: false, message: deleteError.message };
    setChildren((prev) => prev.filter((c) => c.id !== id));
    return { ok: true };
  }, []);

  return { children, loading, error, migration, reload: load, add, update, remove };
}

export function validateChild(input: EditableChild): string | null {
  if (input.full_name.trim().length < 1) return 'Give the child a name (a first name is enough).';
  if (input.full_name.trim().length > 80) return 'Keep the name under 80 characters.';
  if ((input.school_name ?? '').length > 120) return 'Keep the school name under 120 characters.';
  if ((input.class_level ?? '').length > 40) return 'Keep the class under 40 characters.';
  return null;
}

function clean(input: EditableChild): EditableChild {
  return {
    full_name: input.full_name.trim(),
    school_name: input.school_name?.trim() || null,
    class_level: input.class_level?.trim() || null,
  };
}

/** "Tolu · JSS 2" — how a child is labelled on a booklist. */
export function childLabel(child: Pick<Child, 'full_name' | 'class_level'> | null | undefined): string {
  if (!child) return '';
  return [child.full_name, child.class_level].filter(Boolean).join(' · ');
}
