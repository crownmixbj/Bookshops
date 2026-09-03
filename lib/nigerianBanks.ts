/**
 * Nigerian banks for the payout form.
 *
 * PROVENANCE, because a wrong code sends someone's money to the wrong
 * bank:
 *
 *  - Every `code` here was read from Paystack's own bank list
 *    (GET https://api.paystack.co/bank?country=nigeria). They are
 *    PAYSTACK codes, which are NOT the same scheme as the six-digit NIP
 *    codes you will find on blog posts and gists — Paystack calls GTBank
 *    '058', NIP calls it '000013'. Mixing the two misroutes transfers.
 *
 *  - Entries with `code: null` are banks that certainly exist and that
 *    people will look for, but whose Paystack code was not confirmed
 *    when this list was written. They are selectable and save fine —
 *    vendor_bank_accounts.bank_code is nullable — and the code gets
 *    filled in when the account is resolved against the bank. A guessed
 *    code would be worse than none.
 *
 * This list will go stale. The right long-term source is Paystack's
 * endpoint called SERVER-side (it is a secret-key API; it does not
 * belong in a client bundle), behind a Supabase Edge Function that
 * caches the result. When that exists, replace BANKS with its response
 * and nothing else here changes.
 */

export interface NigerianBank {
  name: string;
  /** Paystack's code. Null where it was not verified — never guessed. */
  code: string | null;
}

export const BANKS: NigerianBank[] = [
  // --- verified against Paystack -------------------------------------
  { name: 'Access Bank', code: '044' },
  { name: 'ALAT by WEMA', code: '035A' },
  { name: 'Carbon', code: '565' },
  { name: 'Citibank Nigeria', code: '023' },
  { name: 'Coronation Merchant Bank', code: '559' },
  { name: 'Ecobank Nigeria', code: '050' },
  { name: 'Fairmoney Microfinance Bank', code: '51318' },
  { name: 'Fidelity Bank', code: '070' },
  { name: 'First Bank of Nigeria', code: '011' },
  { name: 'First City Monument Bank', code: '214' },
  { name: 'Globus Bank', code: '00103' },
  { name: 'Guaranty Trust Bank', code: '058' },
  { name: 'Jaiz Bank', code: '301' },
  { name: 'Keystone Bank', code: '082' },
  { name: 'Kuda Bank', code: '50211' },
  { name: 'Lotus Bank', code: '303' },
  { name: 'Moniepoint MFB', code: '50515' },
  { name: 'OPay Digital Services Limited', code: '999992' },
  { name: 'Optimus Bank', code: '107' },
  { name: 'PalmPay', code: '999991' },
  { name: 'Parallex Bank', code: '104' },
  { name: 'Polaris Bank', code: '076' },
  { name: 'PremiumTrust Bank', code: '105' },
  { name: 'Providus Bank', code: '101' },
  { name: 'Rand Merchant Bank', code: '502' },
  { name: 'Rubies MFB', code: '125' },
  { name: 'Signature Bank', code: '106' },
  { name: 'Sparkle Microfinance Bank', code: '51310' },
  { name: 'Stanbic IBTC Bank', code: '221' },

  // --- name confirmed, code not verified -----------------------------
  { name: 'Zenith Bank', code: null },
  { name: 'United Bank for Africa', code: null },
  { name: 'Union Bank of Nigeria', code: null },
  { name: 'Sterling Bank', code: null },
  { name: 'Wema Bank', code: null },
  { name: 'Unity Bank', code: null },
  { name: 'Standard Chartered Bank Nigeria', code: null },
  { name: 'SunTrust Bank', code: null },
  { name: 'TAJ Bank', code: null },
  { name: 'VFD Microfinance Bank', code: null },
];

/**
 * Substring match on the name, plus an exact match on the code so
 * someone who knows they want '058' can type it.
 *
 * Sorted so a match at the START of the name wins: typing "un" should
 * offer Union and Unity before "First Bank of Nigeria".
 */
export function searchBanks(query: string): NigerianBank[] {
  const q = query.trim().toLowerCase();
  if (!q) return BANKS;

  return BANKS.filter((b) => b.name.toLowerCase().includes(q) || b.code?.toLowerCase() === q).sort(
    (a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.name.localeCompare(b.name);
    }
  );
}

/** The stored bank_code for a saved name, or null if we do not know it. */
export function codeForBank(name: string): string | null {
  const match = BANKS.find((b) => b.name.toLowerCase() === name.trim().toLowerCase());
  return match?.code ?? null;
}
