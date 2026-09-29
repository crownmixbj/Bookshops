import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { compressBooklistImage } from './imageCompression';
import type { PickedImage } from './booklistUpload';
import type { DeliveryChoice } from './requestDelivery';

/**
 * A booklist a guest pressed "Sign in to Send" on, kept on the device
 * until they are signed in, then sent automatically.
 *
 * Two ways a guest gets signed in, and this covers both:
 *
 *   in the sheet   SignInPrompt signs them in without leaving the page.
 *                  The review modal is still open with everything in it
 *                  and sends itself (BooklistReviewModal's resume effect).
 *                  It "holds" the pending send while it can, so the
 *                  app-wide resumer below does not send it a second time.
 *   away and back  sign-up needs an email confirmation, or the page is
 *                  reloaded. Everything in memory is gone, so this record
 *                  is what survives: PendingBooklistResumer (AppShell)
 *                  finds it once there is a session and sends it.
 *
 * What is stored: school, class, the ticked lines, the delivery choice,
 * that the accuracy box was ticked, and — on the web — a compressed copy
 * of the photo as a data URL. Nothing is sent anywhere until the person
 * is signed in. Kept for a day at most; a booklist abandoned longer than
 * that is not something to send on anyone's behalf.
 */

const KEY = 'loci.pendingBooklistSend.v1';
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
/** localStorage holds ~5 MB; leave room for everything else. */
const MAX_PHOTO_CHARS = 3_500_000;

export interface PendingLine {
  title: string;
  author: string;
  quantity: number;
  category: string;
  parsed: boolean;
}

export interface PendingPhoto {
  dataUrl: string;
  mimeType: string;
  fileName: string;
}

export interface PendingBooklist {
  school: string;
  classLevel: string;
  lines: PendingLine[];
  /** Guests have no saved addresses, so only a typed one (or none). */
  delivery: DeliveryChoice;
  /** Send for quotes (true) or keep as a draft (false). */
  publish: boolean;
  /** The accuracy confirmation, which they gave before being asked to sign in. */
  confirmed: boolean;
  photo: PendingPhoto | null;
  savedAt: number;
}

export async function savePendingBooklist(p: Omit<PendingBooklist, 'savedAt'>): Promise<boolean> {
  try {
    const record: PendingBooklist = {
      school: p.school,
      classLevel: p.classLevel,
      lines: p.lines.map((l) => ({
        title: l.title,
        author: l.author,
        quantity: l.quantity,
        category: l.category,
        parsed: l.parsed,
      })),
      // A saved address belongs to an account; a guest cannot have one.
      delivery: p.delivery.mode === 'different' ? p.delivery : { mode: 'none' },
      publish: p.publish,
      confirmed: p.confirmed,
      photo: p.photo,
      savedAt: Date.now(),
    };
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(record));
    } catch {
      // Most likely the photo pushed it over the storage quota. The list
      // itself matters more than the picture: keep that.
      await AsyncStorage.setItem(KEY, JSON.stringify({ ...record, photo: null }));
    }
    return true;
  } catch {
    return false;
  }
}

export async function loadPendingBooklist(): Promise<PendingBooklist | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingBooklist>;
    // Device storage is untrusted input: check the shape before using it.
    if (!p || typeof p.savedAt !== 'number' || !Array.isArray(p.lines)) return null;
    if (Date.now() - p.savedAt > PENDING_TTL_MS) {
      await clearPendingBooklist();
      return null;
    }
    const photo =
      p.photo && typeof p.photo.dataUrl === 'string' && p.photo.dataUrl.startsWith('data:image/')
        ? {
            dataUrl: p.photo.dataUrl,
            mimeType: String(p.photo.mimeType || 'image/jpeg'),
            fileName: String(p.photo.fileName || 'booklist.jpg'),
          }
        : null;
    const d = p.delivery as DeliveryChoice | undefined;
    const delivery: DeliveryChoice =
      d && d.mode === 'different' && d.other
        ? {
            mode: 'different',
            other: {
              address: String(d.other.address ?? ''),
              city: String(d.other.city ?? ''),
              notes: String(d.other.notes ?? ''),
            },
          }
        : { mode: 'none' };
    return {
      school: String(p.school ?? ''),
      classLevel: String(p.classLevel ?? ''),
      lines: p.lines
        .filter((l): l is PendingLine => !!l && typeof l === 'object')
        .map((l) => ({
          title: String(l.title ?? ''),
          author: String(l.author ?? ''),
          quantity: Number(l.quantity) > 0 ? Math.floor(Number(l.quantity)) : 1,
          category: String(l.category ?? 'textbook'),
          parsed: l.parsed === true,
        }))
        .filter((l) => l.title.trim().length > 0),
      delivery,
      publish: p.publish !== false,
      confirmed: p.confirmed === true,
      photo,
      savedAt: p.savedAt,
    };
  } catch {
    return null;
  }
}

export async function clearPendingBooklist(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // The TTL will collect it.
  }
}

/**
 * A compressed copy of the photo as a data URL, for storage. Web only:
 * a native file:// path would survive, but native sign-in never leaves
 * the app, so the in-memory path covers it. Null when it cannot be done
 * or would not fit.
 */
export async function photoForStorage(image: PickedImage | null): Promise<PendingPhoto | null> {
  if (!image || Platform.OS !== 'web' || typeof FileReader === 'undefined') return null;
  let copy: PickedImage | null = null;
  try {
    const result = await compressBooklistImage(image);
    copy = result.compressed ? result.image : null;
    const blob = await (await fetch(result.image.uri)).blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    if (!dataUrl.startsWith('data:image/') || dataUrl.length > MAX_PHOTO_CHARS) return null;
    return { dataUrl, mimeType: result.image.mimeType, fileName: result.image.fileName };
  } catch {
    return null;
  } finally {
    // Only the compressed copy made here; the caller still shows the original.
    if (copy && copy.uri.startsWith('blob:')) URL.revokeObjectURL(copy.uri);
  }
}

/** A stored photo back as something uploadBooklistImage accepts. */
export function photoFromStorage(photo: PendingPhoto): PickedImage {
  return { uri: photo.dataUrl, mimeType: photo.mimeType, fileName: photo.fileName };
}

// ---- in-memory hold ----------------------------------------------------
// While a review modal that intercepted a guest is still on screen, it
// will send the booklist itself the moment the session arrives, so the
// app-wide resumer must stand back. Same JS runtime only, by design:
// after a reload there is no modal, no hold, and the resumer takes over.

let holders = 0;

export function holdPendingBooklist(): () => void {
  holders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
  };
}

export function pendingBooklistHeld(): boolean {
  return holders > 0;
}
