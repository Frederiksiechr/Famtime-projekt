/**
 * ForgotPasswordScreen
 *
 * - Sender reset-mail via Firebase Auth og viser succes-/fejlbesked.
 * - Kontrakt: Navigeres fra Login; forventer navigation-prop for at gå tilbage.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
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

const ForgotPasswordScreen = () => {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [authError, setAuthError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleReset = async () => {
    // Sender reset-mail via Firebase og håndterer validering/feedback.
    if (!email.trim()) {
      setFieldError('E-mail skal udfyldes.');
      return;
    }

    if (!emailRegex.test(email.trim())) {
      setFieldError('Angiv en gyldig e-mailadresse.');
      return;
    }

    try {
      setLoading(true);
      setFieldError('');
      setAuthError('');
      await auth.sendPasswordResetEmail(email.trim());
      setSuccessMessage(
        'Vi har sendt en mail med instruktioner. Tjek din indbakke.'
      );
    } catch (error) {
      console.error('[ForgotPasswordScreen] Reset failed', error);
      setAuthError(getFriendlyAuthError(error));
      setSuccessMessage('');
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
            <Text style={styles.kicker}>Har du glemt koden?</Text>
            <Text style={styles.title}>Gendan adgangskode</Text>
            <Text style={styles.subtitle}>
              Vi sender dig et mail-link, så du kan vælge en ny adgangskode.
            </Text>
          </View>

          <View style={styles.card}>
            <ErrorMessage message={authError} />
            {successMessage ? (
              <View style={styles.successBox}>
                <Text style={styles.success}>{successMessage}</Text>
              </View>
            ) : null}

            <FormInput
              label="E-mail"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCorrect={false}
              error={fieldError}
              style={styles.field}
              placeholder="familie@email.dk"
            />

            <Button
              title="Send reset-mail"
              onPress={handleReset}
              loading={loading}
            />
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
    marginBottom: spacing.lg,
  },
  successBox: {
    backgroundColor: '#ECFDF5',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  success: {
    color: colors.success,
    fontSize: fontSizes.sm,
    textAlign: 'center',
  },
});

export default ForgotPasswordScreen;
