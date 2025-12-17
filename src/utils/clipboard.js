let clipboardModulePromise = null;

const loadClipboardModule = async () => {
  if (!clipboardModulePromise) {
    clipboardModulePromise = import('expo-clipboard').catch((error) => {
      clipboardModulePromise = null;
      throw error;
    });
  }
  return clipboardModulePromise;
};

export const copyStringToClipboard = async (value) => {
  if (typeof value !== 'string' || !value.length) {
    return false;
  }
  try {
    const clipboard = await loadClipboardModule();
    if (typeof clipboard?.setStringAsync !== 'function') {
      throw new Error('Clipboard API is unavailable.');
    }
    await clipboard.setStringAsync(value);
    return true;
  } catch (error) {
    console.warn('Clipboard copy failed', error);
    return false;
  }
};
