import { StyleSheet } from 'react-native';
import { colors, spacing, fontSizes, radius } from '../theme';

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
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.background,
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
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    shadowColor: colors.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  heroTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  heroSubtitle: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    marginBottom: spacing.md,
  },
  familyCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  familyCodePill: {
    flex: 1,
    backgroundColor: colors.canvas,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  familyCodeLabel: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginBottom: spacing.xs / 2,
  },
  familyCodeValue: {
    fontSize: fontSizes.md,
    fontWeight: '700',
    color: colors.text,
  },
  copyIdButton: {
    marginLeft: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    minWidth: 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyIdButtonText: {
    color: colors.primaryText,
    fontSize: fontSizes.sm,
    fontWeight: '600',
  },
  copyFeedback: {
    fontSize: fontSizes.sm,
    color: colors.primary,
    marginTop: spacing.sm,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.xs,
    marginBottom: spacing.lg,
  },
  modeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  modeButtonActive: {
    backgroundColor: colors.primary,
  },
  modeButtonText: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: colors.primaryText,
  },
  successText: {
    color: colors.primary,
    fontSize: fontSizes.md,
    marginBottom: spacing.md,
  },
  field: {
    marginBottom: spacing.md,
  },
  deleteButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.error,
  },
  primaryAction: {
    marginTop: spacing.md,
  },
  familyCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  familyMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginBottom: spacing.xs,
  },
  familyMemberButton: {
    paddingVertical: spacing.xs,
  },
  familyMemberActionText: {
    color: colors.primary,
    fontWeight: '600',
  },
  familyCardTitle: {
    fontSize: fontSizes.md,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  familyCardText: {
    fontSize: fontSizes.md,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  pendingTitle: {
    marginTop: spacing.lg,
  },
  requestsTitle: {
    marginTop: spacing.lg,
  },
  pendingText: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    marginBottom: spacing.xs,
  },
});

export default styles;
