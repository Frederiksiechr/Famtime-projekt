/**
 * ErrorMessage
 *
 * - Konsistent stil til globale fejl (f.eks. login-fejl).
 * - Kontrakt: forventer tekststreng; returnerer null hvis ingen fejl.
 *
 * @param {Object} props - Komponentens props.
 * @param {string} [props.message] - Fejltekst, der skal vises for brugeren.
 */

/**
 * FEJLBESKED KOMPONENT
 * 
 * Denne komponent viser fejlbeskeder til brugeren på en pæn og konsistent måde.
 * Når der sker noget galt (f.eks. login fejlede, eller internet forbindelsen blev
 * afbrudt), vises en rød box med fejlteksten.
 * 
 * Hvis der ikke er nogen fejlbesked, vises komponenten slet ikke.
 * 
 * Forældre-komponenter sender:
 * - "message": Fejlteksten som skal vises (f.eks. "Login fejlede - prøv igen")
 */
import React from 'react';
import { Text, View } from 'react-native';

import styles from '../styles/components/ErrorMessageStyles';

const ErrorMessage = ({ message }) => {
  if (!message) {
    return null;
  }

  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      <View style={styles.indicator} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
};
export default ErrorMessage;
