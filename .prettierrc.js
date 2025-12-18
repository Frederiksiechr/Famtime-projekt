/**
 * PRETTIER CONFIGURATION
 *
 * Prettier formatter-indstillinger for kode-formatering:
 * - Enkeltanførselstegn i stedet for dobbelte
 * - Kommaer efter sidste element (ES5-kompatibilitet)
 * - Linjebredde på 80 tegn for lesbarhed
 */
module.exports = {
  // Anvend enkeltanførselstegn (') i stedet for dobbelte (")
  singleQuote: true,

  // Tilføj kommaer efter sidste element i multi-line-arrays/objekter
  trailingComma: 'es5',

  // Maksimal linjebredde før linjebrydes (80 tegn)
  printWidth: 80,
};
