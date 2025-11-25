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
