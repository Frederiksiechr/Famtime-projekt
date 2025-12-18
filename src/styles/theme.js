/**
 * THEME CONSTANTS
 *
 * Centraliserede design-tokens for hele appen:
 * - Farvepalette (canvas, primary, text, feedback osv.)
 * - Spacing-værdier for konsistent layout
 * - Font-størrelser til typografi
 * - Border-radius værdier for afrundede hjørner
 */

/**
 * COLORS
 * Farvepalette med canvas-nuancer, primary-farve, tekst og feedback-farver
 */
export const colors = {
  canvas: '#F7E7D4',
  background: '#FFF5E6',
  surface: '#FFFFFF',
  surfaceMuted: '#F2D8BA',
  primary: '#E68A2E',
  primaryDark: '#B86414',
  primaryText: '#FFF7EB',
  text: '#4B2E12',
  mutedText: '#8C6F55',
  border: '#E2C5A3',
  shadow: 'rgba(75, 46, 18, 0.12)',
  error: '#D14324',
  success: '#1F7A52',
};

/**
 * SPACING
 * Spacing-skala fra 2px (xxs) til 44px (xxl) for konsistent padding/margin
 */
export const spacing = {
  xxs: 2,
  xs: 6,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  xxl: 44,
};

/**
 * FONT SIZES
 * Font-størrelses-skala fra 12px (xs) til 30px (xxl) for typografi
 */
export const fontSizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 30,
};

/**
 * RADIUS
 * Border-radius værdier fra 8px (sm) til 28px (xl) for afrundede hjørner
 */
export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 28,
};
