/**
 * ROOT NAVIGATOR STYLES
 *
 * Styling til root navigation container:
 * - Loading-skærm mens app initialiserer
 * - Loading-tekst med muted farve
 */
import { StyleSheet } from 'react-native';
import { colors, spacing, fontSizes } from '../theme';

const styles = StyleSheet.create({
  /**
   * LOADING CONTAINER
   * Fuld-skærm loading-container med centered indhold
   */
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  
  /**
   * LOADING TEXT
   * Tekst der vises under loading-spinner
   */
  loadingText: {
    marginTop: spacing.md,
    color: colors.mutedText,
    fontSize: fontSizes.md,
  },
});

export default styles;
