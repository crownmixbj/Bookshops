/**
 * Everything the three Paystack functions share.
 *
 * The secret key lives only here and only in Edge Function environment
 * variables. It must never reach the bundle: `EXPO_PUBLIC_*` variables
 * are inlined into the JavaScript Expo ships, so a secret named that way
 * is a secret published to every visitor.
 */

export const PAYSTACK_BASE = 'https://api.paystack.co';

export function secretKey(): string {
  const key = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!key) throw new Error('PAYSTACK_SECRET_KEY is not set on this function');
  return key;
}

/** Naira → kobo. Paystack charges in the minor unit and rejects decimals. */
export function toKobo(naira: number): number {
  return Math.round(Number(naira) * 100);
}

/** Kobo → naira, for comparing what was actually paid against what was owed. */
export function fromKobo(kobo: number): number {
  return Number(kobo) / 100;
}

export interface InitializeResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export async function initializeTransaction(body: Record<string, unknown>): Promise<InitializeResult> {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.status) {
    throw new Error(`Paystack initialize failed: ${json?.message ?? res.status}`);
  }
  return json.data as InitializeResult;
}

export interface VerifiedTransaction {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  id: number;
  gateway_response?: string;
  metadata?: Record<string, unknown>;
}

export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  const res = await fetch(
    `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secretKey()}` } },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.status) {
    throw new Error(`Paystack verify failed: ${json?.message ?? res.status}`);
  }
  return json.data as VerifiedTransaction;
}

/**
 * Paystack signs every webhook with HMAC-SHA512 of the raw body under
 * the secret key. Without this check the endpoint is an open door that
 * marks any order paid, so the raw text must be hashed — not a
 * re-serialised object, whose key order and whitespace will differ.
 */
export async function isValidSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey()),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return timingSafeEqual(expected, signature.toLowerCase());
}

/** Length-independent comparison, so a wrong signature leaks no timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Where Paystack is allowed to send the buyer afterwards.
 *
 * The client asks for its own callback because the right one differs per
 * platform — an https origin on web, a deep link on a phone — but an
 * unchecked callback is an open redirect wearing your domain, so the
 * origin has to be on a list you control.
 *
 *   PAYSTACK_ALLOWED_CALLBACKS=https://loci.ng,http://localhost:8081,loci://
 */
export function assertAllowedCallback(url: string): string {
  const allowed = (Deno.env.get('PAYSTACK_ALLOWED_CALLBACKS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) throw new Error('PAYSTACK_ALLOWED_CALLBACKS is not set on this function');
  if (!allowed.some((prefix) => url.startsWith(prefix))) {
    throw new Error(`Callback ${url} is not in PAYSTACK_ALLOWED_CALLBACKS`);
  }
  return url;
}
