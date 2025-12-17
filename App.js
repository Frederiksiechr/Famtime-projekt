/**
 * App entrypoint
 *
 * - Wrapper omkring RootNavigator for at sikre SafeArea og statusbar-styling.
 * - Holder hele navigationstræet samlet ét sted.
 */
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';

import RootNavigator from './src/navigation/RootNavigator';
import { colors } from './src/styles/theme';
import { handlePendingApprovalNotificationResponse } from './src/utils/pendingApprovalActions';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const App = () => {
  useEffect(() => {
    const subscription =
      Notifications.addNotificationResponseReceivedListener(
        handlePendingApprovalNotificationResponse
      );
    return () => {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" backgroundColor={colors.background} />
      <RootNavigator />
    </SafeAreaProvider>
  );
};

export default App;
