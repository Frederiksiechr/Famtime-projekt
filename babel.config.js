/**
 * BABEL CONFIGURATION
 *
 * Babel-konfiguration for Expo-projektet:
 * - Aktiverer caching for hurtigere build-tider
 * - Bruger babel-preset-expo for at transpile React Native-kode
 */
module.exports = function (api) {
  // Cache Babel-konfiguration for bedre performance
  api.cache(true);

  return {
    /**
     * PRESETS
     * babel-preset-expo håndterer transpilation af React Native-kode
     * til kompatibel JavaScript for Expo-runtime
     */
    presets: ['babel-preset-expo'],
  };
};
