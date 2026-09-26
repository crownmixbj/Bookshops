import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Image, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  QUOTE_RESPONSE_BUCKET,
  downloadStorageFile,
  formatBytes,
  isPdf,
  signStorageFiles,
  type StoredFile,
} from '../../lib/quoteFiles';
import { ZoomModal } from '../vendor/BooklistPhotoViewer';
import { colors, spacing, radius, font } from '../../theme';

/**
 * A shop's response files on a quote: the pages of its priced sheet,
 * as photos and/or PDFs, in the order the shop put them.
 *
 * The quote-responses bucket is private. All pages are signed in one
 * request; the storage policy decides who may sign (the shop, admins,
 * and the buyer once the quote is sent).
 */

/** Signs every path in one round trip, and again when the set changes. */
export function useSignedFileUrls(paths: string[]) {
  const key = paths.join('|');
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);

  const sign = useCallback(async () => {
    if (!paths.length) {
      setUrls({});
      return;
    }
    setLoading(true);
    setUrls(await signStorageFiles(QUOTE_RESPONSE_BUCKET, paths));
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    sign();
  }, [sign]);

  return { urls, loading, resign: sign };
}

/* ------------------------------------------------------------------ */
/* One tile                                                            */
/* ------------------------------------------------------------------ */

export function FileTile({
  label,
  name,
  type,
  uri,
  meta,
  onPress,
  onRemove,
  onMoveEarlier,
  onMoveLater,
}: {
  label: string;
  name: string;
  type: string;
  /** Local or signed URL for an image thumbnail. Null while signing. */
  uri: string | null;
  meta?: string;
  onPress: () => void;
  onRemove?: () => void;
  onMoveEarlier?: () => void;
  onMoveLater?: () => void;
}) {
  const pdf = isPdf(type);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [uri]);

  return (
    <View style={styles.tile}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.thumb, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${name}. Tap to preview.`}
      >
        {pdf ? (
          <View style={styles.pdfThumb}>
            <Ionicons name="document-text-outline" size={30} color={colors.navy} />
            <Text style={styles.pdfBadge}>PDF</Text>
          </View>
        ) : uri && !broken ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setBroken(true)}
          />
        ) : uri === null && !broken ? (
          <ActivityIndicator size="small" color={colors.navy} />
        ) : (
          <Ionicons name="image-outline" size={24} color={colors.textFaint} />
        )}
        <View style={styles.pageBadge} pointerEvents="none">
          <Text style={styles.pageBadgeText}>{label}</Text>
        </View>
      </Pressable>

      <Text style={styles.tileName} numberOfLines={1}>
        {name}
      </Text>
      {!!meta && <Text style={styles.tileMeta}>{meta}</Text>}

      {(onRemove || onMoveEarlier || onMoveLater) && (
        <View style={styles.tileActions}>
          <TileAction icon="chevron-back" label={`Move ${label} earlier`} onPress={onMoveEarlier} />
          <TileAction icon="chevron-forward" label={`Move ${label} later`} onPress={onMoveLater} />
          <TileAction icon="trash-outline" label={`Remove ${label}`} onPress={onRemove} danger />
        </View>
      )}
    </View>
  );
}

function TileAction({
  icon,
  label,
  onPress,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.tileAction, !onPress && styles.off, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={15} color={danger ? colors.danger : colors.navy} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Viewer: page through every file                                     */
/* ------------------------------------------------------------------ */

export interface ViewerItem {
  url: string | null;
  type: string;
  name: string;
}

export function FilesViewer({
  items,
  index,
  onIndexChange,
  onClose,
  onDownload,
}: {
  items: ViewerItem[];
  /** Null when closed. */
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onDownload?: (i: number) => void;
}) {
  const current = index == null ? null : items[index];
  if (!current || index == null) return null;
  return (
    <ZoomModal
      visible
      url={current.url}
      title={current.name}
      kind={isPdf(current.type) ? 'pdf' : 'image'}
      onClose={onClose}
      onDownload={onDownload ? () => onDownload(index) : undefined}
      pager={{
        index,
        total: items.length,
        onPrev: () => onIndexChange(Math.max(0, index - 1)),
        onNext: () => onIndexChange(Math.min(items.length - 1, index + 1)),
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Read-only gallery (buyer, and the shop's sent-quote view)           */
/* ------------------------------------------------------------------ */

export function QuoteResponseGallery({ files }: { files: StoredFile[] }) {
  const paths = useMemo(() => files.map((f) => f.path), [files]);
  const { urls } = useSignedFileUrls(paths);
  const [open, setOpen] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const download = useCallback(
    async (i: number) => {
      const f = files[i];
      if (!f || downloading) return;
      setDownloading(true);
      setMessage(null);
      const result = await downloadStorageFile(QUOTE_RESPONSE_BUCKET, f.path, f.name, f.type);
      setDownloading(false);
      if (!result.ok || result.message) setMessage(result.message ?? 'The download failed.');
    },
    [files, downloading]
  );

  if (!files.length) return null;

  const items: ViewerItem[] = files.map((f) => ({
    url: urls[f.path] ?? null,
    type: f.type,
    name: f.name,
  }));
  const pageWord = files.length === 1 ? 'page' : 'pages';

  return (
    <View style={styles.gallery}>
      <Text style={styles.galleryHead}>
        {files.length} {pageWord} · tap one to view, then page through with the arrows
      </Text>
      <View style={styles.grid}>
        {files.map((f, i) => (
          <FileTile
            key={f.path}
            label={`Page ${i + 1}`}
            name={f.name}
            type={f.type}
            uri={isPdf(f.type) ? null : urls[f.path] ?? null}
            meta={formatBytes(f.size)}
            onPress={() => setOpen(i)}
          />
        ))}
      </View>
      {downloading && <ActivityIndicator size="small" color={colors.navy} />}
      {!!message && <Text style={styles.message}>{message}</Text>}
      <FilesViewer
        items={items}
        index={open}
        onIndexChange={setOpen}
        onClose={() => setOpen(null)}
        onDownload={download}
      />
    </View>
  );
}

const TILE = 104;

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  off: { opacity: 0.3 },

  gallery: { gap: spacing.sm },
  galleryHead: { fontSize: font.xs, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  message: { fontSize: font.xs, color: colors.textMuted },

  tile: { width: TILE, gap: 2 },
  thumb: {
    width: TILE,
    height: TILE * 1.3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfThumb: { alignItems: 'center', gap: 4 },
  pdfBadge: { fontSize: font.xs, fontWeight: '800', color: colors.navy },
  pageBadge: {
    position: 'absolute',
    left: 4,
    top: 4,
    backgroundColor: 'rgba(22,41,79,0.85)',
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  pageBadgeText: { fontSize: 10, fontWeight: '800', color: colors.onNavy },
  tileName: { fontSize: font.xs, fontWeight: '600', color: colors.text, marginTop: 2 },
  tileMeta: { fontSize: 10, color: colors.textFaint },
  tileActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  tileAction: {
    width: 30,
    height: 26,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
