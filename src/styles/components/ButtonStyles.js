import { StyleSheet, Platform } from 'react-native';
import { colors, spacing, fontSizes, radius } from '../theme';

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

export default styles;
