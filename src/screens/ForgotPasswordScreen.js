/**
 * ForgotPasswordScreen
 *
 * Hvad goer filen for appen:
 * - Giver brugeren en simpel maade at gendanne adgangskode ved at sende en reset-mail via Firebase Auth.
 * - Viser tydelig feedback (fejl eller succes) og guider brugeren tilbage til login-flowet.
 *
 * Overblik (hvordan filen er bygget op):
 * - State: email-input, field/auth fejl, succesbesked og loading.
 * - Flow: valider email -> kald `sendPasswordResetEmail` -> vis succes/fejl.
 * - UI: header + kort med emailfelt og knap til at sende reset-mail.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
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
import styles from '../styles/screens/ForgotPasswordScreenStyles';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * GLEMT ADGANGSKODE SKÆRM
 * 
 * Hvis brugeren har glemt sin adgangskode, kan de få sendt en reset-email
 * ved at skrive deres email her.
 * 
 * Flow:
 * - Validerer email-input og viser feltfejl hvis format mangler.
 * - Sender reset-link via Firebase Auth og viser klar succes-tekst.
 * - Oversætter auth-fejl til brugervenlig besked og nulstiller success state.
 */
const ForgotPasswordScreen = () => {
  // Formularstate + feedback-tekster.
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [authError, setAuthError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);

  /**
   * SEND RESET EMAIL
   * 
   * Validerer email, sender reset-mail via Firebase og viser feedback:
   * - Feltvalidering: tom/ugyldig email giver feltfejl.
   * - Success: viser grønt kort med instruktionstekst.
   * - Fejl: logger teknisk fejl og oversætter til venlig besked.
   */
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
    // Layout: SafeArea + KeyboardAvoiding + ScrollView med header og kort med input/handling.
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
export default ForgotPasswordScreen;
