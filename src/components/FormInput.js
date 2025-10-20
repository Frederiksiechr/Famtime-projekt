/**
 * FormInput
 *
 * - Genanvendelig wrapper omkring TextInput med label og fejlbesked.
 * - Kontrakt: styret komponent; forventer value/onChangeText samt valgfri error.
 *
 * @param {Object} props - Komponentens props.
 * @param {string} props.label - Overskrift over inputfeltet.
 * @param {string} [props.error] - Feltspecifik fejltekst der vises under feltet.
 * @param {import('react-native').StyleProp<import('react-native').ViewStyle>} [props.style] - Ekstra styling til containeren.
 * @param {import('react-native').TextInputProps} restProps - Øvrige TextInput props via rest-spredning.
 */
import React, { useState } from 'react';
import { Text, TextInput, View, StyleSheet } from 'react-native';

import { colors, spacing, radius, fontSizes } from '../styles/theme';

const FormInput = ({ label, error, style, ...restProps }) => {
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = (event) => {
    setIsFocused(true);
    if (typeof restProps.onFocus === 'function') {
      restProps.onFocus(event);
    }
  };

  const handleBlur = (event) => {
    setIsFocused(false);
    if (typeof restProps.onBlur === 'function') {
      restProps.onBlur(event);
    }
  };

  const showError = Boolean(error);

  return (
    <View style={[styles.container, style]}>
      <Text
        style={[
          styles.label,
          isFocused ? styles.labelFocused : null,
          showError ? styles.labelError : null,
        ]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.inputWrapper,
          isFocused ? styles.inputWrapperFocused : null,
          showError ? styles.inputWrapperError : null,
        ]}
      >
        <TextInput
          style={[
            styles.input,
            restProps.multiline ? styles.inputMultiline : null,
          ]}
          placeholderTextColor={colors.mutedText}
          autoCapitalize="none"
          selectionColor={colors.primary}
          {...restProps}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      </View>
      {showError ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    marginBottom: spacing.xxs,
    color: colors.mutedText,
    fontSize: fontSizes.sm,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  labelFocused: {
    color: colors.primary,
  },
  labelError: {
    color: colors.error,
  },
  inputWrapper: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  input: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: fontSizes.md,
    borderRadius: radius.lg,
  },
  inputMultiline: {
    paddingTop: spacing.sm,
    minHeight: 120,
  },
  inputWrapperFocused: {
    borderColor: colors.primary,
    shadowOpacity: 0.35,
    elevation: 4,
  },
  inputWrapperError: {
    borderColor: colors.error,
    shadowColor: 'rgba(220, 38, 38, 0.25)',
  },
  errorText: {
    marginTop: spacing.xxs,
    color: colors.error,
    fontSize: fontSizes.sm,
  },
});

export default FormInput;
