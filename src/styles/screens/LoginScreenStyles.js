import { StyleSheet } from 'react-native';

import { colors, spacing, fontSizes, radius } from '../theme';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  welcome: {
    fontSize: fontSizes.sm,
    fontWeight: '600',
    color: colors.mutedText,
    letterSpacing: 0.4,
  },
  title: {
    fontSize: fontSizes.xxl,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.xs,
  },
  subtitle: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    shadowColor: colors.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  field: {
    marginBottom: spacing.md,
  },
  submit: {
    marginTop: spacing.sm,
  },
  linksRow: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkPrimary: {
    color: colors.primaryDark,
    fontSize: fontSizes.sm,
    fontWeight: '700',
  },
});

export default styles;
