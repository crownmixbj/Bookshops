import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { getSessionUserId, subscribeToAuthReloads } from '../lib/loadState';
import { MISSING_CODES, type MigrationState } from './useChildren';
import type { DeliveryAddress, EditableAddress } from '../types/db';

/**
 * Saved delivery addresses.
 *
 * The database owns the "exactly one default" rule
 * (delivery_address_default_before) and mirrors the default onto
 * profiles.default_delivery_* (delivery_address_sync_profile), so this
 * hook never has to clear an old default by hand, and anything that
 * still prefills from the profile keeps the right answer.
 */

const COLUMNS =
  'id, profile_id, label, recipient_name, phone, address, city, state, lga, landmark, is_default, created_at, updated_at';

export function useAddressBook() {
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migration, setMigration] = useState<MigrationState>('unknown');
  const alive = useRef(true);

  const load = useCallback(async () => {
    setError(null);
    const uid = await getSessionUserId();
    if (!alive.current) return;
    if (!uid) {
      setAddresses([]);
      setLoading(false);
      return;
    }
    const { data, error: qError } = await supabase
      .from('delivery_addresses')
      .select(COLUMNS)
      .eq('profile_id', uid)
      // Default first, then most recently used.
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false });
    if (!alive.current) return;
    if (qError) {
      if (MISSING_CODES.has(qError.code ?? '')) setMigration('missing');
      else setError(qError.message);
      setAddresses([]);
    } else {
      setMigration('ok');
      setAddresses((data ?? []) as DeliveryAddress[]);
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

  type Result = { ok: true; address: DeliveryAddress } | { ok: false; message: string };

  const save = useCallback(
    async (input: EditableAddress, id?: string): Promise<Result> => {
      const problem = validateAddress(input);
      if (problem) return { ok: false, message: problem };
      const row = cleanAddress(input);
      const query = id
        ? supabase.from('delivery_addresses').update(row).eq('id', id)
        : supabase.from('delivery_addresses').insert(row);
      const { data, error: writeError } = await query.select(COLUMNS).single();
      if (writeError) return { ok: false, message: writeError.message };
      // A new default demotes the old one server-side; re-read rather
      // than guess which row changed.
      await load();
      return { ok: true, address: data as DeliveryAddress };
    },
    [load]
  );

  const makeDefault = useCallback(
    async (id: string) => {
      const { error: writeError } = await supabase
        .from('delivery_addresses')
        .update({ is_default: true })
        .eq('id', id);
      if (writeError) return { ok: false as const, message: writeError.message };
      await load();
      return { ok: true as const };
    },
    [load]
  );

  const remove = useCallback(
    async (id: string) => {
      const { error: deleteError } = await supabase.from('delivery_addresses').delete().eq('id', id);
      if (deleteError) return { ok: false as const, message: deleteError.message };
      // Deleting the default promotes another one in the database.
      await load();
      return { ok: true as const };
    },
    [load]
  );

  return { addresses, loading, error, migration, reload: load, save, makeDefault, remove };
}

/**
 * The same rules checkout applies, so an address that saves here is one
 * checkout will accept without a second round of corrections.
 */
export function validateAddress(a: EditableAddress): string | null {
  if (a.label.trim().length < 1) return 'Give the address a label, e.g. Home or Office.';
  if (a.recipient_name.trim().length < 2) return 'Who receives deliveries here?';
  if (!isNigerianPhone(a.phone)) return 'Enter an 11-digit Nigerian number, e.g. 0803 123 4567.';
  if (a.address.trim().length < 8) return 'A street and house number — enough for a courier to find it.';
  if (a.city.trim().length < 2) return 'Which city or town?';
  return null;
}

export function isNigerianPhone(phone: string): boolean {
  const digits = phone.replace(/[^\d]/g, '');
  return (
    (digits.length === 11 && digits.startsWith('0')) ||
    (digits.length === 13 && digits.startsWith('234')) ||
    (digits.length === 10 && !digits.startsWith('0'))
  );
}

function cleanAddress(a: EditableAddress): EditableAddress {
  return {
    label: a.label.trim(),
    recipient_name: a.recipient_name.trim(),
    phone: a.phone.trim(),
    address: a.address.trim(),
    city: a.city.trim(),
    state: a.state?.trim() || null,
    lga: a.lga?.trim() || null,
    landmark: a.landmark?.trim() || null,
    is_default: a.is_default,
  };
}

/** One line for a picker: "14 Adeniyi Jones Ave, Ikeja, Lagos". */
export function addressLine(a: Pick<DeliveryAddress, 'address' | 'city' | 'state'>): string {
  return [a.address, a.city, a.state].filter(Boolean).join(', ');
}
