import { StyleSheet } from 'react-native';

import { colors, spacing, fontSizes, radius } from '../theme';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSizes.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    marginBottom: spacing.lg,
  },
  statusText: {
    color: colors.primary,
    fontSize: fontSizes.md,
    marginTop: spacing.md,
  },
  continueButton: {
    marginTop: spacing.lg,
  },
  retryLink: {
    marginTop: spacing.sm,
    color: colors.primary,
    textAlign: 'center',
    fontSize: fontSizes.md,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(75, 46, 18, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  modalTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  modalDescription: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    marginBottom: spacing.lg,
  },
  modalPrimary: {
    marginBottom: spacing.sm,
  },
  modalSecondary: {
    backgroundColor: '#BFA386',
  },
});

export default styles;
