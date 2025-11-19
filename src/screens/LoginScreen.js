/**
 * LoginScreen
 *
 * - Varetager email/password-login med inputvalidering og brugervenlige fejl.
 * - Kontrakt: Rendes af navigation-stack og modtager `navigation` prop fra React Navigation.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FormInput from '../components/FormInput';
import Button from '../components/Button';
import ErrorMessage from '../components/ErrorMessage';
import { auth } from '../lib/firebase';
import { getFriendlyAuthError } from '../lib/errorMessages';
import { colors, spacing, fontSizes, radius } from '../styles/theme';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);

  const clearFieldError = (field) => {
    setFieldErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const clearAuthError = () => {
    setAuthError((prev) => (prev ? '' : prev));
  };

  const handleEmailChange = (value) => {
    setEmail(value);
    clearFieldError('email');
    clearAuthError();
  };

  const handlePasswordChange = (value) => {
    setPassword(value);
    clearFieldError('password');
    clearAuthError();
  };

  const validate = () => {
    // Sikrer at brugerens input er gyldigt før login-forsøg.
    const nextErrors = {};

    if (!email.trim()) {
      nextErrors.email = 'E-mail skal udfyldes.';
    } else if (!emailRegex.test(email.trim())) {
      nextErrors.email = 'Angiv en gyldig e-mailadresse.';
    }

    if (!password) {
      nextErrors.password = 'Adgangskoden skal udfyldes.';
    } else if (password.length < 6) {
      nextErrors.password = 'Adgangskoden skal mindst være 6 tegn.';
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const resetAuthSession = async () => {
    if (!auth.currentUser) {
      return;
    }
    try {
      await auth.signOut();
    } catch (signOutError) {
      console.warn('[LoginScreen] Could not reset auth session', signOutError);
    }
  };

  const handleLogin = async () => {
    // Forsøger at logge brugeren ind og oversætter fejl til menneskelig tekst.
    if (!validate()) {
      return;
    }

    try {
      setLoading(true);
      setAuthError('');
      await auth.signInWithEmailAndPassword(email.trim(), password);
    } catch (error) {
      console.error('[LoginScreen] Login failed', error);
      await resetAuthSession();
      setAuthError(getFriendlyAuthError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.welcome}>Velkommen tilbage</Text>
            <Text style={styles.title}>FamTime</Text>
            <Text style={styles.subtitle}>
              Log ind og saml familiens planer ét sted.
            </Text>
          </View>

          <View style={styles.card}>
            <ErrorMessage message={authError} />

            <FormInput
              label="E-mail"
              value={email}
              onChangeText={handleEmailChange}
              keyboardType="email-address"
              autoCorrect={false}
              error={fieldErrors.email}
              style={styles.field}
              placeholder="din@email.dk"
            />

            <FormInput
              label="Adgangskode"
              value={password}
              onChangeText={handlePasswordChange}
              secureTextEntry
              autoCorrect={false}
              error={fieldErrors.password}
              style={styles.field}
              placeholder="••••••"
            />

            <Button
              title="Log ind"
              onPress={handleLogin}
              loading={loading}
              style={styles.submit}
            />

            <View style={styles.linksRow}>
              <TouchableOpacity
                onPress={() => navigation.navigate('ForgotPassword')}
              >
                <Text style={styles.linkPrimary}>Glemt adgangskode?</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
                <Text style={styles.linkPrimary}>Opret konto</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  welcome: {
    fontSize: fontSizes.sm,
    fontWeight: '600',
    color: colors.mutedText,
    letterSpacing: 0.4,
  },
  title: {
    fontSize: fontSizes.xxl,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.xs,
  },
  subtitle: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    shadowColor: colors.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  field: {
    marginBottom: spacing.md,
  },
  submit: {
    marginTop: spacing.sm,
  },
  linksRow: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkPrimary: {
    color: colors.primaryDark,
    fontSize: fontSizes.sm,
    fontWeight: '700',
  },
});

export default LoginScreen;
