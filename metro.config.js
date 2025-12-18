/**
 * METRO CONFIGURATION
 *
 * Metro bundler konfiguration for Expo-projektet:
 * - Starter fra Expo's standardkonfiguration
 * - Udvider resolveren til også at understøtte .cjs filer
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * RESOLVER: SOURCE EXTENSIONS
 *
 * Tilføjer 'cjs' så CommonJS-moduler med .cjs endelse kan importeres.
 */
config.resolver.sourceExts = [
  ...config.resolver.sourceExts,
  'cjs',
];

/**
 * EXPORT
 *
 * Eksporterer den tilpassede Metro-konfiguration.
 */
module.exports = config;
