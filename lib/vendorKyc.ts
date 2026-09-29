import { supabase } from '../utils/supabase';
import { draftImageKey } from './booklistUpload';
import { isPdf, type PickedFile, type StoredFile } from './quoteFiles';

/**
 * Payout bank details and owner identity for a shop — the shared write
 * paths, so the Settings screen and the Payouts page cannot drift apart
 * on how either is saved.
 *
 * Where it lives, and why not on `vendors`:
 *   vendor_bank_accounts  (bookshops_payouts.sql)   the shop + admins only
 *   vendor_identity       (bookshops_vendor_identity.sql)  the shop + admins only
 *   vendor-kyc bucket     private; the shop's own folder + admins
 * `vendors` is readable by every visitor (it is the shop directory), so a
 * NUBAN or NIN put there would be public.
 *
 * What the database enforces regardless of this file: a shop cannot mark
 * its own bank account confirmed or its own identity verified, any edit
 * sends the record back for review, and document paths must sit in the
 * shop's own folder. The checks here exist to give a clear message
 * before the round trip.
 */

export type IdType = 'nin' | 'intl_passport' | 'drivers_licence' | 'voters_card';
export type IdentityStatus = 'submitted' | 'verified' | 'rejected';

export const ID_TYPES: { value: IdType; label: string; placeholder: string; hint: string }[] = [
  {
    value: 'nin',
    label: 'NIN',
    placeholder: '11 digits',
    hint: 'Your 11-digit National Identification Number, from your NIN slip or the NIMC app.',
  },
  {
    value: 'intl_passport',
    label: 'Passport',
    placeholder: 'e.g. A12345678',
    hint: 'The passport number printed on the data page.',
  },
  {
    value: 'drivers_licence',
    label: "Driver's licence",
    placeholder: 'e.g. ABC12345AA12',
    hint: 'The licence number on the front of the card.',
  },
  {
    value: 'voters_card',
    label: "Voter's card",
    placeholder: 'VIN on your PVC',
    hint: 'The Voter Identification Number (VIN) on your permanent voter’s card.',
  },
];

export const KYC_BUCKET = 'vendor-kyc';
export const MAX_KYC_DOCS = 3;

export interface VendorBankAccount {
  vendor_id: string;
  account_name: string;
  bank_name: string;
  bank_code: string | null;
  account_number: string;
  verified_at: string | null;
}

export interface VendorIdentity {
  vendor_id: string;
  id_type: IdType;
  id_number: string;
  legal_name: string;
  documents: StoredFile[];
  status: IdentityStatus;
  submitted_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

type Result = { ok: true } | { ok: false; message: string };

/** Keeps digits (and, for non-NIN IDs, letters and hyphens), upper-cased. */
export function normaliseIdNumber(type: IdType, raw: string): string {
  const s = raw.toUpperCase().replace(/\s/g, '');
  return type === 'nin' ? s.replace(/[^0-9]/g, '') : s.replace(/[^A-Z0-9-]/g, '');
}

/** The same rule as the vendor_identity_number_format CHECK. */
export function idNumberError(type: IdType, value: string): string | null {
  if (!value) return 'Enter the number.';
  if (type === 'nin') return /^[0-9]{11}$/.test(value) ? null : 'A NIN is exactly 11 digits.';
  return /^[A-Z0-9-]{5,20}$/.test(value) ? null : 'Use 5–20 letters or numbers, as printed on the ID.';
}

/** `•••••••8901` — the saved number is never shown in full again. */
export function maskIdNumber(value: string): string {
  return value.length <= 4 ? value : `${'•'.repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`;
}

/**
 * Asks for the account password again before a money or identity change.
 * A session left open on a shared shop computer should not be enough to
 * redirect a shop's payouts.
 */
export async function confirmPassword(password: string): Promise<Result> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { ok: false, message: 'You are not signed in.' };
  if (!password) return { ok: false, message: 'Enter your password to confirm this change.' };
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
  return error ? { ok: false, message: 'That password is not correct.' } : { ok: true };
}

export async function loadBankAccount(vendorId: string): Promise<VendorBankAccount | null> {
  const { data, error } = await supabase
    .from('vendor_bank_accounts')
    .select('vendor_id, account_name, bank_name, bank_code, account_number, verified_at')
    .eq('vendor_id', vendorId)
    .maybeSingle();
  if (error) throw error;
  return (data as VendorBankAccount) ?? null;
}

/** Validates, re-authenticates, then saves. Used by Settings and Payouts. */
export async function saveVendorBankAccount(
  vendorId: string,
  input: { account_name: string; bank_name: string; account_number: string; bank_code?: string | null },
  password: string
): Promise<Result> {
  const accountName = input.account_name.trim();
  const bankName = input.bank_name.trim();
  const number = input.account_number.replace(/\s/g, '');
  if (accountName.length < 2) return { ok: false, message: 'Enter the account holder’s name.' };
  if (bankName.length < 2) return { ok: false, message: 'Choose your bank.' };
  if (!/^[0-9]{10}$/.test(number)) return { ok: false, message: 'A Nigerian account number (NUBAN) is exactly 10 digits.' };

  const auth = await confirmPassword(password);
  if (!auth.ok) return auth;

  const { error } = await supabase.from('vendor_bank_accounts').upsert(
    {
      vendor_id: vendorId,
      account_name: accountName,
      bank_name: bankName,
      bank_code: input.bank_code?.trim() || null,
      account_number: number,
      // The database clears this on every shop edit anyway; sent so the
      // intent is readable here too.
      verified_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'vendor_id' }
  );
  return error ? { ok: false, message: error.message } : { ok: true };
}

/** Null when nothing has been submitted. Throws with .code when the table is missing. */
export async function loadIdentity(vendorId: string): Promise<VendorIdentity | null> {
  const { data, error } = await supabase
    .from('vendor_identity')
    .select('vendor_id, id_type, id_number, legal_name, documents, status, submitted_at, reviewed_at, review_note')
    .eq('vendor_id', vendorId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Record<string, any>;
  return {
    ...(row as VendorIdentity),
    documents: Array.isArray(row.documents) ? (row.documents as StoredFile[]) : [],
  };
}

/** Uploads one prepared file to <vendorId>/<key>.<ext> in the private bucket. */
export async function uploadKycDocument(vendorId: string, file: PickedFile): Promise<StoredFile> {
  const ext = isPdf(file.mimeType) ? 'pdf' : (file.fileName.split('.').pop() ?? 'jpg').toLowerCase();
  const path = `${vendorId}/${draftImageKey()}.${ext}`;
  const blob = await (await fetch(file.uri)).blob();
  const { error } = await supabase.storage
    .from(KYC_BUCKET)
    .upload(path, blob, { contentType: file.mimeType, upsert: false });
  if (error) {
    if (/exceeded|too large|413|maximum allowed size/i.test(error.message)) {
      throw new Error(`${file.fileName} is over the 5 MB limit.`);
    }
    throw error;
  }
  return { path, name: file.fileName.slice(0, 200), type: file.mimeType, size: blob.size };
}

/** Best effort: a replaced scan left in the private bucket is clutter, not a leak. */
export async function removeKycDocuments(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await supabase.storage.from(KYC_BUCKET).remove(paths);
  if (error) console.warn('[kyc] old documents not removed:', error.message);
}

/** A short-lived link to view a document. The bucket is private. */
export async function signKycDocument(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(KYC_BUCKET).createSignedUrl(path, 300);
  return error ? null : data?.signedUrl ?? null;
}
