import { StyleSheet } from 'react-native';
import { colors, spacing, fontSizes } from '../theme';

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: spacing.md,
    color: colors.mutedText,
    fontSize: fontSizes.md,
  },
});

export default styles;
