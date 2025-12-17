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

/**
 * EN SIMPEL KNAP-KOMPONENT
 * 
 * Denne komponent er en knap som brugerne kan trykke på. Den er designet til
 * at være simple og let at bruge.
 * 
 * Knappen kan være i forskellige tilstande:
 * - Normal - brugeren kan trykke på den
 * - Deaktiveret - knappen er grået ud og kan ikke trykkes
 * - Indlæsning - den viser en spinner mens den venter på svar fra serveren
 * 
 * Forældre-komponenter sender:
 * - "title": Hvad skal der stå på knappen
 * - "onPress": Hvad skal der ske når brugeren trykker
 * - "disabled": Skal knappen være deaktiveret (valgfrit)
 * - "loading": Skal der vises en spinner (valgfrit)
 */
import React from 'react';
import { Pressable, Text, ActivityIndicator } from 'react-native';

import { colors } from '../styles/theme';
import styles from '../styles/components/ButtonStyles';

/**
 * KNAP-KOMPONENTEN
 * 
 * Denne funktion definerer hvad knappen skal gøre når den bliver brugt.
 * 
 * Den tager imod nogle "properties" fra forældre-komponenten:
 * - title: Teksten på knappen
 * - onPress: Funktionen der skal køres når der klikkes
 * - disabled: Om knappen skal være deaktiveret
 * - loading: Om knappen viser en spinner
 * - style: Evt. ekstra styling
 */
const Button = ({ title, onPress, disabled, loading, style }) => {
  /**
   * BESTEM OM KNAPPEN ER DEAKTIVERET
   * 
   * Knappen er deaktiveret hvis:
   * - Forældrekomponenten siger den skal være det (disabled prop)
   * - Eller hvis den er i "loading"-tilstand (viser spinner)
   * 
   * Når knappen er deaktiveret, kan brugeren ikke trykke på den.
   */
  const isDisabled = disabled || loading;

  /**
   * RETURN - HVA DER SKAL VISES
   * 
   * Denne del returnerer hvad knappen skal se ud som.
   * 
   * Den bruger "Pressable" som er en React Native komponent til at håndtere
   * når brugeren trykker. Den kan registrere både normale tryk og
   * "ripple"-effekten (den bølge der kommer når man trykker på Android).
   * 
   * Styling:
   * - styles.button: Standard knap-udseende
   * - styles.buttonPressed: Tilføjes når brugeren presser knappen
   * - styles.buttonDisabled: Tilføjes hvis knappen er deaktiveret
   * 
   * Indhold:
   * - Hvis loading=true: vises en spinner (loading-indikator)
   * - Ellers: vises teksten fra title
   */
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
      {/*
        INDHOLDET AF KNAPPEN

        Her bestemmes hvad der skal vises inde i knappen.

        Hvis loading=true:
        - Vises en ActivityIndicator (spinner/loading animation)
        - Dette signalerer til brugeren at noget er ved at ske

        Hvis loading=false:
        - Vises teksten fra title-propen
        - Det er den normale tilstand
      */}
      {loading ? (
        <ActivityIndicator color={colors.primaryText} />
      ) : (
        <Text style={styles.title}>{title}</Text>
      )}
    </Pressable>
  );
};
export default Button;
