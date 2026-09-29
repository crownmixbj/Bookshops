import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../utils/supabase';
import { emailRedirectTo } from '../../lib/authRedirect';
import { loadPendingBooklist } from '../../lib/pendingBooklist';
import {
  describeAuthError,
  hasErrors,
  validateEmail,
  validateFullName,
  validatePassword,
  type FieldErrors,
} from '../../lib/validation';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { useLayout } from '../../hooks/useLayout';

type Mode = 'choose' | 'login' | 'signup';
type Field = 'fullName' | 'email' | 'password';

interface Props {
  visible: boolean;
  /**
   * What the guest was trying to do, in their own terms. Shown under the
   * heading so the prompt explains itself rather than appearing as a
   * generic wall — "log in to continue" tells someone nothing about why
   * they were stopped.
   */
  reason?: string;
  onClose: () => void;
  /**
   * Fired once a session actually exists, before the sheet closes.
   *
   * The caller uses this to resume whatever it was doing. It is NOT
   * fired when a sign-up needs email confirmation, because there is no
   * session yet and nothing can be resumed.
   */
  onAuthenticated?: () => void;
}

/**
 * The one thing that asks a guest to sign in.
 *
 * It authenticates IN PLACE. It used to offer two buttons that pushed
 * /auth/login and /auth/signup, and that navigation was quietly
 * destructive: the screen underneath unmounted, and with it anything it
 * was holding in memory. For a guest who had photographed a booklist
 * that meant the photo — a blob: URL on web, a file:// path on native,
 * neither of which survives its owner being torn down. They came back
 * signed in, to an empty form, and had to go and find the paper list
 * again.
 *
 * So everything happens inside this sheet: the screen behind it stays
 * mounted, its state stays exactly as it was, and the caller resumes
 * through onAuthenticated. The full /auth screens still exist and are
 * still where a cold start or a deep link lands — this is the in-flow
 * version, for someone who is already in the middle of something.
 */
export function SignInPrompt({ visible, reason, onClose, onAuthenticated }: Props) {
  const { isMobile } = useLayout();

  const [mode, setMode] = useState<Mode>('choose');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<Field>>({});
  /** Sign-up succeeded but the project requires email confirmation. */
  const [confirmSent, setConfirmSent] = useState(false);
  /**
   * What is waiting on the device for after confirmation, if anything:
   * a booklist the guest pressed "Sign in to Send" on is sent
   * automatically once they come back signed in (PendingBooklistResumer).
   */
  const [waiting, setWaiting] = useState<{ school: string; photo: boolean } | null>(null);
  useEffect(() => {
    if (!confirmSent) return;
    let alive = true;
    loadPendingBooklist().then((p) => {
      if (alive) setWaiting(p ? { school: p.school, photo: !!p.photo } : null);
    });
    return () => {
      alive = false;
    };
  }, [confirmSent]);

  // Cleared on close, not on open: a sheet that is closing should not
  // visibly reset its fields on the way out, and a password must never
  // outlive the prompt it was typed into.
  useEffect(() => {
    if (visible) return;
    setMode('choose');
    setFullName('');
    setEmail('');
    setPassword('');
    setShowPassword(false);
    setLoading(false);
    setFormError(null);
    setFieldErrors({});
    setConfirmSent(false);
  }, [visible]);

  function go(next: Mode) {
    setMode(next);
    setFormError(null);
    setFieldErrors({});
  }

  async function submit() {
    if (loading) return;

    // Validated on submit rather than per keystroke: telling someone
    // their email is invalid while they are halfway through typing it
    // is noise, not help. Same rule as the full auth screens.
    const errors: FieldErrors<Field> =
      mode === 'signup'
        ? {
            fullName: validateFullName(fullName),
            email: validateEmail(email),
            password: validatePassword(password, { requireStrong: true }),
          }
        : { email: validateEmail(email), password: validatePassword(password) };

    setFieldErrors(errors);
    if (hasErrors(errors)) {
      setFormError(null);
      return;
    }

    setLoading(true);
    setFormError(null);

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            // Always 'buyer' here. This sheet is only ever raised from a
            // buying action — sending a booklist, checking out — and a
            // vendor account is not something to create as a side effect
            // of one. Vendors sign up on the full screen, where the role
            // is a deliberate choice.
            data: { role: 'buyer', full_name: fullName.trim() },
            emailRedirectTo: emailRedirectTo(),
          },
        });
        if (error) throw error;

        if (!data.session) {
          // Confirmation is on, so there is no session and nothing can
          // be resumed. Say so here rather than closing the sheet on a
          // sign-in that has not happened.
          setConfirmSent(true);
          setLoading(false);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }

      // Order matters. The caller resumes while this sheet is still up,
      // so the screen behind it never renders a frame in the odd state
      // of "signed in, sheet gone, nothing happening yet".
      onAuthenticated?.();
      onClose();
    } catch (e) {
      setFormError(describeAuthError((e as Error).message ?? String(e)));
      setLoading(false);
    }
  }

  const heading = confirmSent
    ? 'Check your email'
    : mode === 'signup'
    ? 'Create your account'
    : mode === 'login'
    ? 'Welcome back'
    : 'Log in to continue';

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isMobile ? 'slide' : 'fade'}
      onRequestClose={loading ? undefined : onClose}
    >
      <Pressable
        style={styles.scrim}
        onPress={loading ? undefined : onClose}
        accessibilityLabel="Close"
      />
      <View
        style={[styles.wrap, isMobile ? styles.wrapMobile : styles.wrapCentre]}
        pointerEvents="box-none"
      >
        <View style={[styles.card, isMobile && styles.cardMobile]}>
          {isMobile && <View style={styles.grabber} />}

          <View style={styles.icon}>
            <Ionicons
              name={confirmSent ? 'mail-outline' : 'person-circle-outline'}
              size={26}
              color={colors.navy}
            />
          </View>

          <Text style={styles.title}>{heading}</Text>

          {confirmSent ? (
            <>
              <Text style={styles.body}>
                We sent a confirmation link to {email.trim()}. Open it to finish creating your
                account, then come back and send your booklist.
              </Text>
              {/* The honest part. Confirmation means leaving the app, and
                  a photo held in memory does not survive that — better
                  said now than discovered on the way back. */}
              <Text style={styles.warn}>
                {waiting
                  ? `Your booklist for ${waiting.school || 'your school'} is saved on this device${
                      waiting.photo ? ', photo included' : ''
                    }. Once you confirm and sign in, it is sent to shops automatically.${
                      waiting.photo ? '' : ' A photo you attached could not be kept — add it again afterwards.'
                    }`
                  : 'Your typed books are saved on this device. A photo you attached is not — you can add it again after confirming.'}
              </Text>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>Done</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.body}>
                {mode === 'choose'
                  ? reason ?? 'Log in or create an account to send your booklist to vendors.'
                  : 'Your booklist stays exactly as you left it.'}
              </Text>

              {mode === 'choose' ? (
                <>
                  <Pressable
                    onPress={() => go('login')}
                    style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.primaryText}>Log in</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => go('signup')}
                    style={({ pressed }) => [styles.secondary, pressed && styles.pressedSoft]}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryText}>Create an account</Text>
                  </Pressable>
                </>
              ) : (
                <ScrollView
                  style={styles.form}
                  contentContainerStyle={styles.formInner}
                  keyboardShouldPersistTaps="handled"
                >
                  {mode === 'signup' && (
                    <Field
                      label="Full name"
                      value={fullName}
                      onChangeText={setFullName}
                      placeholder="Bolaji Adedapo"
                      autoCapitalize="words"
                      textContentType="name"
                      error={fieldErrors.fullName}
                      editable={!loading}
                    />
                  )}

                  <Field
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    error={fieldErrors.email}
                    editable={!loading}
                  />

                  <Field
                    label="Password"
                    value={password}
                    onChangeText={setPassword}
                    placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                    autoCapitalize="none"
                    secureTextEntry={!showPassword}
                    textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                    error={fieldErrors.password}
                    editable={!loading}
                    // Enter submits, on a phone keyboard and in a browser
                    // alike — the same behaviour as the full auth screens.
                    onSubmitEditing={submit}
                    returnKeyType="go"
                    trailing={
                      <Pressable
                        onPress={() => setShowPassword((v) => !v)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                      >
                        <Ionicons
                          name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                          size={18}
                          color={colors.textMuted}
                        />
                      </Pressable>
                    }
                  />

                  {!!formError && (
                    <View style={styles.errorBox}>
                      <Ionicons name="alert-circle" size={15} color={colors.danger} />
                      <Text style={styles.errorText}>{formError}</Text>
                    </View>
                  )}

                  <Pressable
                    onPress={submit}
                    disabled={loading}
                    style={({ pressed }) => [
                      styles.primary,
                      loading && styles.primaryDisabled,
                      pressed && !loading && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={mode === 'signup' ? 'Create account' : 'Log in'}
                  >
                    {loading ? (
                      <View style={styles.busy}>
                        <ActivityIndicator size="small" color={colors.onNavy} />
                        <Text style={styles.primaryText}>
                          {mode === 'signup' ? 'Creating…' : 'Signing in…'}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.primaryText}>
                        {mode === 'signup' ? 'Create account' : 'Log in'}
                      </Text>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={() => go(mode === 'signup' ? 'login' : 'signup')}
                    disabled={loading}
                    style={styles.switch}
                    accessibilityRole="button"
                  >
                    <Text style={styles.switchText}>
                      {mode === 'signup'
                        ? 'Already have an account? Log in'
                        : "New here? Create an account"}
                    </Text>
                  </Pressable>
                </ScrollView>
              )}

              {/* Named for what it does. "Cancel" reads as abandoning the
                  thing they came to do; they are going back to browsing. */}
              <Pressable
                onPress={onClose}
                disabled={loading}
                style={({ pressed }) => [styles.ghost, pressed && styles.pressedSoft]}
                accessibilityRole="button"
              >
                <Text style={styles.ghostText}>Keep browsing</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  error?: string;
  editable?: boolean;
  trailing?: React.ReactNode;
  autoCapitalize?: 'none' | 'words';
  keyboardType?: 'email-address';
  secureTextEntry?: boolean;
  textContentType?: 'name' | 'emailAddress' | 'password' | 'newPassword';
  onSubmitEditing?: () => void;
  returnKeyType?: 'go';
}

function Field({ label, error, trailing, ...input }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, !!error && styles.inputWrapInvalid]}>
        <TextInput
          {...input}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          accessibilityLabel={label}
        />
        {trailing}
      </View>
      {!!error && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  wrap: { flex: 1 },
  wrapMobile: { justifyContent: 'flex-end' },
  wrapCentre: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg },

  card: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
    ...shadow.raised,
  },
  cardMobile: {
    maxWidth: '100%',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: spacing.xxl,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },

  icon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  title: { fontSize: font.lg, fontWeight: '800', color: colors.text, textAlign: 'center' },
  body: {
    fontSize: font.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  warn: {
    fontSize: font.xs,
    color: colors.warning,
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: spacing.sm,
  },

  form: { width: '100%' },
  formInner: { gap: spacing.sm, paddingBottom: 2 },
  field: { width: '100%' },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted, marginBottom: 5 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    minHeight: 46,
  },
  inputWrapInvalid: { borderColor: colors.danger, backgroundColor: '#FDECEA' },
  input: { flex: 1, paddingVertical: 11, fontSize: font.md, color: colors.text },
  fieldError: { fontSize: font.xs, color: colors.danger, marginTop: 3, lineHeight: 15 },

  errorBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: '#FCEAE8',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorText: { flex: 1, fontSize: font.sm, color: colors.danger, lineHeight: 18 },

  primary: {
    width: '100%',
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    paddingVertical: 13,
    alignItems: 'center',
    minHeight: 46,
    justifyContent: 'center',
  },
  primaryDisabled: { opacity: 0.7 },
  primaryText: { color: colors.onNavy, fontWeight: '800', fontSize: font.md },
  secondary: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  secondaryText: { color: colors.navy, fontWeight: '700', fontSize: font.md },
  switch: { alignItems: 'center', paddingVertical: 10, minHeight: 40, justifyContent: 'center' },
  switchText: { color: colors.navy, fontWeight: '700', fontSize: font.sm },
  ghost: { paddingVertical: 10, minHeight: 40, justifyContent: 'center' },
  ghostText: { color: colors.textMuted, fontWeight: '700', fontSize: font.sm },
  busy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pressed: { backgroundColor: colors.orangeDark },
  pressedSoft: { opacity: 0.7 },
});
