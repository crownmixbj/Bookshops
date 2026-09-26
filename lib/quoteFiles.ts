import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '../utils/supabase';
import { compressBooklistImage } from './imageCompression';
import { draftImageKey, pickBooklistImage } from './booklistUpload';

/**
 * Files around a quote: the shop's own response file (a photo of the
 * priced sheet, a scan or a PDF) and downloading from private buckets.
 *
 * Both buckets are private. Nothing here builds a public URL: every read
 * goes through a short-lived signed URL, and the storage policies decide
 * who may sign (see bookshops_lump_sum_quotes.sql and
 * bookshops_booklist_photo_vendor_access.sql).
 */

export const QUOTE_RESPONSE_BUCKET = 'quote-responses';
/**
 * 5 MB per file. The bucket enforces the same figure (file_size_limit),
 * so this is the friendly early check, not the only one.
 */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
/** Matches quote_response_files_valid() in bookshops_quote_multi_files.sql. */
export const MAX_RESPONSE_FILES = 10;

export const RESPONSE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const;

export interface PickedFile {
  uri: string;
  mimeType: string;
  fileName: string;
  size?: number;
}

/** One entry of quotes.response_files. */
export interface StoredFile {
  path: string;
  name: string;
  type: string;
  size?: number;
}

/** Reads quotes.response_files defensively: it is JSON from the database. */
export function parseResponseFiles(raw: unknown): StoredFile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .filter((f) => typeof f.path === 'string')
    .map((f) => ({
      path: f.path as string,
      name: typeof f.name === 'string' ? f.name : 'Quote file',
      type: typeof f.type === 'string' ? f.type : 'image/jpeg',
      size: typeof f.size === 'number' ? f.size : undefined,
    }));
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isPdf(mimeType: string | null | undefined): boolean {
  return mimeType === 'application/pdf';
}

/** Browsers and pickers are loose about MIME types; tighten from the name. */
function normaliseMime(mimeType: string | undefined, fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (mimeType && (RESPONSE_MIME_TYPES as readonly string[]).includes(mimeType)) return mimeType;
  if (mimeType === 'image/jpg') return 'image/jpeg';
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'heic':
    case 'heif':
      return 'image/heic';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      return mimeType ?? 'application/octet-stream';
  }
}

function validate(file: PickedFile): PickedFile {
  const mimeType = normaliseMime(file.mimeType, file.fileName);
  if (!(RESPONSE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new Error('Choose a photo (JPG, PNG, WEBP, HEIC) or a PDF.');
  }
  return { ...file, mimeType };
}

/* ------------------------------------------------------------------ */
/* Picking                                                             */
/* ------------------------------------------------------------------ */

/** Photograph one page of the marked-up sheet with the camera. */
export async function takeResponsePhoto(): Promise<PickedFile | null> {
  const img = await pickBooklistImage('camera');
  return img ? validate(img) : null;
}

/** What a multi-select pick produced: files to keep, and why any were refused. */
export interface PickOutcome {
  files: PickedFile[];
  rejected: string[];
}

/**
 * Choose one or more existing images or PDFs.
 *
 * Web: a hidden file input, clicked synchronously for the same reason as
 * pickImageWeb() in booklistUpload.ts: an await before .click() can
 * spend the user gesture and the dialog never opens.
 *
 * Native: expo-document-picker, imported lazily. It is a native module,
 * so an app binary built before it was added does not contain it; a
 * static import would crash the whole vendor screen on such a build.
 * Lazily, only this button fails, with a message that says why.
 */
export function chooseResponseFiles(): Promise<PickOutcome> {
  if (Platform.OS === 'web') return chooseFilesWeb();
  return chooseFilesNative();
}

function sortOut(candidates: PickedFile[]): PickOutcome {
  const out: PickOutcome = { files: [], rejected: [] };
  for (const c of candidates) {
    try {
      out.files.push(validate(c));
    } catch (e) {
      releasePickedFile(c);
      out.rejected.push(`${c.fileName}: ${(e as Error).message}`);
    }
  }
  return out;
}

function chooseFilesWeb(): Promise<PickOutcome> {
  const none: PickOutcome = { files: [], rejected: [] };
  if (typeof document === 'undefined') return Promise.resolve(none);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,application/pdf';
    input.style.position = 'fixed';
    input.style.left = '-10000px';
    input.style.opacity = '0';

    let settled = false;
    const finish = (value: PickOutcome) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener('change', () => {
      const list = Array.from(input.files ?? []);
      finish(
        sortOut(
          list.map((file) => ({
            // Caller owns these blob: URLs; see releasePickedFile().
            uri: URL.createObjectURL(file),
            mimeType: file.type,
            fileName: file.name || `quote-${Date.now()}`,
            size: file.size,
          }))
        )
      );
    });
    input.addEventListener('cancel', () => finish(none));

    document.body.appendChild(input);
    input.click();
  });
}

async function chooseFilesNative(): Promise<PickOutcome> {
  let DocumentPicker: typeof import('expo-document-picker');
  try {
    DocumentPicker = await import('expo-document-picker');
  } catch {
    throw new Error(
      'Choosing files needs the latest version of the app. Use "Take photo" for now.'
    );
  }
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/*', 'application/pdf'],
    copyToCacheDirectory: true,
    multiple: true,
  });
  if (result.canceled || !result.assets?.length) return { files: [], rejected: [] };
  return sortOut(
    result.assets.map((a) => ({
      uri: a.uri,
      mimeType: a.mimeType ?? '',
      fileName: a.name ?? `quote-${Date.now()}`,
      size: a.size,
    }))
  );
}

/**
 * Gets a picked file ready to upload, and enforces the 5 MB limit.
 *
 * Photos are shrunk first (longest edge 2000px, JPEG 0.75: the same
 * settings the booklist photos use, chosen so small print stays
 * readable). A 12 MP phone photo usually lands well under 1 MB. Only if
 * it is STILL over 5 MB is it refused. PDFs cannot be shrunk here, so a
 * PDF over 5 MB is refused straight away.
 *
 * Done at pick time rather than at submit, so the vendor finds out about
 * an oversized page while they can still do something about it.
 */
export async function prepareResponseFile(file: PickedFile): Promise<PickedFile> {
  let ready = file;
  if (!isPdf(file.mimeType)) {
    const result = await compressBooklistImage(file);
    if (result.compressed) {
      releasePickedFile(file);
      ready = { ...result.image, mimeType: normaliseMime(result.image.mimeType, result.image.fileName) };
    }
  }
  const size = (await (await fetch(ready.uri)).blob()).size;
  if (size > MAX_RESPONSE_BYTES) {
    releasePickedFile(ready);
    throw new Error(
      isPdf(ready.mimeType)
        ? `is ${formatBytes(size)}. The limit is 5 MB per file. Save the PDF at a lower quality, or split it into pages.`
        : `is still ${formatBytes(size)} after shrinking. The limit is 5 MB per file. Try photographing the page again.`
    );
  }
  return { ...ready, size };
}

/** Frees a web blob: URL. No-op for native file:// URIs. */
export function releasePickedFile(file: PickedFile | null | undefined): void {
  if (Platform.OS === 'web' && file?.uri?.startsWith('blob:')) URL.revokeObjectURL(file.uri);
}

/* ------------------------------------------------------------------ */
/* Upload / sign                                                       */
/* ------------------------------------------------------------------ */

/**
 * Uploads a response file to <vendorId>/<quoteId>/<key>.<ext>.
 *
 * The first path segment MUST be the shop's vendor id: the insert policy
 * and quote_response_files_valid() both check it. Expects a file that has
 * been through prepareResponseFile().
 */
export async function uploadQuoteResponse(
  vendorId: string,
  quoteId: string,
  file: PickedFile
): Promise<StoredFile> {
  const mimeType = normaliseMime(file.mimeType, file.fileName);
  const ext = isPdf(mimeType) ? 'pdf' : (file.fileName.split('.').pop() ?? 'jpg').toLowerCase();
  const path = `${vendorId}/${quoteId}/${draftImageKey()}.${ext}`;

  const blob = await (await fetch(file.uri)).blob();
  if (blob.size > MAX_RESPONSE_BYTES) {
    throw new Error(`${file.fileName} is over 5 MB. Remove it and add a smaller copy.`);
  }

  const { error } = await supabase.storage
    .from(QUOTE_RESPONSE_BUCKET)
    .upload(path, blob, { contentType: mimeType, upsert: false });
  if (error) {
    // Storage's own 5 MB limit, in words a shopkeeper can act on.
    if (/exceeded|too large|413|maximum allowed size/i.test(error.message)) {
      throw new Error(`${file.fileName} is over the 5 MB limit.`);
    }
    throw error;
  }

  // The buyer downloads under the original name, not the random key.
  return { path, name: file.fileName.slice(0, 200), type: mimeType, size: blob.size };
}

/** Best effort: a replaced file left behind is clutter, not a leak. */
export async function removeQuoteResponse(path: string): Promise<void> {
  const { error } = await supabase.storage.from(QUOTE_RESPONSE_BUCKET).remove([path]);
  if (error) console.warn('[quote] old response file not removed:', error.message);
}

export async function signStorageFile(
  bucket: string,
  path: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Signs several paths in one request. Missing or refused paths map to null. */
export async function signStorageFiles(
  bucket: string,
  paths: string[],
  expiresInSeconds = 3600
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  if (!paths.length) return out;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, expiresInSeconds);
  for (const p of paths) out[p] = null;
  if (error || !data) return out;
  for (const row of data) {
    if (row.path && row.signedUrl && !row.error) out[row.path] = row.signedUrl;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Download                                                            */
/* ------------------------------------------------------------------ */

export interface DownloadResult {
  ok: boolean;
  message?: string;
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'download';
}

/**
 * Saves a file from a private bucket to the device.
 *
 * Web: a URL signed with `download`, which makes Storage answer with
 * Content-Disposition: attachment. The browser saves it under that name
 * instead of opening it in the tab. (An <a download> attribute alone is
 * ignored for a cross-origin URL.)
 *
 * Native: download into the cache, then the share sheet, where "Save
 * Image" / "Save to Files" put it wherever the vendor keeps things. The
 * same shape as lib/statement.ts.
 */
export async function downloadStorageFile(
  bucket: string,
  path: string,
  fileName: string,
  mimeType?: string
): Promise<DownloadResult> {
  const name = safeFileName(fileName);
  try {
    if (Platform.OS === 'web') {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 300, { download: name });
      if (error || !data?.signedUrl) throw error ?? new Error('Could not prepare the download.');
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return { ok: true };
    }

    const url = await signStorageFile(bucket, path, 300);
    if (!url) throw new Error('You do not have access to this file, or it no longer exists.');

    const target = new File(Paths.cache, name);
    if (target.exists) target.delete();
    const file = await File.downloadFileAsync(url, target);

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
      return { ok: true };
    }
    return { ok: true, message: `Saved to ${file.uri}` };
  } catch (e) {
    return { ok: false, message: (e as Error)?.message ?? 'The download failed.' };
  }
}
