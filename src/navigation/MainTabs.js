/**
 * MainTabs
 *
 * - Bundnavigation for hovedoplevelsen efter opsætning.
 * - Indeholder faner til personlig kalender, familieevents og konto/indstillinger.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import OwnCalendarScreen from '../screens/OwnCalendarScreen';
import FamilyEventsScreen from '../screens/FamilyEventsScreen';
import AccountSettingsScreen from '../screens/AccountSettingsScreen';
import { colors } from '../styles/theme';

const Tab = createBottomTabNavigator();

const getIconName = (routeName, focused) => {
  switch (routeName) {
    case 'OwnCalendar':
      return focused ? 'calendar' : 'calendar-outline';
    case 'FamilyEvents':
      return focused ? 'people' : 'people-outline';
    case 'AccountSettings':
      return focused ? 'settings' : 'settings-outline';
    default:
      return 'ellipse';
  }
};

const MainTabs = () => {
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 0);
  const basePadding = 12;
  const splitInset = safeBottom / 2;
  const baseHeight = 60;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedText,
        tabBarShowLabel: false,
        tabBarStyle: [
          styles.tabBar,
          {
            height: baseHeight + safeBottom,
            paddingTop: basePadding + splitInset,
            paddingBottom: basePadding + splitInset,
          },
        ],
        tabBarItemStyle: styles.tabBarItem,
        tabBarBackground: () => (
          <View style={styles.tabBarBackground}>
            <View style={styles.tabBarShadow} />
          </View>
        ),
        safeAreaInsets: { bottom: 0 },
        tabBarIcon: ({ focused, color, size }) => (
          <View style={styles.iconWrapper}>
            <Ionicons
              name={getIconName(route.name, focused)}
              size={size}
              color={color}
            />
          </View>
        ),
      })}
    >
      <Tab.Screen
        name="OwnCalendar"
        component={OwnCalendarScreen}
        options={{ title: 'Min kalender' }}
      />
      <Tab.Screen
        name="FamilyEvents"
        component={FamilyEventsScreen}
        options={{ title: 'Familieevents' }}
      />
      <Tab.Screen
        name="AccountSettings"
        component={AccountSettingsScreen}
        options={{ title: 'Konto' }}
      />
    </Tab.Navigator>
  );
};

export default MainTabs;

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
