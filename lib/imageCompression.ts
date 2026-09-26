import { Platform } from 'react-native';
import type { PickedImage } from './booklistUpload';

/**
 * Shrinking a booklist photo before it is uploaded and read.
 *
 * A phone camera hands back a 12-megapixel JPEG — commonly 4–8 MB. Three
 * separate things then have to move it: the upload to Storage, the
 * signed URL the Edge Function fetches, and the vision model that reads
 * it. On a Nigerian mobile connection the first of those alone can run
 * past a minute, which is the hang this module exists to prevent.
 *
 * The target is deliberately NOT "as small as possible". What is being
 * compressed is a picture of small printed text, and the entire value of
 * the upload is that the text stays legible — to the parser, and to the
 * shopkeeper who opens the photo to quote from it. An over-compressed
 * booklist is a fast upload of a useless file.
 */

/**
 * Longest edge, in pixels, after resizing.
 *
 * 2000px keeps roughly 11px of height per line on a typical A4 booklist
 * photographed full-frame, which stays readable both to OCR and to a
 * person zooming in. Below about 1600 the smaller print on a dense
 * secondary-school list starts to break down.
 */
export const MAX_EDGE = 2000;

/** JPEG quality. 0.75 is where text edges stay clean on this content. */
export const JPEG_QUALITY = 0.75;

/**
 * Don't bother below this. Re-encoding a small image costs time and a
 * generation of quality to save almost nothing.
 */
export const COMPRESS_THRESHOLD_BYTES = 600 * 1024;

export interface CompressionResult {
  image: PickedImage;
  /** False when the original was returned unchanged. */
  compressed: boolean;
  /** Bytes before and after, when known. For logging, not for the buyer. */
  beforeBytes?: number;
  afterBytes?: number;
}

/**
 * Compress a picked photo, returning a new PickedImage.
 *
 * Never throws and never blocks the flow: any failure — no canvas, a
 * tainted image, an out-of-memory decode on a cheap Android — resolves
 * to the ORIGINAL image. A booklist that uploads slowly is a nuisance;
 * a booklist that cannot be uploaded at all because the compressor threw
 * is a broken feature.
 *
 * The caller owns both URIs. When `compressed` is true the returned
 * image is a NEW blob: URL and the original is now redundant — release
 * it with releaseImage() once nothing is rendering it.
 */
export async function compressBooklistImage(image: PickedImage): Promise<CompressionResult> {
  try {
    if (Platform.OS === 'web') return await compressWeb(image);
    // Awaited, so a native failure lands in the catch below.
    return await compressNative(image);
  } catch (e) {
    console.warn('[booklist] compression failed, uploading the original:', e);
    return { image, compressed: false };
  }
}

/* ------------------------------------------------------------------ */
/* Native                                                              */
/* ------------------------------------------------------------------ */

/**
 * Native: resize and re-encode with expo-image-manipulator.
 *
 * Same target as the web path: longest edge MAX_EDGE, JPEG at
 * JPEG_QUALITY. HEIC comes out as JPEG too, which also means a buyer or
 * shop on Android or the web can actually open it.
 *
 * Imported lazily: it is a native module, and an app binary built before
 * it was added does not contain it. On such a build this returns the
 * original (the picker's own `quality: 0.6` re-encode still applies)
 * rather than taking the upload down with it.
 */
async function compressNative(image: PickedImage): Promise<CompressionResult> {
  let mod: typeof import('expo-image-manipulator');
  try {
    mod = await import('expo-image-manipulator');
  } catch {
    return { image, compressed: false };
  }
  const { ImageManipulator, SaveFormat } = mod;

  // Rendered once untouched to learn the dimensions, so the resize can
  // cap the LONG edge. resize({ width }) alone would cap a portrait
  // page on its short edge and leave it far larger than intended.
  const original = await ImageManipulator.manipulate(image.uri).renderAsync();
  const { width, height } = original;
  const isHeic = /heic|heif/i.test(image.mimeType) || /\.hei[cf]$/i.test(image.fileName);
  if (Math.max(width, height) <= MAX_EDGE && !isHeic) {
    original.release?.();
    return { image, compressed: false };
  }

  const context = ImageManipulator.manipulate(image.uri);
  if (Math.max(width, height) > MAX_EDGE) {
    context.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const resized = await context.renderAsync();
  const out = await resized.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  original.release?.();
  resized.release?.();

  return {
    image: { uri: out.uri, mimeType: 'image/jpeg', fileName: toJpegName(image.fileName) },
    compressed: true,
  };
}

/* ------------------------------------------------------------------ */
/* Web                                                                 */
/* ------------------------------------------------------------------ */

async function compressWeb(image: PickedImage): Promise<CompressionResult> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    return { image, compressed: false };
  }

  const source = await fetch(image.uri).then((r) => r.blob());
  if (source.size <= COMPRESS_THRESHOLD_BYTES) {
    return { image, compressed: false, beforeBytes: source.size, afterBytes: source.size };
  }

  // imageOrientation: 'from-image' applies the EXIF rotation tag while
  // decoding. This is not a nicety on this feature: a phone held
  // upright writes the pixels sideways and records "rotate 90" in EXIF,
  // and a canvas that ignores the tag bakes in a sideways page. The
  // buyer sees an upright photo in the picker and a sideways one after
  // upload, and the parser is handed rotated text it reads far worse.
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { image, compressed: false };
  }

  // The default nearest-neighbour downscale turns small text into
  // aliased noise. This is the one setting that decides whether the
  // resized photo is still readable.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Paper is white; a JPEG has no alpha channel, so any transparency
  // would flatten to black and swallow the text.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const out = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  );
  // A re-encode that came out BIGGER means the source was already better
  // optimised than anything we can do. Keep the original.
  if (!out || out.size >= source.size) {
    return { image, compressed: false, beforeBytes: source.size, afterBytes: source.size };
  }

  return {
    image: {
      uri: URL.createObjectURL(out),
      mimeType: 'image/jpeg',
      fileName: toJpegName(image.fileName),
    },
    compressed: true,
    beforeBytes: source.size,
    afterBytes: out.size,
  };
}

/**
 * The stored object is keyed by this extension, so a PNG re-encoded as
 * JPEG has to be renamed or it is served with the wrong content type.
 */
function toJpegName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '') || `booklist-${Date.now()}`;
  return `${base}.jpg`;
}
