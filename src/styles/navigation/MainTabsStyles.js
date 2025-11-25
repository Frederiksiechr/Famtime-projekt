import { StyleSheet } from 'react-native';
import { colors } from '../theme';

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    borderTopColor: 'transparent',
    elevation: 0,
    shadowOpacity: 0,
  },
  tabBarBackground: {
    flex: 1,
    backgroundColor: colors.canvas,
    overflow: 'hidden',
  },
  tabBarShadow: {
    position: 'absolute',
    top: -24,
    left: 0,
    right: 0,
    height: 24,
    backgroundColor: 'rgba(75, 46, 18, 0.08)',
  },
  tabBarItem: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default styles;
