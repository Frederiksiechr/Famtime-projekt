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
import { Pressable, Text, ActivityIndicator } from 'react-native';

import { colors } from '../styles/theme';
import styles from '../styles/components/ButtonStyles';

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
export default Button;
