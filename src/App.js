/**
 * App entrypoint
 *
 * - Wrapper omkring RootNavigator for at sikre SafeArea og statusbar-styling.
 * - Holder hele navigationstræet samlet ét sted.
 */
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import RootNavigator from './navigation/RootNavigator';
import { colors } from './styles/theme';

const App = () => {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" backgroundColor={colors.background} />
      <RootNavigator />
    </SafeAreaProvider>
  );
};

export default App;
