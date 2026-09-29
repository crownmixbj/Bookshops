import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  Image,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ChildPicker } from '../household/ChildPicker';
import type { Child } from '../../types/db';
import {
  uploadBooklistImage,
  parseBooklistImage,
  draftImageKey,
  blankItem,
  OCR_UNREADABLE_NOTE,
  IMAGE_PROCESSING_TIMEOUT_MS,
  SLOW_UPLOAD_MESSAGE,
  guessCategory,
  describeBooklistError,
  type PickedImage,
  type ParsedItem,
} from '../../lib/booklistUpload';
import { QuantityStepper } from './QuantityStepper';
import { BooklistSummary, ConfirmAccuracyCheckbox } from './ConfirmAccuracy';
import { DeliveryAddressSection } from './DeliveryAddressSection';
import { submitBooklist } from '../../lib/booklistSubmit';
import {
  clearPendingBooklist,
  holdPendingBooklist,
  photoForStorage,
  savePendingBooklist,
} from '../../lib/pendingBooklist';
import {
  deliveryProblem,
  type DeliveryChoice,
} from '../../lib/requestDelivery';
import {
  AUTHOR_PLACEHOLDER,
  AUTHOR_REQUIRED_MESSAGE,
  authorRequiredFor,
  lineProblem,
  validateLines,
} from '../../lib/booklistValidation';
import { withTimeout } from '../../lib/loadState';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

interface Props {
  visible: boolean;
  userId: string | null;
  /** The photo the hub already picked. Upload and parsing start from it. */
  image: PickedImage | null;
  /**
   * What the buyer named the list in the chooser, if anything.
   *
   * A starting value for the School field, not an override: if the
   * parser reads a school off the photo that is better evidence than a
   * label typed before the photo was even looked at.
   */
  initialSchool?: string;
  onClose: () => void;
  /** Called after the request row and its items exist. */
  onSubmitted: (message: string) => void | Promise<void>;
  /**
   * Raise the sign-in sheet. Called when a guest presses send.
   *
   * A guest is allowed all the way through this screen — typing the list
   * is the part that takes effort, and asking for an account before they
   * have seen whether the app can help them is the wall the lazy-auth
   * work removed. What needs an identity is the row in book_requests,
   * so that is where the ask belongs.
   */
  onRequireAuth?: () => void;
  /**
   * Hide the card without ending the flow.
   *
   * Two React Native Modals mounted as siblings do not reliably stack:
   * on web they paint in tree order, so whichever is written later wins
   * regardless of who opened whom, and on iOS presenting a second one
   * over a live one is undefined. On the dashboard the sign-in sheet is
   * written BEFORE this modal, so it opened underneath — the guest
   * pressed "Sign in to Send", something did open, and it was invisible
   * behind this card.
   *
   * Rather than fight z-index across two portals, the parent sets this
   * while the sheet is up and this card steps aside. Note it is separate
   * from `visible` on purpose: `visible` drives the upload-and-parse
   * effect, so toggling THAT would re-run the upload and reset() the
   * buyer's typed list — the very thing the sign-in flow exists to
   * preserve. This only touches what is painted.
   */
  suppressed?: boolean;
}

type Phase = 'working' | 'review' | 'submitting';

/** Which button is mid-flight, so only that one shows a spinner. */
type Pending = 'draft' | 'publish' | null;

/**
 * Review and edit a parsed booklist before anything is sent for quotes.
 *
 * The order here is the whole point of the screen: the photo is uploaded
 * and parsed, and then EVERYTHING stops until a human confirms it. No
 * book_requests row is written while this modal is open — a buyer who
 * closes it leaves nothing behind but an orphaned object in storage.
 *
 * That is the opposite of BooklistDetailsModal, which inserts first and
 * treats the photo as best-effort decoration. It is the right trade for
 * a typed list and the wrong one for a parsed one: OCR gets titles
 * wrong, and a wrong title is a wrong quote.
 */
export function BooklistReviewModal({
  visible,
  userId,
  image,
  initialSchool = '',
  onClose,
  onSubmitted,
  onRequireAuth,
  suppressed = false,
}: Props) {
  const { isMobile } = useLayout();

  const [phase, setPhase] = useState<Phase>('working');
  const [pending, setPending] = useState<Pending>(null);
  const [step, setStep] = useState('Uploading your photo…');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [school, setSchool] = useState('');
  const [classLevel, setClassLevel] = useState('');
  /** Which child the list is for. Null = not labelled with a child. */
  const [child, setChild] = useState<Child | null>(null);
  /** Where the books go. Preselected with the default saved address. */
  const [delivery, setDelivery] = useState<DeliveryChoice>({ mode: 'none' });
  const [deliveryIssue, setDeliveryIssue] = useState<string | null>(null);
  /** Bumped by reset() so the next booklist preselects the default again. */
  const [deliveryKey, setDeliveryKey] = useState(0);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  /**
   * Did the parser actually read this photo?
   *
   * Null until it has answered. False means the table below is the
   * buyer's own typing, not a reading of their list — which changes what
   * the screen should say and whether the photo is worth showing them
   * open by default.
   */
  const [readOk, setReadOk] = useState<boolean | null>(null);
  /**
   * Show the per-line errors only once they have tried to submit.
   *
   * Marking a line red the instant a title is typed — before the buyer
   * has reached the author field — is nagging, not helping.
   */
  const [showProblems, setShowProblems] = useState(false);
  /**
   * The accuracy confirmation. Reset on every open — a tick carried over
   * from the last booklist is not a confirmation of this one.
   */
  const [confirmed, setConfirmed] = useState(false);
  /**
   * Bumped by "Try again". The processing effect is keyed on it, so a
   * retry re-runs upload and parse without the buyer re-picking the
   * photo — which on web they could not do anyway, because the file
   * input is long gone and the blob is all that is left of their choice.
   */
  const [attempt, setAttempt] = useState(0);
  /** True when the photo step ran past IMAGE_PROCESSING_TIMEOUT_MS. */
  const [timedOut, setTimedOut] = useState(false);
  /**
   * Which send a guest was stopped on, kept across the sign-in sheet.
   *
   * A ref rather than state: the sheet renders above this modal without
   * unmounting it, so nothing here needs to re-render while they type a
   * password — and a stray render mid-sign-in is how a half-typed form
   * loses focus.
   */
  const pendingSubmit = useRef<boolean | null>(null);
  /** The session as of now, for effects that must not re-run when it changes. */
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  /** The body scroller, so a validation failure can be scrolled to. */
  const scrollRef = useRef<ScrollView>(null);
  /**
   * Where the Review & confirm block sits inside that scroller.
   *
   * Captured from onLayout rather than measured on demand: measure() is
   * async and needs a node handle that react-native-web does not always
   * give for a plain View, and a y-offset recorded at layout time is
   * exact on both platforms.
   */
  const confirmY = useRef(0);

  const reset = useCallback(() => {
    setPhase('working');
    setPending(null);
    setStep('Uploading your photo…');
    setError(null);
    setNotice(null);
    setSchool('');
    setClassLevel('');
    setChild(null);
    setDelivery({ mode: 'none' });
    setDeliveryIssue(null);
    setDeliveryKey((k) => k + 1);
    setItems([]);
    setImagePath(null);
    setShowPhoto(false);
    setReadOk(null);
    setShowProblems(false);
    setConfirmed(false);
    setTimedOut(false);
  }, []);

  /**
   * Upload, then parse — or, for a guest, neither.
   *
   * Three things had to change here, and they were all the same bug
   * wearing different hats: the screen could enter `working` and never
   * leave it.
   *
   *   1. The guard used to include `!userId`, so a guest opened this
   *      modal, the effect returned immediately, and nothing ever set
   *      phase to 'review'. The spinner said "Uploading your photo…"
   *      forever over an upload that was never attempted.
   *   2. Nothing bounded the upload. A large photo on a slow connection
   *      is the same spinner, just earned honestly.
   *   3. `finally` set 'review' only if the whole body reached it, so
   *      an unexpected throw before the inner try left it hanging.
   *
   * `cancelled` guards every setState after an await: the buyer can
   * close this modal mid-parse, and without the guard the parse would
   * come back and repopulate a form that is no longer on screen — so
   * reopening it showed the previous photo's books.
   */
  useEffect(() => {
    if (!visible || !image) return;
    // Read once per photo, from the ref (see userIdRef): signing in
    // part-way must not re-upload, re-read and reset what they typed.
    const userId = userIdRef.current;
    let cancelled = false;

    (async () => {
      reset();

      // ---- guest ---------------------------------------------------
      // No upload: the `booklists` bucket's insert policy requires the
      // object path to start with the uploader's user id, so there is
      // no path a signed-out person could legally write to. And no
      // parse: parse-booklist takes a stored path and refuses one the
      // caller does not own, by design — it holds the API key, and an
      // endpoint anonymous callers can post images to is an endpoint
      // anyone can spend the project's credits on.
      //
      // So the photo stays exactly where it already is, on the device,
      // and the buyer types the list. That is the same screen a
      // signed-in buyer gets when OCR cannot read their photo, which is
      // why it needs no separate design.
      if (!userId) {
        if (cancelled) return;
        setReadOk(false);
        setSchool(initialSchool.trim());
        setItems([blankItem()]);
        setShowPhoto(true);
        setNotice(
          'Your photo is kept on this device for now — reading it automatically needs an account. ' +
            'Type the books below, and the photo is attached and sent to shops when you sign in.'
        );
        setPhase('review');
        return;
      }

      // ---- signed in ----------------------------------------------
      let path: string | null = null;

      try {
        setStep('Uploading your photo…');
        // Compression happens inside uploadBooklistImage, so this one
        // budget covers shrinking and sending together — which is what
        // the buyer is actually waiting through.
        path = await withTimeout(
          uploadBooklistImage(userId, draftImageKey(), image),
          IMAGE_PROCESSING_TIMEOUT_MS,
          'Photo upload'
        );
        if (cancelled) return;
        setImagePath(path);
      } catch (e) {
        if (cancelled) return;
        const slow = /timed out/i.test((e as Error).message ?? '');
        if (slow) setTimedOut(true);
        // Not fatal either way. The photo is a reference for the buyer
        // and for the vendor; the list itself is what gets quoted. Fall
        // through to the typing form rather than dead-ending them.
        setNotice(
          slow
            ? SLOW_UPLOAD_MESSAGE
            : `Your photo could not be uploaded (${(e as Error).message}). You can still add the books by hand.`
        );
      }

      try {
        setStep('Reading your list…');
        // parseBooklistImage never throws and never invents: a photo it
        // could not read comes back with an empty list and a note. There
        // is no fixture path any more — a booklist of books the buyer
        // never asked for is worse than no booklist at all, because it
        // gets quoted and paid for.
        //
        // Timed out as well as the upload. The Edge Function signs a URL
        // and waits on a vision model, and a model that never answers
        // must not become a permanent spinner.
        const result = path
          ? await withTimeout(
              parseBooklistImage(path),
              IMAGE_PROCESSING_TIMEOUT_MS,
              'Reading the photo'
            )
          : { school_name: '', class_level: '', items: [], parsed: false, note: '' };
        if (cancelled) return;

        const read = result.parsed && result.items.length > 0;
        setReadOk(read);
        // The photo wins when it names a school; the buyer's own label
        // fills the gap when it does not, so they never type it twice.
        setSchool(result.school_name || initialSchool.trim());
        setClassLevel(result.class_level);
        // One empty row either way, so there is somewhere to start
        // typing. Nothing is pre-filled that did not come off the photo.
        setItems(read ? result.items : [blankItem()]);
        // Only if the upload did not already leave one. Overwriting the
        // upload's message with the parser's would hide the fact that
        // the photo never arrived, which is the more important of the
        // two — it is the one that means shops will not see it.
        if (result.note) setNotice((current) => current ?? result.note);
        // Nothing was read, so the photo is the only copy of the list
        // the buyer has in front of them. Open it — they are about to
        // type from it.
        if (!read) setShowPhoto(true);
      } catch (e) {
        if (cancelled) return;
        const slow = /timed out/i.test((e as Error).message ?? '');
        if (slow) setTimedOut(true);
        setReadOk(false);
        setSchool((current) => current || initialSchool.trim());
        setNotice((current) => current ?? (slow ? SLOW_UPLOAD_MESSAGE : OCR_UNREADABLE_NOTE));
        setItems((current) => (current.length ? current : [blankItem()]));
        setShowPhoto(true);
        console.warn('[booklist] parse failed:', e);
      } finally {
        // Outside every branch above, deliberately. This one line is
        // what guarantees the spinner ends, whatever went wrong.
        if (!cancelled) setPhase('review');
      }
    })();

    return () => {
      cancelled = true;
    };
    // Keyed on image.uri, not the object: a re-render that hands over a
    // new wrapper for the SAME photo must not upload and parse it twice,
    // and a genuinely new photo always has a new uri. `attempt` is here
    // so "Try again" re-runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // userId is deliberately NOT a dependency. When a guest signs in with
    // the card open, this used to run again: a second upload of the same
    // photo, and reset() wiping every line they had typed — while the
    // send that sign-in was for was still in flight. The send uploads the
    // photo itself (handleSave), so there is nothing here to redo.
  }, [visible, image?.uri, initialSchool, attempt, reset]);

  /* ---------------- item editing ---------------- */

  function patchItem(id: string, patch: Partial<ParsedItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  function addItem() {
    setItems((current) => [...current, blankItem()]);
  }

  const selected = items.filter((item) => item.selected && item.title.trim().length > 0);

  /**
   * Only ticked lines are validated. An unticked line means "I already
   * own this" and is never saved, so demanding its publisher would block
   * the buyer over a book they are not even ordering.
   */
  const verdict = validateLines(
    items.filter((item) => item.selected),
    (item) => item.id
  );
  const blocked = new Set(verdict.missingAuthor);
  /**
   * Sending the photo alone is a real option, not a degraded one.
   *
   * When nothing could be read, the note tells the buyer they can "send
   * the raw photo directly to shops" — so the button has to honour that.
   * A shop opening the request sees the photo and quotes off it, which
   * is exactly what happens over WhatsApp today.
   */
  // Any photo counts: uploaded (imagePath) or still only on the device —
  // a guest's is not uploaded until they sign in, and before this their
  // "send the photo on its own" could never pass the checks.
  const photoOnly = selected.length === 0 && (Boolean(imagePath) || Boolean(image));
  /**
   * Note what is NOT in here: userId.
   *
   * A guest gets a live, pressable button, and the sign-in ask happens
   * when they press it. A greyed-out button with no explanation is how
   * someone concludes the app is broken and closes it.
   */
  const canSubmit =
    phase === 'review' &&
    school.trim().length > 0 &&
    (verdict.ok || photoOnly) &&
    confirmed;

  /**
   * The one reason worth telling them about, or null when it can be sent.
   *
   * Ordered by where the fix is on the page — top first — so the message
   * and the scroll always agree. Naming exactly one thing at a time is
   * deliberate: a list of everything wrong with a form is read as a
   * wall, and they will fix them one at a time anyway.
   */
  const blocker: { message: string; scrollToConfirm: boolean } | null =
    phase !== 'review'
      ? null
      : school.trim().length === 0
      ? { message: 'Add the school name before sending this list.', scrollToConfirm: false }
      : !verdict.ok && !photoOnly
      ? {
          message:
            verdict.message ??
            'Give every ticked book a title and an author or publisher, or untick it.',
          scrollToConfirm: false,
        }
      : !confirmed
      ? { message: 'Please tick the confirmation checkbox to proceed.', scrollToConfirm: true }
      : null;

  /* ---------------- submission ---------------- */

  /**
   * Pick the send back up once a session exists.
   *
   * Only when they were mid-send AND the accuracy box is still ticked
   * for this same unchanged list — which it must have been to reach the
   * intercept at all. That tick is a real confirmation about data that
   * has not moved since, so asking for it twice is friction with no
   * safety in it. Anything else just leaves the form as it is and waits
   * for a press: sending a booklist to shops puts a request in front of
   * businesses who have to answer it, and that is not something to do
   * on someone's behalf because they happened to log in.
   *
   * This works only because the sign-in sheet no longer navigates. The
   * modal, the photo and every typed line are still here.
   */
  useEffect(() => {
    if (!userId || pendingSubmit.current === null) return;
    const publish = pendingSubmit.current;
    pendingSubmit.current = null;
    // This modal is sending it (or leaving it on screen for a press), so
    // the stored copy must not be sent a second time by the resumer.
    void clearPendingBooklist();
    dropHold();
    if (!confirmed || phase !== 'review') return;
    void handleSave(publish);
    // handleSave is redeclared every render and depends on all of the
    // form state; keying this effect on it would re-run on every
    // keystroke. The session arriving is the only trigger that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /**
   * Saves the reviewed list.
   *
   * `publish` decides the status in the SAME insert rather than an
   * insert-then-update: a second call that fails would leave the buyer
   * looking at a success message for a list no vendor can see.
   */
  /**
   * What the buttons call. Always does something.
   *
   * The bug this replaces: both buttons carried `disabled={!canSubmit}`,
   * and canSubmit requires the accuracy tick. So the ordinary first
   * press — list typed, box not yet ticked, because the box sits below
   * the fold — landed on a genuinely disabled button. No press event, no
   * message, no movement. "Sign in to Send does nothing" was literally
   * true, and nothing on screen said why.
   *
   * Now the press is always received, and a press that cannot go through
   * has to explain itself: it names the one thing in the way, marks the
   * offending rows, and scrolls the reason into view. A disabled control
   * that will not say what it wants is worse than no control.
   */
  function attemptSave(publish: boolean) {
    if (busy) return;

    if (blocker) {
      setShowProblems(true);
      setError(blocker.message);
      // The confirm block is the last thing on a long scroller, so the
      // buyer pressing the button often cannot see it at all. Anything
      // above it is already on screen next to its own red field, and
      // yanking the page away from where they are looking would be
      // worse than leaving them there with the message.
      if (blocker.scrollToConfirm) {
        scrollRef.current?.scrollTo({ y: Math.max(0, confirmY.current - 12), animated: true });
      }
      return;
    }

    // Checked before the sign-in ask, so a guest fixes everything first
    // and the send can go straight through once they are signed in.
    if (publish) {
      const issue = deliveryProblem(delivery);
      if (issue) {
        setDeliveryIssue(issue);
        setError(issue);
        return;
      }
    }

    void handleSave(publish);
  }

  /** Held while an intercepted guest send is waiting on this modal. */
  const releaseHold = useRef<(() => void) | null>(null);
  const dropHold = useCallback(() => {
    releaseHold.current?.();
    releaseHold.current = null;
  }, []);
  useEffect(() => dropHold, [dropHold]);

  /**
   * Closing the card abandons the send, so the copy kept for "sign in and
   * come back" goes too — nobody should find a booklist sent the next
   * time they happen to log in after deciding against it.
   */
  const closeCard = useCallback(() => {
    if (releaseHold.current || pendingSubmit.current !== null) {
      pendingSubmit.current = null;
      dropHold();
      void clearPendingBooklist();
    }
    onClose();
  }, [dropHold, onClose]);

  async function handleSave(publish: boolean) {
    if (phase !== 'review') return;

    // The intercept. Everything they typed stays on screen behind the
    // sheet — this modal is not unmounted by it — so signing in and
    // coming back costs them nothing they have already done.
    if (!userId) {
      pendingSubmit.current = publish;
      // This modal will send it the moment they sign in in the sheet...
      if (!releaseHold.current) releaseHold.current = holdPendingBooklist();
      // ...and this copy survives if signing up takes them away from the
      // page (email confirmation) — PendingBooklistResumer sends it then.
      // Saved before the sheet opens, so there is no window where they
      // are signing up and nothing has been kept.
      const photo = await photoForStorage(image);
      await savePendingBooklist({
        school,
        classLevel,
        lines: selected.map((item) => ({
          title: item.title,
          author: item.author,
          category: item.title.trim() ? guessCategory(item.title) : item.category,
          quantity: item.quantity,
          parsed: item.id.startsWith('parsed-'),
        })),
        delivery,
        publish,
        confirmed,
        photo,
      });
      onRequireAuth?.();
      return;
    }

    // Re-checked here, not just on the button: the button is one way in,
    // and a line can be edited back into an invalid state between a
    // render and a press.
    if (!photoOnly && !verdict.ok) {
      setShowProblems(true);
      setError(verdict.message);
      return;
    }
    // Checked here as well as on the button: the button is one way in,
    // and the tick can be cleared between a render and a press.
    if (!confirmed) {
      setShowProblems(true);
      setError('Confirm the titles, authors and publishers before sending this list.');
      return;
    }
    if (!canSubmit) return;
    // Sending needs somewhere to send to: it is what shops price delivery
    // against. A draft can wait for it.
    if (publish) {
      const issue = deliveryProblem(delivery);
      if (issue) {
        setDeliveryIssue(issue);
        setError(issue);
        return;
      }
    }
    setDeliveryIssue(null);
    setShowProblems(false);
    setPhase('submitting');
    setPending(publish ? 'publish' : 'draft');
    setError(null);

    try {
      // A guest's photo waits on the device until they are signed in —
      // the storage policy needs their user id in the path. Upload it now,
      // so the booklist goes out with the picture they attached.
      let photoPath = imagePath;
      if (!photoPath && image) {
        setStep('Uploading your photo…');
        try {
          photoPath = await withTimeout(
            uploadBooklistImage(userId, draftImageKey(), image),
            IMAGE_PROCESSING_TIMEOUT_MS,
            'Photo upload'
          );
          setImagePath(photoPath);
        } catch (e) {
          // Only fatal when the photo IS the list.
          if (selected.length === 0) {
            throw new Error(
              `Your photo could not be uploaded (${(e as Error).message}). Try again, or type the books in.`
            );
          }
          console.warn('[booklist] photo not uploaded; sending the typed lines only:', e);
        }
      }

      const { itemCount, deliveryNote } = await submitBooklist({
        userId,
        school,
        classLevel,
        childId: child?.id ?? null,
        imagePath: photoPath,
        // Only the checked lines. An unchecked line means "I already own
        // this", and sending it anyway is how a buyer ends up paying for a
        // second copy of a book that is on their shelf.
        lines: selected.map((item) => ({
          title: item.title,
          author: item.author,
          category: item.title.trim() ? guessCategory(item.title) : item.category,
          quantity: item.quantity,
          // True only for lines the parser produced — it flags rows a
          // vendor should read with suspicion.
          parsed: item.id.startsWith('parsed-'),
        })),
        publish,
        delivery,
      });
      const rows = { length: itemCount };

      const count = `${selected.length} item${selected.length === 1 ? '' : 's'}`;
      const what = rows.length ? count : 'the photo only';
      await onSubmitted(
        (publish
          ? `Booklist sent for quotes — ${what} for ${school.trim()}.${
              rows.length ? '' : ' Shops will quote from the picture.'
            }`
          : `Draft saved — ${what} for ${school.trim()}. Publish it when you're ready for quotes.`) +
          deliveryNote
      );
      reset();
      onClose();
    } catch (e) {
      setError(describeBooklistError(e));
      setPhase('review');
      setPending(null);
    }
  }

  /* ---------------- render ---------------- */

  const busy = phase === 'working' || phase === 'submitting';

  return (
    <Modal
      // `visible && !suppressed`, never `visible` alone — see the
      // `suppressed` prop. The component stays mounted either way, so
      // every piece of state behind this card survives the sheet.
      visible={visible && !suppressed}
      transparent
      animationType="fade"
      onRequestClose={busy ? undefined : closeCard}
    >
      <Pressable
        style={styles.scrim}
        onPress={busy ? undefined : onClose}
        accessibilityLabel="Close"
      />
      <View style={styles.centre} pointerEvents="box-none">
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Check Your Booklist</Text>
              <Text style={styles.subtitle}>
                Fix anything we read wrong, and untick books you already own.
              </Text>
            </View>
            <Pressable
              onPress={closeCard}
              disabled={phase === 'submitting'}
              hitSlop={8}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

          {phase === 'working' ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.navy} />
              <Text style={styles.loadingText}>{step}</Text>
            </View>
          ) : (
            <ScrollView
              ref={scrollRef}
              style={styles.body}
              keyboardShouldPersistTaps="handled"
            >
              {/* ---- header info ---- */}
              <ChildPicker
                value={child?.id ?? null}
                onChange={(next) => {
                  // Fill school and class from the child only where the
                  // field is empty or still holds the previous child's
                  // value — never over what the photo or the buyer said.
                  const prev = child;
                  if (next?.school_name && (!school.trim() || school === (prev?.school_name ?? ''))) {
                    setSchool(next.school_name);
                  }
                  if (next?.class_level && (!classLevel.trim() || classLevel === (prev?.class_level ?? ''))) {
                    setClassLevel(next.class_level);
                  }
                  setChild(next);
                }}
              />
              <Text style={styles.label}>School</Text>
              <TextInput
                value={school}
                onChangeText={setSchool}
                placeholder="St. Columbanus Secondary School"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                autoCapitalize="words"
                accessibilityLabel="School name"
                accessibilityHint="Required. The school this booklist is for."
              />

              <Text style={styles.label}>Class or grade</Text>
              <TextInput
                value={classLevel}
                onChangeText={setClassLevel}
                placeholder="JSS 1"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                accessibilityLabel="Class or grade level"
                accessibilityHint="Optional. Helps shops quote the right editions."
              />

              {/* ---- original photo, for cross-checking ---- */}
              {image && (
                <>
                  <Pressable
                    onPress={() => setShowPhoto((v) => !v)}
                    style={({ pressed }) => [styles.photoToggle, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: showPhoto }}
                    accessibilityLabel={showPhoto ? 'Hide the original photo' : 'Show the original photo'}
                  >
                    <Ionicons name="image-outline" size={17} color={colors.navy} />
                    <Text style={styles.photoToggleText}>
                      {showPhoto ? 'Hide original photo' : 'Show original photo'}
                    </Text>
                    <Ionicons
                      name={showPhoto ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.textMuted}
                    />
                  </Pressable>

                  {showPhoto && (
                    // The local uri, not a signed URL: the file is already
                    // on the device, so it renders instantly and still
                    // works if the upload failed.
                    <Image
                      // Keyed by the uri so a second booklist remounts
                      // the view rather than reusing the first one's
                      // decoded bitmap. Belt and braces against showing
                      // the previous photo.
                      key={image.uri}
                      source={{ uri: image.uri }}
                      style={styles.photo}
                      resizeMode="contain"
                      accessibilityLabel="The booklist photo you uploaded"
                    />
                  )}
                </>
              )}

              {notice && (
                <View style={styles.notice}>
                  <Ionicons
                    name={timedOut ? 'time-outline' : 'information-circle'}
                    size={15}
                    color={colors.warning}
                  />
                  <View style={styles.noticeBody}>
                    <Text style={styles.noticeText}>{notice}</Text>
                    {/* Offered only for a timeout, and only to someone
                        who can actually retry. A slow connection is the
                        one failure here that is worth another go — the
                        photo is still in memory, so retrying costs a
                        press rather than another trip to the camera. */}
                    {timedOut && Boolean(userId) && (
                      <Pressable
                        onPress={() => {
                          setTimedOut(false);
                          setAttempt((n) => n + 1);
                          setPhase('working');
                        }}
                        style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel="Try uploading the photo again"
                      >
                        <Ionicons name="refresh" size={14} color={colors.navy} />
                        <Text style={styles.retryText}>Try again</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              )}

              {/* ---- the list ---- */}
              <View style={styles.itemsHead}>
                <Text style={styles.label}>Books and items</Text>
                <Text style={styles.selectedCount}>
                  {selected.length} of {items.length} selected
                </Text>
              </View>

              {/* Said once, above the list, rather than under every row:
                  a hint repeated twelve times is wallpaper. */}
              <Text style={styles.itemsHint}>
                Give the author or publisher for each book — it is what tells a shop which
                edition to quote.
              </Text>

              {items.map((item) => {
                const needsAuthor = item.selected && authorRequiredFor(item);
                const authorMissing = showProblems && blocked.has(item.id);
                const titleMissing =
                  showProblems && item.selected && lineProblem(item) === 'title';

                return (
                <View key={item.id} style={[styles.row, !item.selected && styles.rowOff]}>
                  <Pressable
                    onPress={() => patchItem(item.id, { selected: !item.selected })}
                    hitSlop={8}
                    style={styles.check}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.selected }}
                    accessibilityLabel={item.title || 'Untitled item'}
                    accessibilityHint="Untick if you already own this one"
                  >
                    <Ionicons
                      name={item.selected ? 'checkbox' : 'square-outline'}
                      size={21}
                      color={item.selected ? colors.navy : colors.borderStrong}
                    />
                  </Pressable>

                  <View style={styles.rowFields}>
                    <TextInput
                      value={item.title}
                      onChangeText={(title) => patchItem(item.id, { title })}
                      placeholder="Book or item title"
                      placeholderTextColor={colors.textFaint}
                      style={[
                        styles.rowInput,
                        styles.rowTitle,
                        titleMissing && styles.rowInputInvalid,
                      ]}
                      multiline
                      accessibilityLabel="Title"
                    />
                    <TextInput
                      value={item.author}
                      onChangeText={(author) => patchItem(item.id, { author })}
                      placeholder={AUTHOR_PLACEHOLDER}
                      placeholderTextColor={authorMissing ? colors.danger : colors.textFaint}
                      style={[
                        styles.rowInput,
                        styles.rowAuthor,
                        authorMissing && styles.rowInputInvalid,
                      ]}
                      accessibilityLabel={
                        needsAuthor ? 'Author or publisher, required' : 'Author or publisher'
                      }
                      accessibilityHint={
                        needsAuthor
                          ? 'Shops need this to quote the right edition'
                          : undefined
                      }
                    />
                    {authorMissing && (
                      <Text style={styles.rowError}>{AUTHOR_REQUIRED_MESSAGE}</Text>
                    )}
                    {titleMissing && (
                      <Text style={styles.rowError}>Give this line a title, or remove it.</Text>
                    )}

                    {/* Under the fields rather than beside them: on a
                        phone a stepper in the same row as the title
                        squeezes the title to a few characters. */}
                    <View style={styles.rowMeta}>
                      <QuantityStepper
                        value={item.quantity}
                        onChange={(quantity) => patchItem(item.id, { quantity })}
                        label={item.title || 'this item'}
                        disabled={!item.selected}
                      />
                    </View>
                  </View>

                  <Pressable
                    onPress={() => removeItem(item.id)}
                    hitSlop={8}
                    style={styles.delete}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.title || 'this line'}`}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                </View>
                );
              })}

              <Pressable
                onPress={addItem}
                style={({ pressed }) => [styles.add, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Add an item"
              >
                <Ionicons name="add" size={18} color={colors.navy} />
                <Text style={styles.addText}>Add item</Text>
              </Pressable>

              {error && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={15} color={colors.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {/* ---- where the books go ---- */}
              <DeliveryAddressSection
                key={deliveryKey}
                value={delivery}
                onChange={(next) => {
                  setDelivery(next);
                  if (deliveryIssue) setDeliveryIssue(null);
                }}
                disabled={busy}
                problem={deliveryIssue}
              />

              {/* ---- review & confirm, immediately above the buttons ---- */}
              <View
                style={styles.confirmBlock}
                onLayout={(e) => {
                  confirmY.current = e.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.confirmHeading}>Review &amp; Confirm</Text>
                <BooklistSummary
                  itemCount={selected.length}
                  copyCount={selected.reduce((n, i) => n + (Number(i.quantity) || 1), 0)}
                  school={school}
                  classLevel={classLevel}
                  hasPhoto={Boolean(imagePath)}
                />
                <ConfirmAccuracyCheckbox
                  checked={confirmed}
                  onChange={setConfirmed}
                  disabled={busy}
                  invalid={showProblems}
                />
              </View>

              <View style={{ height: spacing.md }} />
            </ScrollView>
          )}

          {/* Two ways out, because a booklist is rarely finished in one
              sitting: keep it private and keep editing, or send it now.
              Same pair as EditBooklistModal, so the two screens behave
              alike. */}
          <View style={[styles.actions, isMobile && styles.actionsMobile]}>
            {/* Hidden for a guest. "Save as Draft" promises a row in
                book_requests kept for later, and there is nowhere to
                keep it without an account — offering it would be a
                button that silently means something else. */}
            {Boolean(userId) && (
            <Pressable
              onPress={() => attemptSave(false)}
              // Disabled only while something is actually in flight.
              // Muted-but-pressable otherwise, so a press that cannot go
              // through says why instead of being swallowed.
              disabled={busy}
              style={({ pressed }) => [
                styles.btn,
                styles.btnGhost,
                !canSubmit && styles.btnGhostDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              accessibilityLabel="Save as a draft"
              accessibilityHint={
                blocker ? blocker.message : 'Keeps the list private so you can finish it later.'
              }
            >
              {pending === 'draft' ? (
                <View style={styles.busy}>
                  <ActivityIndicator size="small" color={colors.textMuted} />
                  <Text style={styles.btnGhostText}>Saving…</Text>
                </View>
              ) : (
                <Text style={styles.btnGhostText} numberOfLines={1}>
                  Save as Draft
                </Text>
              )}
            </Pressable>
            )}
            <Pressable
              onPress={() => attemptSave(true)}
              // The one that was reported as dead. It carried
              // disabled={!canSubmit}, and canSubmit needs the accuracy
              // tick — a box that sits below the fold on a long list. So
              // the first press of a finished booklist hit a disabled
              // control and produced nothing at all. It is pressable now
              // whatever the state; attemptSave decides what happens.
              disabled={busy}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                !canSubmit && styles.btnMuted,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              accessibilityLabel={
                userId
                  ? 'Send this booklist to vendors for quotes'
                  : 'Sign in to send this booklist to vendors'
              }
              accessibilityHint={blocker?.message}
            >
              {pending === 'publish' ? (
                <View style={styles.busy}>
                  <ActivityIndicator size="small" color={colors.onNavy} />
                  <Text style={styles.btnPrimaryText}>Sending…</Text>
                </View>
              ) : (
                <Text style={styles.btnPrimaryText} numberOfLines={1}>
                  {!userId
                    ? 'Sign in to Send'
                    : photoOnly
                    ? 'Send Photo to Vendors'
                    : `Send to Vendors (${selected.length})`}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    ...shadow.raised,
  },
  cardMobile: { maxWidth: '100%' },

  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: 2, lineHeight: 17 },

  loading: { padding: spacing.xxl, alignItems: 'center', gap: spacing.md },
  loadingText: { fontSize: font.md, color: colors.textMuted },

  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted, marginBottom: 5 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: font.md,
    color: colors.text,
    marginBottom: spacing.md,
  },

  photoToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.md,
    minHeight: 44,
  },
  photoToggleText: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.navy },
  photo: {
    width: '100%',
    height: 320,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.md,
  },

  itemsHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  selectedCount: { fontSize: font.sm, color: colors.textFaint, fontWeight: '600' },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  // Dimmed, not hidden: the buyer can see what they excluded and change
  // their mind without re-typing it.
  rowOff: { opacity: 0.45, backgroundColor: colors.surfaceMuted },
  check: { paddingTop: 8 },
  rowFields: { flex: 1 },
  rowInput: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    color: colors.text,
    borderRadius: radius.sm,
  },
  rowTitle: { fontSize: font.md, fontWeight: '600', minHeight: 34 },
  rowInputInvalid: { borderColor: colors.danger, backgroundColor: '#FDECEA' },
  rowError: { fontSize: font.xs, color: colors.danger, marginTop: 3, lineHeight: 15 },
  itemsHint: {
    fontSize: font.xs,
    color: colors.textMuted,
    lineHeight: 16,
    marginBottom: spacing.sm,
  },
  rowAuthor: { fontSize: font.sm, color: colors.textMuted },
  rowMeta: { paddingHorizontal: spacing.sm, paddingTop: 6 },
  delete: { paddingTop: 8, paddingHorizontal: 2 },

  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: 12,
    marginTop: spacing.xs,
    minHeight: 44,
  },
  addText: { fontSize: font.md, fontWeight: '700', color: colors.navy },

  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeBody: { flex: 1, gap: 6 },
  noticeText: { fontSize: font.sm, color: colors.warning, lineHeight: 18 },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 36,
  },
  retryText: { fontSize: font.sm, fontWeight: '700', color: colors.navy },
  errorBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: '#FCEAE8',
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger, lineHeight: 18 },

  confirmBlock: { gap: spacing.sm, marginTop: spacing.md },
  confirmHeading: { fontSize: font.sm, fontWeight: '800', color: colors.text },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  btn: {
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  actionsMobile: { flexDirection: 'column-reverse' },
  btnGhost: { flex: 1, borderWidth: 1, borderColor: colors.border, minWidth: 96 },
  btnGhostDisabled: { opacity: 0.5 },
  btnGhostText: { color: colors.textMuted, fontWeight: '700', fontSize: font.md },
  btnPrimary: { flex: 1, backgroundColor: colors.orange },
  btnPrimaryText: { color: colors.onNavy, fontWeight: '700', fontSize: font.md },
  btnDisabled: { backgroundColor: colors.borderStrong },
  /**
   * Not-yet, rather than dead.
   *
   * The old disabled style was a flat grey — the universal sign for "do
   * not bother pressing this", on a button that was in fact the way
   * forward. Keeping the brand colour at reduced opacity says the action
   * is real and something is outstanding, which is exactly true.
   */
  btnMuted: { opacity: 0.55 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pressed: { opacity: 0.85 },
});
