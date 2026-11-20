import { colors } from '@sibimate/ui-tokens';
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.brand },
      }}
    />
  );
}
