/**
 * Support contact details — one place to change them.
 *
 * These are placeholders. Replace with LOCI's real support line and
 * inbox before launch; the header, the support menu and the drawer all
 * read from here, so nothing else needs editing.
 */
export const SUPPORT = {
  /** E.164 for the dial link. Keep the +234 form so it works abroad. */
  phone: '+2348000005624',
  /** What the user actually reads. */
  phoneDisplay: '0800 000 LOCI',
  email: 'support@loci.ng',
  hours: 'Mon–Sat, 8am–8pm WAT',
};

/** `tel:` needs the number stripped of spaces and punctuation. */
export const SUPPORT_TEL = `tel:${SUPPORT.phone.replace(/[^\d+]/g, '')}`;

export function supportMailto({ subject, body } = {}) {
  const params = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${SUPPORT.email}${params.length ? `?${params.join('&')}` : ''}`;
}
