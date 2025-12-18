/**
 * APP ENTRYPOINT
 *
 * Wrapper omkring RootNavigator for at sikre SafeArea og statusbar-styling.
 * Opsætter notifikations-handler og lytter på notifikations-responses fra brugeren.
 * Holder hele navigationstræet og notifikations-logik samlet ét sted.
 */
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';

import RootNavigator from './src/navigation/RootNavigator';
import { colors } from './src/styles/theme';
import { handlePendingApprovalNotificationResponse } from './src/utils/pendingApprovalActions';

/**
 * NOTIFIKATIONS-HANDLER OPSÆTNING
 *
 * Konfigurerer hvordan notifikationer skal håndteres når de kommer ind:
 * - Vis alert/banner til brugeren
 * - Afspil lyd
 * - Opdater ikke badge-count
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * APP COMPONENT
 *
 * Root-component der opsætter:
 * - SafeAreaProvider for sikker layout omkring notches og UI-elementer
 * - StatusBar styling med dark-indhold og background-farve
 * - RootNavigator for hele navigation-logik
 */
const App = () => {
  /**
   * NOTIFIKATIONS RESPONSE LISTENER
   *
   * Lytter på når brugeren trykker på en notifikation og handler responsens action.
   * Bruges til at håndtere godkendelse af events når brugeren trykker på
   * pending-approval notifikationer.
   */
  useEffect(() => {
    const subscription =
      Notifications.addNotificationResponseReceivedListener(
        handlePendingApprovalNotificationResponse
      );
    
    // Cleanup: fjern subscription når komponenten unmounter
    return () => {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }, []);

  /**
   * RENDER APP
   *
   * Returner hele app-strukturen med:
   * - SafeAreaProvider for safe layout omkring notches
   * - StatusBar med dark-indhold
   * - RootNavigator med hele navigation-logik
   */
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" backgroundColor={colors.background} />
      <RootNavigator />
    </SafeAreaProvider>
  );
};

export default App;
