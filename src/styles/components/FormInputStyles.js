/**
 * FORM INPUT STYLES
 *
 * Styling til form input-komponenten med support for:
 * - Label med fokus og fejl-tilstande
 * - Input-wrapper med shadow og border
 * - Input-felt med multiline support
 * - Fejltekst under input
 */
import { StyleSheet } from 'react-native';
import { colors, spacing, fontSizes, radius } from '../theme';

const styles = StyleSheet.create({
  /**
   * CONTAINER
   * Wrapper til hele input-komponenten
   */
  container: {
    width: '100%',
  },
  
  /**
   * LABEL STYLES
   * Label-tekst med base, fokus og fejl-varianter
   */
  label: {
    marginBottom: spacing.xs,
    color: colors.text,
    fontSize: fontSizes.md,
    fontWeight: '700',
  },
  labelFocused: {
    color: colors.primary,
  },
  labelError: {
    color: colors.error,
  },
  
  /**
   * INPUT WRAPPER
   * Container omkring input med border, shadow og fokus/fejl-tilstande
   */
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
  
  /**
   * INPUT TEXT FIELD
   * Tekstinput-felt med padding og font-sizing, multiline-variant
   */
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
  
  /**
   * WRAPPER FOCUSED STATE
   * Wrapper-tilstand når input har fokus (primær border og øget shadow)
   */
  inputWrapperFocused: {
    borderColor: colors.primary,
    shadowOpacity: 0.35,
    elevation: 4,
  },
  
  /**
   * WRAPPER ERROR STATE
   * Wrapper-tilstand ved valideringsfejl (rød border og shadow)
   */
  inputWrapperError: {
    borderColor: colors.error,
    shadowColor: 'rgba(220, 38, 38, 0.25)',
  },
  
  /**
   * ERROR TEXT
   * Fejltekst under input-felt
   */
  errorText: {
    marginTop: spacing.xxs,
    color: colors.error,
    fontSize: fontSizes.sm,
  },
});

export default styles;
