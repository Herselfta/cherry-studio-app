import { createNativeStackNavigator } from '@react-navigation/native-stack'
import React from 'react'

import BasicDataSettingsScreen from '@/screens/settings/data/BasicDataSettingsScreen'
import DataSettingsScreen from '@/screens/settings/data/DataSettingsScreen'
import LanTransferScreen from '@/screens/settings/data/LanTransfer/LanTransferScreen'
import WebDavScreen from '@/screens/settings/data/WebDavScreen'

export type DataSourcesStackParamList = {
  DataSettingsScreen: undefined
  BasicDataSettingsScreen: undefined
  LanTransferScreen: { redirectToHome?: boolean } | undefined
  WebDavScreen: { autoOpenRestoreSelection?: boolean } | undefined
}

const Stack = createNativeStackNavigator<DataSourcesStackParamList>()

export default function DataSourcesStackNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'ios_from_right',
        gestureEnabled: true,
        fullScreenGestureEnabled: true
      }}>
      <Stack.Screen name="DataSettingsScreen" component={DataSettingsScreen} />
      <Stack.Screen name="BasicDataSettingsScreen" component={BasicDataSettingsScreen} />
      <Stack.Screen name="LanTransferScreen" component={LanTransferScreen} />
      <Stack.Screen name="WebDavScreen" component={WebDavScreen} />
    </Stack.Navigator>
  )
}
