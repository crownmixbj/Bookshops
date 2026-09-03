import { useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../utils/supabase';
import { emailRedirectTo } from '../../lib/authRedirect';
import {
  AuthShell,
  AuthButton,
  FormField,
  Notice,
  RoleChoice,
  type SignupRole,
} from '../../components/auth';
import {
  MIN_PASSWORD_LENGTH,
  describeAuthError,
  hasErrors,
  validateEmail,
  validateFullName,
  validatePassword,
  type FieldErrors,
} from '../../lib/validation';
import { colors, spacing, font } from '../../theme';

type Field = 'fullName' | 'email' | 'password';

export default function SignupScreen() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<SignupRole>('buyer');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<Field>>({});
  /** Set when the account exists but the email still needs confirming. */
  const [confirmSent, setConfirmSent] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const setters: Record<Field, (v: string) => void> = {
    fullName: setFullName,
    email: setEmail,
    password: setPassword,
  };

  function edit(field: Field, value: string) {
    setters[field](value);
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    if (formError) setFormError(null);
  }

  async function handleSignUp() {
    const errors: FieldErrors<Field> = {
      fullName: validateFullName(fullName),
      email: validateEmail(email),
      password: validatePassword(password, { requireStrong: true }),
    };
    setFieldErrors(errors);
    if (hasErrors(errors)) {
      setFormError(null);
      return;
    }

    setLoading(true);
    setFormError(null);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // handle_new_user reads both of these. It honours `role` only for
        // 'buyer' / 'vendor' — this object is client-supplied, so 'admin'
        // is ignored on purpose.
        data: { role, full_name: fullName.trim() },
        // Without this, the confirmation email points at the project's
        // Site URL rather than wherever this build is running.
        emailRedirectTo: emailRedirectTo(),
      },
    });

    if (error) {
      // This used to be Alert.alert, which does nothing at all in
      // react-native-web: on the deployed site every sign-up error was
      // swallowed and the form simply sat there.
      setFormError(describeAuthError(error.message));
      setLoading(false);
      return;
    }

    if (data.session) {
      // Confirmation is off, so they are already signed in. Leave
      // `loading` set and let app/_layout.js route them by role.
      return;
    }

    // Confirmation is on. Say so on the screen rather than bouncing them
    // back to a login form that will refuse them.
    setConfirmSent(true);
    setLoading(false);
  }

  if (confirmSent) {
    return (
      <AuthShell title="Check your email" subtitle={`We sent a confirmation link to ${email.trim()}.`}>
        <Notice
          tone="success"
          message="Your account is created."
          detail="Open the link in that email to confirm the address, then sign in. The link expires after 24 hours."
        />
        <AuthButton label="Back to sign in" onPress={() => router.replace('/auth/login')} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="One account, whether you are buying books or selling them."
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Already have an account?</Text>
          <Pressable
            onPress={() => router.replace('/auth/login')}
            disabled={loading}
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="Sign in"
          >
            {({ pressed }) => (
              <Text style={[styles.footerLink, pressed && styles.footerLinkPressed]}>Sign in</Text>
            )}
          </Pressable>
        </View>
      }
    >
      {!!formError && <Notice tone="error" message={formError} />}

      <FormField
        label="Full name"
        placeholder="Bolaji Adedapo"
        value={fullName}
        onChangeText={(v) => edit('fullName', v)}
        error={fieldErrors.fullName}
        editable={!loading}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
        submitBehavior="submit"
      />

      <FormField
        ref={emailRef}
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
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        submitBehavior="submit"
      />

      <FormField
        ref={passwordRef}
        label="Password"
        placeholder="Choose a password"
        value={password}
        onChangeText={(v) => edit('password', v)}
        error={fieldErrors.password}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        editable={!loading}
        isPassword
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={handleSignUp}
      />

      <RoleChoice value={role} onChange={setRole} disabled={loading} />

      <AuthButton
        label="Create account"
        loadingLabel="Creating your account…"
        onPress={handleSignUp}
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
