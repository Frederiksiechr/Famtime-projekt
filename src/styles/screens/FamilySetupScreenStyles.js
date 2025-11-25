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
  familyIdText: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginBottom: spacing.lg,
  },
  copyButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  copyButtonText: {
    color: colors.primaryText,
    fontSize: fontSizes.sm,
    fontWeight: '600',
  },
  copyFeedback: {
    fontSize: fontSizes.sm,
    color: colors.primary,
    marginBottom: spacing.md,
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
  addEmailButton: {
    marginBottom: spacing.md,
  },
  inviteList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing.lg,
  },
  inviteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(230, 138, 46, 0.18)',
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  inviteChipText: {
    color: colors.text,
    fontSize: fontSizes.sm,
    marginRight: spacing.xs,
  },
  inviteChipRemove: {
    color: colors.mutedText,
    fontSize: fontSizes.sm,
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
  highlight: {
    color: colors.primary,
    fontWeight: '700',
  },
});

export default styles;
