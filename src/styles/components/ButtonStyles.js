/**
 * BUTTON STYLES
 *
 * Styling til knap-komponenten med support for forskellige tilstande:
 * - Normal tilstand med shadow og primary farve
 * - Pressed tilstand med opacity og scale-effekt
 * - Disabled tilstand med dæmpet baggrund
 * - Title-tekst med bold font og letter-spacing
 */
import { StyleSheet, Platform } from 'react-native';
import { colors, spacing, fontSizes, radius } from '../theme';

const styles = StyleSheet.create({
  /**
   * BUTTON STYLES
   * Primær knap-stil med shadow, farve og minimumhøjde for touch-target
   */
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
  
  /**
   * BUTTON PRESSED STATE
   * Feedback-effekt når knap trykkes ned (opacity + scale på Android)
   */
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: Platform.OS === 'ios' ? 0.98 : 1 }],
  },
  
  /**
   * BUTTON DISABLED STATE
   * Deaktiveret knap med dæmpet baggrund og uden shadow
   */
  buttonDisabled: {
    backgroundColor: '#E7C9A9',
    shadowOpacity: 0,
    elevation: 0,
  },
  
  /**
   * BUTTON TITLE TEXT
   * Knap-tekst med bold weight, letter-spacing og primær tekstfarve
   */
  title: {
    color: colors.primaryText,
    fontSize: fontSizes.md,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});

export default styles;
