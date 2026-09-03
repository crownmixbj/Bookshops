import { useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../utils/supabase';
import { AuthShell, AuthButton, FormField, Notice } from '../../components/auth';
import { authCallback } from '../../lib/authCallback';
import {
  describeAuthCallback,
  describeAuthError,
  hasErrors,
  validateEmail,
  validatePassword,
  type FieldErrors,
} from '../../lib/validation';
import { colors, spacing, font } from '../../theme';

type Field = 'email' | 'password';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<Field>>({});

  /**
   * The outcome of an emailed confirmation or reset link, read from a
   * snapshot taken at module load — supabase-js strips these parameters
   * from the URL as soon as it starts, so reading window.location here
   * would find nothing.
   *
   * Lazy initialiser, so it is computed once rather than on every
   * render. Dismissable, because it describes a past event.
   *
   * When the link carried a working session this is null: app/_layout.js
   * is already sending the person to their own dashboard — /vendor for a
   * vendor, /admin for an admin, the buyer hub otherwise — so there is
   * no message to show and nothing to redirect by hand.
   */
  const [callback, setCallback] = useState(() => describeAuthCallback(authCallback));

  const passwordRef = useRef<TextInput>(null);

  /** Clears one field's error as it is corrected, so the red does not
   *  linger while the user is visibly fixing the problem. */
  function edit(field: Field, value: string) {
    if (field === 'email') setEmail(value);
    else setPassword(value);
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    if (formError) setFormError(null);
  }

  async function handleLogin() {
    // Validate on submit, not on every keystroke: telling someone their
    // email is invalid while they are still halfway through typing it is
    // just noise.
    const errors: FieldErrors<Field> = {
      email: validateEmail(email),
      password: validatePassword(password),
    };
    setFieldErrors(errors);
    if (hasErrors(errors)) {
      setFormError(null);
      return;
    }

    setLoading(true);
    setFormError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setFormError(describeAuthError(error.message));
      setLoading(false);
      return;
    }

    // No navigation here on purpose. app/_layout.js owns where a
    // signed-in person lands, because it has to work for every route in
    // — a cold start with a stored session, a deep link — not just this
    // form. It reads the profile role and sends vendors to /vendor,
    // admins to /admin and everyone else to the buyer hub.
    //
    // `loading` stays true: the layout swaps this screen out, and
    // clearing it would flash an enabled button on the way.
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to send booklists, compare quotes and track your orders."
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Don't have an account?</Text>
          <Pressable
            onPress={() => router.push('/auth/signup')}
            disabled={loading}
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="Create an account"
          >
            {({ pressed }) => (
              <Text style={[styles.footerLink, pressed && styles.footerLinkPressed]}>Sign up</Text>
            )}
          </Pressable>
        </View>
      }
    >
      {!!callback && !formError && (
        <Notice
          tone={callback.tone}
          message={callback.message}
          detail={callback.detail}
          onDismiss={() => setCallback(null)}
        />
      )}

      {!!formError && <Notice tone="error" message={formError} />}

      <FormField
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={(v) => edit('email', v)}
        error={fieldErrors.email}
        editable={!loading}
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="email"
        keyboardType="email-address"
        // Lets password managers fill both fields as a pair.
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
      />

      <FormField
        ref={passwordRef}
        label="Password"
        placeholder="Your password"
        value={password}
        onChangeText={(v) => edit('password', v)}
        error={fieldErrors.password}
        editable={!loading}
        isPassword
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        // Enter submits, on a phone keyboard and in a browser alike.
        onSubmitEditing={handleLogin}
      />

      <AuthButton
        label="Sign in"
        loadingLabel="Signing you in…"
        onPress={handleLogin}
        loading={loading}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  footerText: { fontSize: font.md, color: colors.textMuted },
  footerLink: { fontSize: font.md, fontWeight: '700', color: colors.navy },
  footerLinkPressed: { color: colors.orangeDark },
});
