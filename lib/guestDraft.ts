import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'loci.guestBooklistDraft.v1';

/** One typed line, as the manual screen holds it. */
export interface GuestDraftLine {
  key: string;
  title: string;
  author: string;
  quantity: number;
}

export interface GuestDraft {
  school: string;
  classLevel: string;
  lines: GuestDraftLine[];
  /** Set when the draft was started from a shop's page. */
  targetVendorId?: string | null;
  targetShopName?: string | null;
  /**
   * Whether the accuracy checkbox was already ticked when the guest was
   * intercepted. Carried so a confirmation they genuinely made is not
   * demanded twice for the same unchanged list — see mergeGuestDraft.
   */
  confirmed: boolean;
  /** When it was last written, for the staleness check on restore. */
  savedAt: number;
}

/**
 * How long a guest draft is worth keeping.
 *
 * A booklist is a term-time errand, not a permanent document. Restoring
 * one from three weeks ago — a different term, possibly a different
 * child — is worse than starting clean, because the buyer may not read
 * it closely before sending.
 */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The guest's in-progress booklist, kept on the device.
 *
 * Deliberately NOT the photo. A picked image is a blob: URL on web and a
 * file:// path on native; neither survives a reload or an app restart,
 * so persisting the string would restore a draft pointing at an image
 * that cannot be read — and the upload would fail at the worst possible
 * moment, after the person had signed up. Photos stay in memory for the
 * session and a guest who reloads re-attaches one.
 */
export async function loadGuestDraft(): Promise<GuestDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<GuestDraft>;
    // Anything on device storage is untrusted input: it may have been
    // written by an older build with a different shape.
    if (!parsed || !Array.isArray(parsed.lines)) return null;
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      await clearGuestDraft();
      return null;
    }

    return {
      school: String(parsed.school ?? ''),
      classLevel: String(parsed.classLevel ?? ''),
      lines: parsed.lines
        .filter((l): l is GuestDraftLine => !!l && typeof l === 'object')
        .map((l, i) => ({
          key: String(l.key ?? `restored-${i}`),
          title: String(l.title ?? ''),
          author: String(l.author ?? ''),
          quantity: Number(l.quantity) > 0 ? Number(l.quantity) : 1,
        })),
      targetVendorId: parsed.targetVendorId ?? null,
      targetShopName: parsed.targetShopName ?? null,
      confirmed: parsed.confirmed === true,
      savedAt: parsed.savedAt,
    };
  } catch {
    // Corrupt or unreadable storage must not take the screen down with
    // it. No draft is a workable state; a crash on mount is not.
    return null;
  }
}

export async function saveGuestDraft(
  draft: Omit<GuestDraft, 'savedAt'>
): Promise<void> {
  try {
    // Projected field by field rather than spread. The screen's own line
    // type is free to grow — a picked photo, a per-row note, an id from
    // OCR — and a spread would carry every one of those onto the device
    // silently. Two of them must never land there: an image URI, which
    // is a blob:/file:// handle that is dead the moment the app reloads,
    // and anything the buyer has not been told is being kept. Writing
    // the shape out here makes the stored record a decision instead of a
    // side effect.
    const record: GuestDraft = {
      school: draft.school,
      classLevel: draft.classLevel,
      lines: draft.lines.map((l) => ({
        key: l.key,
        title: l.title,
        author: l.author,
        quantity: l.quantity,
      })),
      targetVendorId: draft.targetVendorId ?? null,
      targetShopName: draft.targetShopName ?? null,
      confirmed: draft.confirmed,
      savedAt: Date.now(),
    };
    await AsyncStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Best effort. A full disk or a private-mode browser should cost the
    // convenience of a restored draft, not the ability to type one.
  }
}

export async function clearGuestDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing useful to do; the TTL will collect it.
  }
}

/** True when there is anything worth restoring. */
export function draftHasContent(draft: GuestDraft | null): boolean {
  if (!draft) return false;
  return draft.school.trim().length > 0 || draft.lines.some((l) => l.title.trim().length > 0);
}
