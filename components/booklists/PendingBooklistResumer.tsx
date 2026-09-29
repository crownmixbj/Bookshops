import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '../../utils/supabase';
import { getSessionUserId, subscribeToAuthReloads, withTimeout } from '../../lib/loadState';
import {
  clearPendingBooklist,
  loadPendingBooklist,
  pendingBooklistHeld,
  photoFromStorage,
  savePendingBooklist,
} from '../../lib/pendingBooklist';
import { submitBooklist } from '../../lib/booklistSubmit';
import {
  IMAGE_PROCESSING_TIMEOUT_MS,
  describeBooklistError,
  draftImageKey,
  isDailyLimitError,
  uploadBooklistImage,
} from '../../lib/booklistUpload';
import { colors, spacing, radius, font, shadow } from '../../theme';

/**
 * Sends the booklist a guest pressed "Sign in to Send" on, once they are
 * signed in — for the case the review modal cannot cover: signing up
 * took them away from the page (email confirmation, a reload), so the
 * modal and everything in it is gone. See lib/pendingBooklist.ts.
 *
 * Mounted once in AppShell. Runs when a session appears (on load, or on
 * sign-in), stands back while a review modal is still holding the send
 * (it sends it itself), and only for buyer accounts. The stored copy is
 * removed BEFORE sending, so a second tab or a second sign-in event can
 * never send the same list twice; if the send fails before anything was
 * written, it is put back so it can be tried again.
 *
 * Reports the outcome in a small banner and opens My Booklists.
 */

type Banner = { tone: 'ok' | 'warn'; text: string; retry?: boolean };

export function PendingBooklistResumer() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const running = useRef(false);

  const attempt = useCallback(async () => {
    if (running.current || pendingBooklistHeld()) return;
    const uid = await getSessionUserId();
    if (!uid) return;
    const pending = await loadPendingBooklist();
    if (!pending || pendingBooklistHeld()) return;

    running.current = true;
    try {
      // A shop or admin account cannot own a booklist. Leave the copy
      // where it is (it expires on its own) rather than lose it.
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
      if (profile && (profile as { role?: string }).role !== 'buyer') return;

      if (!pending.lines.length && !pending.photo) {
        // Photo-only, and the photo was too large to keep on the device.
        await clearPendingBooklist();
        setBanner({
          tone: 'warn',
          text: `Your booklist photo for ${pending.school || 'your school'} could not be kept while you signed in. Please add it again.`,
        });
        return;
      }

      // Claim it before sending: nothing else will pick it up now.
      await clearPendingBooklist();

      let imagePath: string | null = null;
      if (pending.photo) {
        try {
          imagePath = await withTimeout(
            uploadBooklistImage(uid, draftImageKey(), photoFromStorage(pending.photo)),
            IMAGE_PROCESSING_TIMEOUT_MS,
            'Photo upload'
          );
        } catch (e) {
          if (!pending.lines.length) {
            await savePendingBooklist(pending);
            throw e;
          }
          console.warn('[booklist] stored photo not uploaded; sending the typed lines only:', e);
        }
      }

      const input = {
        userId: uid,
        school: pending.school,
        classLevel: pending.classLevel,
        imagePath,
        lines: pending.lines,
        delivery: pending.delivery,
        // They ticked the accuracy box before being asked to sign in; a
        // copy without it is kept as a draft, never sent.
        publish: pending.publish && pending.confirmed,
      };

      let sentAsDraft = !input.publish;
      let note = '';
      try {
        note = (await submitBooklist(input)).deliveryNote;
      } catch (e) {
        if (!isDailyLimitError(e)) throw e;
        // Today's 3 sends are used up: keep it as a draft to send tomorrow.
        note = (await submitBooklist({ ...input, publish: false })).deliveryNote;
        sentAsDraft = true;
        setBanner({
          tone: 'warn',
          text: `${describeBooklistError(e)} Your booklist for ${pending.school} is saved as a draft in My Booklists.`,
        });
        router.push('/booklists');
        return;
      }

      setBanner({
        tone: 'ok',
        text: sentAsDraft
          ? `Your booklist for ${pending.school} is saved as a draft in My Booklists.${note}`
          : `Your booklist for ${pending.school} was sent to shops. Quotes will appear in My Booklists.${note}`,
      });
      router.push('/booklists');
    } catch (e) {
      // Nothing was written if we got here before the insert; put it back
      // so it can be retried rather than lost.
      if (!(await loadPendingBooklist())) await savePendingBooklist(pending);
      setBanner({
        tone: 'warn',
        text: `We couldn't send the booklist you started before signing in: ${describeBooklistError(e)}`,
        retry: true,
      });
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    void attempt();
    return subscribeToAuthReloads(() => void attempt());
  }, [attempt]);

  // An ok banner goes on its own; a warning waits to be read.
  useEffect(() => {
    if (banner?.tone !== 'ok') return;
    const t = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(t);
  }, [banner]);

  if (!banner) return null;
  const ok = banner.tone === 'ok';
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.card, ok ? styles.cardOk : styles.cardWarn]} accessibilityLiveRegion="polite">
        <Ionicons
          name={ok ? 'checkmark-circle' : 'alert-circle'}
          size={18}
          color={ok ? colors.success : colors.warning}
        />
        <Text style={styles.text}>{banner.text}</Text>
        {banner.retry && (
          <Pressable
            onPress={() => {
              setBanner(null);
              void attempt();
            }}
            hitSlop={6}
            accessibilityRole="button"
          >
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        )}
        <Pressable onPress={() => setBanner(null)} hitSlop={8} accessibilityLabel="Dismiss">
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    zIndex: 50,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: 640,
    width: '100%',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  cardOk: { borderColor: '#BFE3CB' },
  cardWarn: { borderColor: '#F1DDB5' },
  text: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 19 },
  retry: { fontSize: font.sm, fontWeight: '800', color: colors.navy },
});
