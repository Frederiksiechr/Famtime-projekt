/**
 * RootNavigator
 *
 * - Lytter til Firebase Auth state og viser enten auth-stack eller app-stack.
 * - Holder appen i sync med onAuthStateChanged og viser en loading state under init.
 * - NavigationStrategy: AuthStack for uloggede brugere, AppStack for loggede.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginScreen from '../screens/LoginScreen';
import SignupScreen from '../screens/SignupScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import LandingScreen from '../screens/LandingScreen';
import CalendarSyncScreen from '../screens/CalendarSyncScreen';
import FamilySetupScreen from '../screens/FamilySetupScreen';
import MainTabs from './MainTabs';
import { auth } from '../lib/firebase';
import { colors, spacing, fontSizes } from '../styles/theme';

const Stack = createNativeStackNavigator();

const AuthStack = () => (
  <Stack.Navigator>
    <Stack.Screen
      name="Login"
      component={LoginScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="Signup"
      component={SignupScreen}
      options={{ title: 'Opret profil' }}
    />
    <Stack.Screen
      name="ForgotPassword"
      component={ForgotPasswordScreen}
      options={{ title: 'Glemt adgangskode' }}
    />
  </Stack.Navigator>
);

const AppStack = () => (
  <Stack.Navigator>
    <Stack.Screen
      name="Landing"
      component={LandingScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="CalendarSync"
      component={CalendarSyncScreen}
      options={{ title: 'Kalendersynkronisering' }}
    />
    <Stack.Screen
      name="FamilySetup"
      component={FamilySetupScreen}
      options={{ title: 'Familieopsætning' }}
    />
    <Stack.Screen
      name="MainTabs"
      component={MainTabs}
      options={{ headerShown: false }}
    />
  </Stack.Navigator>
);

const RootNavigator = () => {
  const [initializing, setInitializing] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    // onAuthStateChanged holder navigationen i sync med Firebase login-status.
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setCurrentUser(user);
      setInitializing(false);
    });

    return unsubscribe;
  }, []);

  if (initializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Indlæser FamTime…</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      {currentUser ? <AppStack /> : <AuthStack />}
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: spacing.md,
    color: colors.mutedText,
    fontSize: fontSizes.md,
  },
});

export default RootNavigator;
