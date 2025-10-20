/**
 * Button
 *
 * - Minimal hand-rullet knap, der understøtter loading og disabled-state.
 * - Kontrakt: forventer title (string) og onPress (function).
 *
 * @param {Object} props - Komponentens props.
 * @param {string} props.title - Teksten i knappen.
 * @param {() => void} props.onPress - Handler, der kaldes ved tryk.
 * @param {boolean} [props.disabled] - Deaktiverer knappen visuelt og funktionelt.
 * @param {boolean} [props.loading] - Viser spinner i stedet for tekst.
 * @param {import('react-native').StyleProp<import('react-native').ViewStyle>} [props.style] - Ekstra styling til knappen.
 */
import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';

import { colors, spacing, radius, fontSizes } from '../styles/theme';

const Button = ({ title, onPress, disabled, loading, style }) => {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(255, 245, 230, 0.25)' }}
      style={({ pressed }) => [
        styles.button,
        pressed ? styles.buttonPressed : null,
        isDisabled ? styles.buttonDisabled : null,
        style,
      ]}
      disabled={isDisabled}
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryText} />
      ) : (
        <Text style={styles.title}>{title}</Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    shadowColor: colors.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: Platform.OS === 'ios' ? 0.98 : 1 }],
  },
  buttonDisabled: {
    backgroundColor: '#E7C9A9',
    shadowOpacity: 0,
    elevation: 0,
  },
  title: {
    color: colors.primaryText,
    fontSize: fontSizes.md,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});

export default Button;
