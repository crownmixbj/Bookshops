import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Linking,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BUCKET as BOOKLIST_BUCKET, signBooklistImage } from '../../lib/booklistUpload';
import { downloadStorageFile } from '../../lib/quoteFiles';
import { colors, spacing, radius, font } from '../../theme';

/**
 * The buyer's booklist photo, as a vendor sees it while quoting.
 *
 * `image_path` is an object path in the PRIVATE `booklists` bucket, so it
 * is signed on demand and never turned into a public URL. Who may sign it
 * is decided by the storage policy (bookshops_booklist_photo_vendor_access.sql):
 * the buyer, admins, and approved + active vendors — the latter only for a
 * request they can already see. A vendor who is not allowed gets a failed
 * signature and the "could not open" state, with nothing to leak.
 *
 * Two layouts:
 *   - 'primary'   — the request has no itemised lines, so the photo IS the
 *                   booklist. Shown large.
 *   - 'reference' — lines exist; the photo sits above the table as a small
 *                   thumbnail for checking the lines against the original.
 *
 * Zoom works the same on iOS, Android and web without a gesture library:
 * the image is laid out at (fit size × zoom) inside a vertical and a
 * horizontal ScrollView, so the vendor pans by scrolling. Zoom steps come
 * from the +/− buttons or a double tap. Rotate is there because school
 * handouts are very often photographed sideways.
 */

const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
const DOUBLE_TAP_MS = 280;
/** Header + toolbar + padding inside the modal, reserved from the viewport. */
const CHROME_HEIGHT = 140;

type Variant = 'primary' | 'reference';

/**
 * Signs `path` once per path, and can re-sign on demand — a URL signed an
 * hour ago may have expired by the time the vendor comes back to it.
 */
function useSignedBooklistImage(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Guards against a slow signature for the previous request landing
  // after the vendor has already opened the next one.
  const current = useRef(path);

  const sign = useCallback(async () => {
    if (!path) return;
    current.current = path;
    setLoading(true);
    setFailed(false);
    const signed = await signBooklistImage(path);
    if (current.current !== path) return;
    setUrl(signed);
    setFailed(!signed);
    setLoading(false);
  }, [path]);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (path) sign();
    else setLoading(false);
  }, [path, sign]);

  return { url, loading, failed, resign: sign, markFailed: () => setFailed(true) };
}

/** File name the vendor's device saves the handout under. */
function downloadNameFor(path: string, title?: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || 'jpg';
  const base = (title || 'booklist').trim().replace(/\s+/g, '-').toLowerCase();
  return `${base}-booklist.${ext}`;
}

function useDownload(path: string | null | undefined, title?: string) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const download = useCallback(async () => {
    if (!path || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await downloadStorageFile(BOOKLIST_BUCKET, path, downloadNameFor(path, title));
    setBusy(false);
    if (!result.ok) setMessage(result.message ?? 'The download failed.');
    else if (result.message) setMessage(result.message);
  }, [path, title, busy]);
  return { download, busy, message };
}

function DownloadButton({
  onPress,
  busy,
  label = 'Download image',
}: {
  onPress: () => void;
  busy: boolean;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.downloadBtn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Download the buyer's booklist photo"
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.navy} />
      ) : (
        <Ionicons name="download-outline" size={16} color={colors.navy} />
      )}
      <Text style={styles.downloadText}>{label}</Text>
    </Pressable>
  );
}

export function BooklistPhotoViewer({
  imagePath,
  title,
  variant = 'primary',
}: {
  imagePath: string | null | undefined;
  /** Shown in the modal header, e.g. the school name. */
  title?: string;
  variant?: Variant;
}) {
  const { url, loading, failed, resign, markFailed } = useSignedBooklistImage(imagePath);
  const { download, busy: downloading, message: downloadMessage } = useDownload(imagePath, title);
  const [open, setOpen] = useState(false);
  // One automatic re-sign per URL when the <Image> itself fails to load:
  // the likeliest cause is an expired signature, not a missing object.
  const retried = useRef(false);

  useEffect(() => {
    retried.current = false;
  }, [imagePath]);

  const onImageError = useCallback(() => {
    if (!retried.current) {
      retried.current = true;
      resign();
    } else {
      markFailed();
    }
  }, [resign, markFailed]);

  if (!imagePath) return null;

  const canOpen = !!url && !failed;

  if (variant === 'reference') {
    // Siblings, not nested: a download button inside the pressable row
    // would be a <button> inside a <button> on web.
    return (
      <>
        <View style={styles.refRow}>
          <Pressable
            onPress={() => canOpen && setOpen(true)}
            disabled={!canOpen}
            style={({ pressed }) => [styles.refOpen, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Open the buyer's original booklist photo"
          >
            <View style={styles.refThumb}>
              {loading ? (
                <ActivityIndicator size="small" color={colors.navy} />
              ) : canOpen ? (
                <Image
                  source={{ uri: url! }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                  onError={onImageError}
                />
              ) : (
                <Ionicons name="image-outline" size={20} color={colors.textFaint} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.refTitle}>Buyer's original photo</Text>
              <Text style={styles.refHint}>
                {failed
                  ? 'This photo could not be opened.'
                  : 'Tap to zoom in and check the lines below against it.'}
              </Text>
            </View>
          </Pressable>
          {failed ? (
            <Pressable onPress={resign} hitSlop={8} accessibilityRole="button">
              <Text style={styles.link}>Retry</Text>
            </Pressable>
          ) : canOpen ? (
            <DownloadButton onPress={download} busy={downloading} label="Download" />
          ) : null}
        </View>
        {downloadMessage && <Text style={styles.downloadMessage}>{downloadMessage}</Text>}
        {canOpen && (
          <ZoomModal
            visible={open}
            url={url!}
            title={title}
            onClose={() => setOpen(false)}
            onError={onImageError}
            onDownload={download}
          />
        )}
      </>
    );
  }

  return (
    <View style={styles.primary}>
      {canOpen || loading ? (
        <Pressable
          onPress={() => canOpen && setOpen(true)}
          disabled={!canOpen}
          style={({ pressed }) => [styles.primaryFrame, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Open the buyer's booklist photo full screen"
        >
          {loading ? (
            <ActivityIndicator color={colors.navy} />
          ) : (
            <>
              <Image
                source={{ uri: url! }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
                onError={onImageError}
                accessibilityLabel="The buyer's booklist photo"
              />
              <View style={styles.zoomBadge} pointerEvents="none">
                <Ionicons name="search" size={13} color={colors.onNavy} />
                <Text style={styles.zoomBadgeText}>Tap to zoom</Text>
              </View>
            </>
          )}
        </Pressable>
      ) : (
        // A plain View, so Retry is not a button inside a button on web.
        <View style={[styles.primaryFrame, styles.failed]}>
          <Ionicons name="alert-circle-outline" size={22} color={colors.textFaint} />
          <Text style={styles.failedText}>This photo could not be opened.</Text>
          <Pressable onPress={resign} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>Retry</Text>
          </Pressable>
        </View>
      )}
      {canOpen && (
        <View style={styles.primaryActions}>
          <DownloadButton onPress={download} busy={downloading} />
          {downloadMessage && <Text style={styles.downloadMessage}>{downloadMessage}</Text>}
        </View>
      )}
      {canOpen && (
        <ZoomModal
          visible={open}
          url={url!}
          title={title}
          onClose={() => setOpen(false)}
          onError={onImageError}
          onDownload={download}
        />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Full-screen zoom                                                    */
/* ------------------------------------------------------------------ */

/** Paging through several files in one viewer: a quote's pages. */
export interface ZoomPager {
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

export function ZoomModal({
  visible,
  url,
  title,
  onClose,
  onError,
  onDownload,
  kind = 'image',
  pager,
}: {
  visible: boolean;
  /** Null while the current page is still being signed. */
  url: string | null;
  title?: string;
  onClose: () => void;
  onError?: () => void;
  onDownload?: () => void;
  /** A PDF cannot be drawn here; it gets an "Open PDF" card instead. */
  kind?: 'image' | 'pdf';
  pager?: ZoomPager;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [step, setStep] = useState(0);
  const [rotation, setRotation] = useState(0); // 0 | 90 | 180 | 270
  const lastTap = useRef(0);

  // Fresh view every time it opens: a vendor coming back to a photo
  // expects to see the whole page, not wherever they left it zoomed.
  // Also on every page turn: page 2 should not open at page 1's zoom.
  useEffect(() => {
    if (visible) {
      setStep(0);
      setRotation(0);
    }
  }, [visible, url]);

  useEffect(() => {
    let alive = true;
    setNatural(null);
    if (!url || kind === 'pdf') return;
    Image.getSize(
      url,
      (w, h) => alive && setNatural({ w, h }),
      // No size (e.g. a HEIC the platform cannot decode): fall back to a
      // portrait page, which is what almost every booklist is.
      () => alive && setNatural({ w: 3, h: 4 })
    );
    return () => {
      alive = false;
    };
  }, [url, kind]);

  const sideways = rotation % 180 !== 0;
  const zoom = ZOOM_STEPS[step];

  // Fit the (possibly rotated) photo inside the viewport at zoom 1, then
  // scale the box. The ScrollViews scroll whatever overflows.
  const availW = Math.max(winW - spacing.lg * 2, 100);
  const availH = Math.max(winH - CHROME_HEIGHT, 100);
  const aspect = natural ? (sideways ? natural.h / natural.w : natural.w / natural.h) : 3 / 4;
  const fitW = Math.min(availW, availH * aspect);
  const fitH = fitW / aspect;
  const boxW = fitW * zoom;
  const boxH = fitH * zoom;
  // The Image is laid out unrotated, then turned inside the box.
  const imgW = sideways ? boxH : boxW;
  const imgH = sideways ? boxW : boxH;

  const zoomIn = () => setStep((s) => Math.min(s + 1, ZOOM_STEPS.length - 1));
  const zoomOut = () => setStep((s) => Math.max(s - 1, 0));
  const onImagePress = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      setStep((s) => (s === 0 ? 3 : 0)); // 1× ⇄ 3×
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.modalHead}>
          <Text style={styles.modalTitle} numberOfLines={1}>
            {pager && pager.total > 1 ? `Page ${pager.index + 1} of ${pager.total} · ` : ''}
            {title || 'Booklist photo'}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close the photo"
          >
            <Ionicons name="close" size={24} color={colors.onNavy} />
          </Pressable>
        </View>

        {kind === 'pdf' || !url ? (
          <View style={[styles.stage, styles.stageContent]}>
            {!url ? (
              <ActivityIndicator color={colors.onNavy} />
            ) : (
              <View style={styles.pdfCard}>
                <Ionicons name="document-text-outline" size={48} color={colors.onNavy} />
                <Text style={styles.pdfName} numberOfLines={2}>
                  {title || 'PDF'}
                </Text>
                <Pressable
                  onPress={() => Linking.openURL(url)}
                  style={({ pressed }) => [styles.pdfOpen, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Ionicons name="open-outline" size={16} color={colors.navy} />
                  <Text style={styles.pdfOpenText}>Open PDF</Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : (
          <ScrollView
            style={styles.stage}
            contentContainerStyle={styles.stageContent}
            showsVerticalScrollIndicator
          >
            <ScrollView
              horizontal
              contentContainerStyle={styles.stageContent}
              showsHorizontalScrollIndicator
            >
              <Pressable
                onPress={onImagePress}
                style={{ width: boxW, height: boxH }}
                accessibilityRole="image"
                accessibilityLabel="The photo. Double tap to zoom."
              >
                {natural ? (
                  <Image
                    source={{ uri: url }}
                    resizeMode="contain"
                    onError={onError}
                    style={{
                      position: 'absolute',
                      width: imgW,
                      height: imgH,
                      left: (boxW - imgW) / 2,
                      top: (boxH - imgH) / 2,
                      transform: [{ rotate: `${rotation}deg` }],
                    }}
                  />
                ) : (
                  <ActivityIndicator color={colors.onNavy} style={{ marginTop: spacing.xxl }} />
                )}
              </Pressable>
            </ScrollView>
          </ScrollView>
        )}

        <View style={styles.toolbar}>
          {pager && pager.total > 1 && (
            <>
              <ToolButton
                icon="chevron-back"
                label="Previous page"
                onPress={pager.onPrev}
                disabled={pager.index === 0}
              />
              <Text style={styles.zoomLabel}>
                {pager.index + 1}/{pager.total}
              </Text>
              <ToolButton
                icon="chevron-forward"
                label="Next page"
                onPress={pager.onNext}
                disabled={pager.index === pager.total - 1}
              />
              <View style={styles.toolDivider} />
            </>
          )}
          {kind === 'image' && (
            <>
              <ToolButton icon="remove" label="Zoom out" onPress={zoomOut} disabled={step === 0} />
              <Text style={styles.zoomLabel}>{Math.round(zoom * 100)}%</Text>
              <ToolButton
                icon="add"
                label="Zoom in"
                onPress={zoomIn}
                disabled={step === ZOOM_STEPS.length - 1}
              />
              <View style={styles.toolDivider} />
              <ToolButton
                icon="refresh"
                label="Rotate"
                onPress={() => setRotation((r) => (r + 90) % 360)}
              />
              <ToolButton
                icon="open-outline"
                label="Open original"
                onPress={() => url && Linking.openURL(url)}
                disabled={!url}
              />
            </>
          )}
          {onDownload && (
            <ToolButton icon="download-outline" label="Download" onPress={onDownload} />
          )}
        </View>
      </View>
    </Modal>
  );
}

function ToolButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.toolBtn,
        disabled && styles.toolBtnOff,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={colors.onNavy} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  link: { fontSize: font.sm, fontWeight: '700', color: colors.navy },

  primary: { width: '100%', marginTop: spacing.lg },
  primaryActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.navy,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    minHeight: 36,
  },
  downloadText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  downloadMessage: {
    fontSize: font.xs,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  primaryFrame: {
    width: '100%',
    height: 320,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomBadge: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(22,41,79,0.85)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  zoomBadgeText: { color: colors.onNavy, fontSize: font.xs, fontWeight: '700' },
  failed: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  failedText: { fontSize: font.sm, color: colors.textMuted, textAlign: 'center' },

  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  refOpen: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  refThumb: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  refHint: { fontSize: font.sm, color: colors.textMuted, marginTop: 1 },

  backdrop: { flex: 1, backgroundColor: 'rgba(9,17,34,0.95)' },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  modalTitle: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.onNavy },
  stage: { flex: 1 },
  stageContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingBottom: spacing.xl,
  },
  toolBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnOff: { opacity: 0.35 },
  pdfCard: { alignItems: 'center', gap: spacing.md, maxWidth: 320 },
  pdfName: { fontSize: font.md, fontWeight: '700', color: colors.onNavy, textAlign: 'center' },
  pdfOpen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.onNavy,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  pdfOpenText: { fontSize: font.md, fontWeight: '700', color: colors.navy },
  toolDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginHorizontal: spacing.sm,
  },
  zoomLabel: {
    minWidth: 48,
    textAlign: 'center',
    fontSize: font.sm,
    fontWeight: '700',
    color: colors.onNavy,
  },
});
