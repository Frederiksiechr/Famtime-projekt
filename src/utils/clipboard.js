/**
 * CLIPBOARD UTILS
 *
 * Simpelt wrapper omkring Expo Clipboard-API.
 * Vi bruger statisk import for at undgå Metro's async-require polyfill,
 * som kan give problemer på Windows med absolutte stier.
 */
import * as Clipboard from 'expo-clipboard';

export const copyStringToClipboard = async (value) => {
  if (typeof value !== 'string' || !value.length) {
    return false;
  }
  try {
    if (typeof Clipboard?.setStringAsync !== 'function') {
      throw new Error('Clipboard API is unavailable.');
    }
    await Clipboard.setStringAsync(value);
    return true;
  } catch (error) {
    console.warn('Clipboard copy failed', error);
    return false;
  }
};
