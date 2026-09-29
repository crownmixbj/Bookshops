import { supabase } from '../utils/supabase';
import type { DeliveryAddress, RequestDelivery } from '../types/db';

/**
 * The delivery address a booklist is sent with
 * (bookshops_booklist_delivery.sql).
 *
 * The buyer picks it in the booklist review / create screens:
 *   saved      one of their saved addresses (the default is preselected)
 *   different  a one-off address — books going to a grandparent, an
 *              office, a boarding house
 *
 * It is stored as a snapshot on the list, so a shop prices delivery to a
 * destination that cannot move under it. Shops see the area in their
 * queue, and the full address once the list is theirs to quote.
 */

export interface OtherAddress {
  address: string;
  city: string;
  notes: string;
}

export type DeliveryChoice =
  | { mode: 'saved'; address: DeliveryAddress }
  | { mode: 'different'; other: OtherAddress }
  /** No saved address and nothing typed yet. */
  | { mode: 'none' };

export const EMPTY_OTHER: OtherAddress = { address: '', city: '', notes: '' };

const COLUMNS =
  'request_id, address_id, is_alternate, recipient_name, phone, address, city, state, landmark, notes';

/** Postgres / PostgREST codes for "that table does not exist yet". */
const MISSING = new Set(['42P01', 'PGRST205', 'PGRST204', '42703']);

/**
 * What is wrong with the choice, for a list that is being SENT. Drafts
 * may be saved without an address. Null when it is fine.
 */
export function deliveryProblem(choice: DeliveryChoice): string | null {
  if (choice.mode === 'saved') return null;
  if (choice.mode === 'none') {
    return 'Add a delivery address so shops can include an accurate delivery cost in their quote.';
  }
  if (choice.other.address.trim().length < 5) {
    return 'Enter the street address the books should go to.';
  }
  if (choice.other.city.trim().length < 2) return 'Enter the area or city for delivery.';
  if (choice.other.notes.trim().length > 300) return 'Keep the delivery notes under 300 characters.';
  return null;
}

/** True when there is something to store. */
export function hasDelivery(choice: DeliveryChoice): boolean {
  if (choice.mode === 'saved') return true;
  if (choice.mode === 'none') return false;
  return choice.other.address.trim().length >= 5 && choice.other.city.trim().length >= 2;
}

type DeliveryRow = Omit<RequestDelivery, 'request_id'> & { request_id: string };

function toRow(requestId: string, choice: DeliveryChoice): DeliveryRow | null {
  if (choice.mode === 'saved') {
    const a = choice.address;
    return {
      request_id: requestId,
      address_id: a.id,
      is_alternate: false,
      recipient_name: a.recipient_name || null,
      phone: a.phone || null,
      address: a.address.trim(),
      city: a.city.trim(),
      state: a.state || null,
      landmark: a.landmark || null,
      notes: null,
    };
  }
  if (choice.mode === 'different') {
    return {
      request_id: requestId,
      address_id: null,
      is_alternate: true,
      recipient_name: null,
      phone: null,
      address: choice.other.address.trim(),
      city: choice.other.city.trim(),
      state: null,
      landmark: null,
      notes: choice.other.notes.trim() || null,
    };
  }
  return null;
}

/**
 * Stores the choice with the booklist. Upsert, because the database may
 * already have filled in the buyer's default address the moment the list
 * went out — the buyer's own choice replaces it.
 *
 * Throws on a real failure so the screen can say so; a database without
 * the migration is only warned about, so booklists still send.
 */
export async function saveRequestDelivery(requestId: string, choice: DeliveryChoice): Promise<void> {
  const row = toRow(requestId, choice);
  if (!row) return;
  const { error } = await supabase
    .from('book_request_delivery')
    .upsert(row, { onConflict: 'request_id' });
  if (!error) return;
  if (MISSING.has(error.code ?? '')) {
    console.warn('[delivery] bookshops_booklist_delivery.sql has not been run; address not saved.');
    return;
  }
  throw new Error(`The booklist was saved, but its delivery address was not: ${error.message}`);
}

/** The destination stored with a booklist, or null (none, or not visible to you). */
export async function loadRequestDelivery(requestId: string): Promise<RequestDelivery | null> {
  const { data, error } = await supabase
    .from('book_request_delivery')
    .select(COLUMNS)
    .eq('request_id', requestId)
    .maybeSingle();
  if (error) {
    if (!MISSING.has(error.code ?? '')) console.warn('[delivery] not loaded:', error.message);
    return null;
  }
  return (data as RequestDelivery | null) ?? null;
}

/** "14 Adeniyi Jones Ave, Ikeja, Lagos". */
export function deliveryLine(d: Pick<RequestDelivery, 'address' | 'city' | 'state'>): string {
  return [d.address, d.city, d.state].filter(Boolean).join(', ');
}
