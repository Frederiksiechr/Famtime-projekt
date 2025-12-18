/**
 * MAIN TABS STYLES
 *
 * Styling til bottom tab navigation med custom design:
 * - Transparent tab bar med custom background og shadow
 * - Tab bar items og icon wrappers
 * - Shadow-effekt over tab bar
 */
import { StyleSheet } from 'react-native';
import { colors } from '../theme';

const styles = StyleSheet.create({
  /**
   * TAB BAR
   * Transparent tab bar med custom positioning og no default border/shadow
   */
  tabBar: {
    position: 'absolute',
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    borderTopColor: 'transparent',
    elevation: 0,
    shadowOpacity: 0,
  },
  
  /**
   * TAB BAR BACKGROUND
   * Baggrund container for tab bar med canvas-farve
   */
  tabBarBackground: {
    flex: 1,
    backgroundColor: colors.canvas,
    overflow: 'hidden',
  },
  
  /**
   * TAB BAR SHADOW
   * Subtil skygge over tab bar ved at positionere shadow-gradient ovenpå
   */
  tabBarShadow: {
    position: 'absolute',
    top: -24,
    left: 0,
    right: 0,
    height: 24,
    backgroundColor: 'rgba(75, 46, 18, 0.08)',
  },
  
  /**
   * TAB BAR ITEM
   * Enkelt tab-item med centered content
   */
  tabBarItem: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  /**
   * ICON WRAPPER
   * Wrapper omkring ikonerne for at centrere dem korrekt
   */
  iconWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default styles;
