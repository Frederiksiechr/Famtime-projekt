/**
 * ERROR MESSAGE STYLES
 *
 * Styling til fejlbesked-komponenten med visuelt feedback:
 * - Container med rød baggrund og border
 * - Rød indikator-prik for visuel markering
 * - Fejltekst med error-farve
 */
import { StyleSheet } from 'react-native';
import { colors, spacing, fontSizes, radius } from '../theme';

const styles = StyleSheet.create({
  /**
   * CONTAINER STYLES
   * Fejlboks med rød tone, shadow og border for visuel feedback
   */
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
  
  /**
   * INDICATOR DOT
   * Lille rød prik for visuelt at markere at det er en fejlbesked
   */
  indicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.error,
    marginTop: spacing.xs,
    marginRight: spacing.sm,
  },
  
  /**
   * ERROR TEXT
   * Fejltekst med rød farve og letter-spacing
   */
  text: {
    color: colors.error,
    fontSize: fontSizes.md,
    flex: 1,
    letterSpacing: 0.15,
  },
});

export default styles;
