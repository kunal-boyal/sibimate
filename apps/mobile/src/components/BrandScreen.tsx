import { colors, space } from '@sibimate/ui-tokens';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The full-bleed brand-green screen used for welcome and sign-in. Its two
 * children sit at the top and the bottom, and the screen scrolls when the
 * keyboard or large text leaves too little room.
 */
export function BrandScreen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.brand }}
    >
      <StatusBar style="light" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'space-between',
          gap: space[32],
          paddingHorizontal: space[24],
          paddingTop: insets.top + space[24],
          paddingBottom: insets.bottom + space[28],
          // Keeps the phone layout when the web build is opened in a wide window.
          width: '100%',
          maxWidth: 480,
          alignSelf: 'center',
        }}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
