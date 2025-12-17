/**
 * LoginScreen
 *
 * Hvad goer filen for appen:
 * - Er indgangen til appen: her logger brugeren ind med e-mail og adgangskode via Firebase Auth.
 * - Viser fejl paa en brugervenlig maade og giver genveje til "Glemt adgangskode" og "Opret konto".
 * - Naar login lykkes, overtager RootNavigator og sender brugeren videre til resten af appens flow.
 *
 * Overblik (hvordan filen er bygget op):
 * - State: email/password, felt-fejl, auth-fejl og loading.
 * - Helpers: clear errors naar brugeren retter input, og `validate` til at tjekke felter foer login.
 * - Flow: valider input -> kald `signInWithEmailAndPassword` -> ved fejl nulstilles session og fejl vises.
 * - UI: header + kort med to felter, login-knap og links til andre auth-skærme.
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
import { auth } from '../lib/firebase';
import { getFriendlyAuthError } from '../lib/errorMessages';
import styles from '../styles/screens/LoginScreenStyles';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * LOGIN SKÆRM KOMPONENT
 * 
 * Dette er første skridt når brugeren åbner appen uden at være logget ind.
 * Her logger de ind med email og adgangskode.
 * 
 * Flowet:
 * 1. Brugeren skriver email og adgangskode
 * 2. Vi validerer at begge felter er udfyldt
 * 3. Vi sender det til Firebase Auth
 * 4. Hvis det virker: Brugeren er nu logget ind, appen går videre
 * 5. Hvis det fejler: Vi viser en fejlbesked
 */
const LoginScreen = ({ navigation }) => {
  // Formularstate og fejlhåndtering for login.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);

  /**
   * RYDNING AF FEJLBESKEDER
   * 
   * Når brugeren begynder at skrive i et felt, skal gamle fejlbeskeder
   * for det felt forsvinde (da de nu skriver et nyt svar).
   */
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

  // Sikrer at brugerens input er gyldigt før login-forsøg.
  const validate = () => {
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

  /**
   * NULSTILLING AF SESSION
   * 
   * Hvis login fejler, skal brugeren logges ud først før de kan prøve igen.
   * Dette sikrer en "clean slate" til næste login-forsøg.
   */
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

export default LoginScreen;
