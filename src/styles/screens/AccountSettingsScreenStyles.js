import { StyleSheet } from 'react-native';

import { colors, spacing, fontSizes, radius } from '../theme';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    paddingBottom: spacing.xxl + spacing.lg,
    backgroundColor: colors.canvas,
  },
  container: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    gap: spacing.lg,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    shadowColor: colors.shadow,
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  title: {
    fontSize: fontSizes.xxl,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    shadowColor: colors.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
    gap: spacing.md,
  },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(230, 138, 46, 0.16)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
  },
  statusText: {
    color: colors.primaryDark,
    fontSize: fontSizes.sm,
    fontWeight: '600',
  },
  infoText: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
  },
  sectionTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  sectionSubtitle: {
    fontSize: fontSizes.md,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  fieldText: {
    fontSize: fontSizes.md,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  memberText: {
    fontSize: fontSizes.md,
    color: colors.text,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  pendingText: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginBottom: spacing.xs,
  },
  inviteCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  inviteTitle: {
    fontSize: fontSizes.md,
    fontWeight: '700',
    color: colors.text,
  },
  inviteMeta: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginBottom: spacing.xs,
  },
  inviteButton: {
    marginTop: spacing.sm,
  },
  leaveButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.error,
  },
  actionButton: {
    marginTop: spacing.md,
  },
  deleteProfileButton: {
    marginTop: spacing.md,
    backgroundColor: colors.error,
  },
  logoutButton: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
  },
});

export default styles;

