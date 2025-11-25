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
export default SignupScreen;
