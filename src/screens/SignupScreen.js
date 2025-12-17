/**
 * SignupScreen
 *
 * - Registrerer ny bruger i Firebase Auth og opretter matchende dokument i Firestore.
 * - Kontrakt: Navigeres til fra Login; forventer navigation-prop til at gå tilbage.
 *
 * Overblik:
 * - Validerer e-mail/kodeord lokalt før oprettelse.
 * - Opretter Firebase Auth-bruger og gemmer basisprofil i Firestore.
 * - Viser fejl inline og giver link tilbage til login.
 * - UI: simpel formular i et kort med header + tre inputfelter og call-to-action.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FormInput from '../components/FormInput';
import Button from '../components/Button';
import ErrorMessage from '../components/ErrorMessage';
import { auth, db, firebase } from '../lib/firebase';
import { getFriendlyAuthError } from '../lib/errorMessages';
import styles from '../styles/screens/SignupScreenStyles';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * OPRET KONTO SKÆRM
 * 
 * Her kan nye brugere oprette en konto.
 * 
 * Flowet:
 * 1. Brugeren skriver email, adgangskode og gentager adgangskode
 * 2. Vi validerer at alt er udfyldt og matchen
 * 3. Vi opretter en Firebase Auth konto
 * 4. Vi gemmer brugerens basisprofil i Firestore
 * 5. Brugeren er nu registreret og kan logge ind
 */
const SignupScreen = ({ navigation }) => {
  // Formularstate og fejlhåndtering for e-mail/kodeord.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);

  /**
   * VALIDERING AF OPRETTELSESFORMULAR
   * 
   * Tjekker at:
   * - Email er udfyldt og ser ud som en rigtig email
   * - Adgangskoden er mindst 6 tegn
   * - Begge adgangskoder matcher hinanden
   */
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

  /**
   * OPRETTELSE AF NY KONTO
   * 
   * Denne funktion:
   * 1. Validerer input
   * 2. Opretter en ny bruger i Firebase Auth
   * 3. Gemmer brugerens email i Firestore under deres uid
   * 4. Hvis noget fejler, viser vi en fejlbesked
   */
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
    // Layout: SafeArea + KeyboardAvoiding + ScrollView med header og kort med inputs/handlinger.
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
export default SignupScreen;
