import { size, space, themes } from '@sibimate/ui-tokens';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Text } from './Text';

export interface ScreenProps {
  /** `dark` is the helper (Earn) theme; customer screens are `light`. */
  theme?: keyof typeof themes;
  /** With a title the screen gets a top bar; `onBack` adds the back button beside it. */
  title?: string;
  onBack?: () => void;
  backLabel?: string;
  /** Pinned under the scrolling content, for the screen's main action. */
  footer?: ReactNode;
  children: ReactNode;
}

/** A screen on the theme's ground: scrolling content with `space-20` sides and `space-14` between blocks. */
export function Screen({ theme = 'light', title, onBack, backLabel, footer, children }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const colors = themes[theme];
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.ground }}
    >
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center' }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            gap: space[14],
            paddingHorizontal: space[20],
            paddingTop: insets.top + space[16],
            paddingBottom: space[24],
          }}
        >
          {title !== undefined ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[8], minHeight: size.control }}>
              {onBack ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={backLabel}
                  onPress={onBack}
                  hitSlop={8}
                  style={{
                    width: size.control,
                    height: size.control,
                    justifyContent: 'center',
                    marginLeft: -space[8],
                    alignItems: 'center',
                  }}
                >
                  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                    <Path
                      d="M15 18l-6-6 6-6"
                      stroke={colors.ink}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </Pressable>
              ) : null}
              <Text variant="titleMd" color={colors.ink} accessibilityRole="header" style={{ flex: 1 }}>
                {title}
              </Text>
            </View>
          ) : null}
          {children}
        </ScrollView>
        {footer ? (
          <View
            style={{
              gap: space[10],
              paddingHorizontal: space[20],
              paddingTop: space[10],
              paddingBottom: insets.bottom + space[16],
            }}
          >
            {footer}
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}
