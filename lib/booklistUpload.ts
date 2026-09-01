import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../utils/supabase';
import type { BookRequestItem, ItemCategory } from '../types/db';

export const BUCKET = 'booklists';

export interface PickedImage {
  uri: string;
  mimeType: string;
  fileName: string;
}

/**
 * Opens the camera roll (or camera) and returns the chosen image.
 * Returns null when the user cancels or declines the permission.
 */
export async function pickBooklistImage(
  source: 'library' | 'camera' = 'library'
): Promise<PickedImage | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
  } else {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.7,
          allowsEditing: false,
        });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType ?? 'image/jpeg',
    fileName: asset.fileName ?? `booklist-${Date.now()}.jpg`,
  };
}

/**
 * Uploads the image to the `booklists` bucket.
 *
 * The object path MUST start with the uploader's user id — the
 * `booklists_insert_own_folder` storage policy checks exactly that, so a
 * path in any other shape is rejected by Postgres, not just by
 * convention.
 *
 * Returns the object path. Store that, not a URL: the bucket is private
 * and signed URLs expire.
 */
export async function uploadBooklistImage(
  userId: string,
  requestId: string,
  image: PickedImage
): Promise<string> {
  const ext = (image.fileName.split('.').pop() ?? 'jpg').toLowerCase();
  const path = `${userId}/${requestId}.${ext}`;

  // React Native's fetch handles file:// URIs; on web the uri is a blob:
  // or data: URL. Both resolve to a Blob, which supabase-js accepts.
  const response = await fetch(image.uri);
  const blob = await response.blob();

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: image.mimeType,
    upsert: true,
  });
  if (error) throw error;

  return path;
}

/** Signs a stored object path for display. The bucket is private. */
export async function signBooklistImage(
  path: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/* ------------------------------------------------------------------ */
/* Document parsing                                                    */
/* ------------------------------------------------------------------ */

export type ParsedItem = Pick<BookRequestItem, 'title' | 'category' | 'quantity'> & {
  unit_price: number | null;
};

export interface ParseResult {
  items: ParsedItem[];
  /** False when no parser ran, so the UI can say so rather than imply OCR happened. */
  parsed: boolean;
  note: string;
}

/**
 * NOT IMPLEMENTED — this is the seam, not the feature.
 *
 * There is no OCR service wired up, so this returns an empty result and
 * says so. It is deliberately shaped like the real thing: give it a
 * stored object path, get back line items ready to insert into
 * book_request_items.
 *
 * TODO(parsing): to make this real, pick one and replace the body only —
 * no caller changes:
 *   a) a Supabase Edge Function that signs the object, sends it to a
 *      vision model, and returns items in this shape (keeps the API key
 *      server-side, which is the reason to prefer it);
 *   b) Google Cloud Vision / AWS Textract document text detection, then
 *      a line-splitting pass into { title, quantity, category };
 *   c) on-device OCR via a native module, for offline capture.
 *
 * Whichever you choose, insert the rows with parsed = true so the UI can
 * flag lines a human has not confirmed.
 */
export async function parseBooklistImage(imagePath: string): Promise<ParseResult> {
  console.warn(
    '[booklist] parseBooklistImage is a stub — no OCR service is configured. Path:',
    imagePath
  );
  return {
    items: [],
    parsed: false,
    note: 'Automatic reading is not set up yet — add the items yourself and vendors will quote them.',
  };
}

/** Heuristic used by a future parser to bucket a line into a category. */
export function guessCategory(title: string): ItemCategory {
  const t = title.toLowerCase();
  if (/(uniform|shirt|short|skirt|trouser|blazer|tie|sock|shoe|sandal)/.test(t)) return 'uniform';
  if (/(pen|pencil|biro|crayon|eraser|ruler|sharpener|note ?book|exercise book|cardboard|file|folder|scissors|glue)/.test(t)) {
    return 'stationery';
  }
  if (/(mathematics|english|science|history|dictionary|textbook|reader|atlas|bible|quran)/.test(t)) {
    return 'textbook';
  }
  return 'other';
}
