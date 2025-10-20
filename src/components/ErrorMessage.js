/**
 * ErrorMessage
 *
 * - Konsistent stil til globale fejl (f.eks. login-fejl).
 * - Kontrakt: forventer tekststreng; returnerer null hvis ingen fejl.
 *
 * @param {Object} props - Komponentens props.
 * @param {string} [props.message] - Fejltekst, der skal vises for brugeren.
 */
import React from 'react';
import { Text, View, StyleSheet } from 'react-native';

import { colors, spacing, radius, fontSizes } from '../styles/theme';

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

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FEF2F2',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.2)',
    shadowColor: 'rgba(220, 38, 38, 0.2)',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  indicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.error,
    marginTop: spacing.xs,
    marginRight: spacing.sm,
  },
  text: {
    color: colors.error,
    fontSize: fontSizes.md,
    flex: 1,
    letterSpacing: 0.15,
  },
});

export default ErrorMessage;
