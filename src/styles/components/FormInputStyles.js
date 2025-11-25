import { StyleSheet } from 'react-native';
import { colors, spacing, fontSizes, radius } from '../theme';

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

export default styles;
