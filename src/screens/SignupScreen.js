/**
 * SignupScreen
 *
 * - Registrerer ny bruger i Firebase Auth og opretter matchende dokument i Firestore.
 * - Kontrakt: Navigeres til fra Login; forventer navigation-prop til at gå tilbage.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import FormInput from '../components/FormInput';
import Button from '../components/Button';
import ErrorMessage from '../components/ErrorMessage';
import { auth, db, firebase } from '../lib/firebase';
import { getFriendlyAuthError } from '../lib/errorMessages';
import { colors, spacing, fontSizes, radius } from '../styles/theme';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SignupScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);

  const validate = () => {
    // Validerer formularfelter og bygger en samlet fejlliste.
    const nextErrors = {};

    if (!email.trim()) {
      nextErrors.email = 'E-mail skal udfyldes.';
    } else if (!emailRegex.test(email.trim())) {
      nextErrors.email = 'Angiv en gyldig e-mailadresse.';
    }

    if (!password) {
      nextErrors.password = 'Adgangskode skal udfyldes.';
    } else if (password.length < 6) {
      nextErrors.password = 'Adgangskoden skal mindst være 6 tegn.';
    }

    if (!confirmPassword) {
      nextErrors.confirmPassword = 'Gentag din adgangskode.';
    } else if (password !== confirmPassword) {
      nextErrors.confirmPassword = 'Adgangskoderne matcher ikke.';
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSignup = async () => {
    // Opretter ny konto i Firebase og registrerer en basisprofil i Firestore.
    if (!validate()) {
      return;
    }

    try {
      setLoading(true);
      setAuthError('');
      const credentials = await auth.createUserWithEmailAndPassword(
        email.trim(),
        password
      );

      await db
        .collection('users')
        .doc(credentials.user.uid)
        .set({
          email: email.trim(),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
    } catch (error) {
      console.error('[SignupScreen] Signup failed', error);
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
            <Text style={styles.kicker}>Kom i gang</Text>
            <Text style={styles.title}>Opret FamTime-konto</Text>
            <Text style={styles.subtitle}>
              Inviter familien og find tider der passer alle.
            </Text>
          </View>

          <View style={styles.card}>
            <ErrorMessage message={authError} />

            <FormInput
              label="E-mail"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCorrect={false}
              error={fieldErrors.email}
              style={styles.field}
              placeholder="familie@email.dk"
            />

            <FormInput
              label="Adgangskode"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              error={fieldErrors.password}
              style={styles.field}
              placeholder="Mindst 6 tegn"
            />

            <FormInput
              label="Gentag adgangskode"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              error={fieldErrors.confirmPassword}
              style={styles.field}
              placeholder="Gentag din kode"
            />

            <Button
              title="Opret konto"
              onPress={handleSignup}
              loading={loading}
              style={styles.submit}
            />

            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.loginLink}
            >
              <Text style={styles.linkText}>
                Har du allerede en konto? Log ind
              </Text>
            </TouchableOpacity>
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
  kicker: {
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
  loginLink: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  linkText: {
    color: colors.primaryDark,
    fontSize: fontSizes.sm,
    fontWeight: '700',
  },
});

export default SignupScreen;
