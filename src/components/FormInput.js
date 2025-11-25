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
import { Text, TextInput, View } from 'react-native';

import { colors } from '../styles/theme';
import styles from '../styles/components/FormInputStyles';

const FormInput = ({ label, error, style, ...restProps }) => {
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = (event) => {
    // Tilføjer fokus-styling og videresender onFocus til forældrekomponenten.
    setIsFocused(true);
    if (typeof restProps.onFocus === 'function') {
      restProps.onFocus(event);
    }
  };

  const handleBlur = (event) => {
    // Fjerner fokus-styling og bevarer evt. ekstern onBlur-adfærd.
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
export default FormInput;
