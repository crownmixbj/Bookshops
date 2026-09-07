import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import {
  pickBooklistImage,
  releaseImage,
  type ImageSource,
  type PickedImage,
} from '../lib/booklistUpload';
import type { BooklistSource } from '../components/CreateBooklistModal';

/** Manual line-item entry. Its own route so the flow is linkable. */
export const MANUAL_BOOKLIST_ROUTE = '/booklists/new-manual';

/**
 * How long to wait for the chooser to be gone before presenting a native
 * picker, when the Modal's own onDismiss does not arrive.
 *
 * iOS fires onDismiss and this is only the safety net, so it sits past
 * the sheet animation. Android never fires it, so the timer IS the
 * mechanism and is kept just past the fade.
 */
const DISMISS_FALLBACK_MS = Platform.OS === 'ios' ? 700 : 250;

export interface CreateBooklistFlow {
  /** Whether <CreateBooklistModal /> is showing. */
  choosing: boolean;
  /**
   * What the buyer named this list in the chooser, e.g.
   * "Chrisland JSS2 — First Term". '' when they did not name it.
   *
   * Seeds the school field on whichever screen comes next, so the
   * question is asked at most once. It creates nothing on its own — a
   * name with no books is not a booklist, which is exactly what the
   * hub's old inline box used to produce.
   */
  title: string;
  setTitle: (title: string) => void;
  /** Open the chooser. Wire every "Create New Booklist" button to this. */
  open: () => void;
  close: () => void;
  /** Pass straight to <CreateBooklistModal onPick={...} />. */
  onPick: (source: BooklistSource) => void;
  /** Pass straight to <CreateBooklistModal onDismissed={...} />. */
  onDismissed: () => void;
  /** True while the camera or file dialog is being opened. */
  picking: boolean;
  /** The picked photo, once there is one. Feeds the OCR review modal. */
  image: PickedImage | null;
  clearImage: () => void;
  /** A picker failure, phrased for a banner. Null when there is none. */
  error: string | null;
  clearError: () => void;
}

/**
 * The one create-a-booklist handler, shared by every entry point.
 *
 * Two destinations, and which one a choice leads to must not depend on
 * the screen it was started from:
 *   camera / gallery -> a photo, handed to BooklistReviewModal (upload,
 *                       OCR, then a human confirms the lines)
 *   manual           -> /booklists/new-manual
 *
 * The hard part is WHEN to launch the picker, and the two platforms want
 * opposite things:
 *
 *   web     Launch inside the click, before anything is awaited. The
 *           browser only opens a file dialog while the gesture that
 *           asked for it is still live; close the chooser afterwards.
 *
 *   native  Launch only once the chooser has actually gone. On iOS a
 *           picker presented from underneath a mounted Modal is never
 *           shown at all — no error, no camera, nothing. Closing the
 *           Modal and launching in the same tick is not enough: the
 *           state update has not been committed, let alone animated
 *           out. So the source is parked and fired from onDismiss, with
 *           a timer behind it for Android, which never sends one.
 */
export function useCreateBooklist(): CreateBooklistFlow {
  const [choosing, setChoosing] = useState(false);
  const [title, setTitle] = useState('');
  const [picking, setPicking] = useState(false);
  const [image, setImageState] = useState<PickedImage | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The image currently on screen, mirrored in a ref.
   *
   * setImage's updater cannot free the outgoing blob: URL — React may
   * call an updater more than once — so the revoke is driven from here
   * instead, exactly once per replacement.
   */
  const currentImage = useRef<PickedImage | null>(null);

  /**
   * The single way `image` changes.
   *
   * Setting it also frees the one it replaces, so a buyer who tries four
   * photos before settling does not leave four full-size images pinned
   * in the tab, and the review screen can never be handed a uri that
   * belongs to an earlier pick.
   */
  const setImage = useCallback((next: PickedImage | null) => {
    const previous = currentImage.current;
    if (previous && previous.uri !== next?.uri) releaseImage(previous);
    currentImage.current = next;
    setImageState(next);
  }, []);

  /** The choice waiting for the chooser to finish dismissing (native only). */
  const pending = useRef<ImageSource | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
      // Leaving the screen mid-flow should not strand a blob: URL.
      releaseImage(currentImage.current);
      currentImage.current = null;
    };
  }, []);

  const open = useCallback(() => {
    setError(null);
    // A fresh start each time. Carrying the last booklist's name into
    // the next one is how the wrong school ends up on a request.
    setTitle('');
    setChoosing(true);
  }, []);

  const close = useCallback(() => {
    pending.current = null;
    setChoosing(false);
  }, []);

  const clearImage = useCallback(() => setImage(null), [setImage]);
  const clearError = useCallback(() => setError(null), []);

  /** Resolve one pick attempt. Always clears `picking`, whatever happens. */
  const settle = useCallback(async (attempt: Promise<PickedImage | null>) => {
    setPicking(true);
    try {
      const picked = await attempt;
      if (!alive.current) {
        // Unmounted mid-pick. Nothing will render this, so free it.
        releaseImage(picked);
        return;
      }
      // Null covers a cancel. A cancel should leave the buyer exactly
      // where they were, so it is silent — the button is still there.
      if (picked) setImage(picked);
    } catch (e) {
      // A refused permission lands here with a sentence explaining
      // itself. Swallowing it was why "Take a photo" could look broken
      // when it had in fact been declined.
      if (alive.current) setError((e as Error)?.message ?? String(e));
    } finally {
      // Unconditional: a thrown picker must never leave the button
      // wedged in its busy state.
      if (alive.current) setPicking(false);
    }
  }, [setImage]);

  /** Fire the parked native pick. Idempotent — onDismiss and the timer race. */
  const runPending = useCallback(() => {
    const source = pending.current;
    if (!source) return;
    pending.current = null;
    if (fallbackTimer.current) {
      clearTimeout(fallbackTimer.current);
      fallbackTimer.current = null;
    }
    void settle(pickBooklistImage(source));
  }, [settle]);

  const onDismissed = useCallback(() => runPending(), [runPending]);

  const onPick = useCallback(
    (source: BooklistSource) => {
      setError(null);

      // Drop whatever was picked before, on every path and BEFORE the
      // new picker opens. If this pick then fails or is cancelled, the
      // buyer gets nothing rather than the previous booklist's photo —
      // which is what "it showed the wrong picture" was.
      setImage(null);

      if (source === 'manual') {
        pending.current = null;
        setChoosing(false);
        // Seeded as a route param, so the manual screen opens with the
        // name already filled in and a refresh does not lose it.
        const school = title.trim();
        router.push(
          school
            ? { pathname: MANUAL_BOOKLIST_ROUTE, params: { school } }
            : MANUAL_BOOKLIST_ROUTE
        );
        return;
      }

      if (Platform.OS === 'web') {
        // Synchronous, before any state update or await: the file dialog
        // has to open while this click is still the live user gesture.
        const attempt = pickBooklistImage(source);
        setChoosing(false);
        void settle(attempt);
        return;
      }

      pending.current = source;
      setChoosing(false);
      // onDismiss normally gets there first on iOS; Android never sends
      // one, so this timer is what actually launches it there.
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
      fallbackTimer.current = setTimeout(runPending, DISMISS_FALLBACK_MS);
    },
    [runPending, setImage, settle, title]
  );

  return {
    choosing,
    title,
    setTitle,
    open,
    close,
    onPick,
    onDismissed,
    picking,
    image,
    clearImage,
    error,
    clearError,
  };
}
