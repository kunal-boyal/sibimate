import { colors, radius, size, space, themes } from '@sibimate/ui-tokens';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useT } from '@/lib/i18n';
import { Text } from './Text';

/**
 * The Hire and Earn switch. It only changes what the app shows: the API checks
 * the helper role on every helper route.
 */
export function ModeToggle({ mode }: { mode: 'hire' | 'earn' }) {
  const t = useT();
  const router = useRouter();
  const dark = mode === 'earn';
  const theme = dark ? themes.dark : themes.light;
  return (
    <View
      accessibilityRole="radiogroup"
      style={{
        flexDirection: 'row',
        alignSelf: 'flex-end',
        padding: space[4],
        borderRadius: radius.pill,
        backgroundColor: theme.surfaceSunken,
      }}
    >
      {(['hire', 'earn'] as const).map((option) => {
        const on = option === mode;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(`mode.${option}`)}
            onPress={() => {
              if (!on) {
                router.replace(option === 'earn' ? '/earn' : '/');
              }
            }}
            style={{
              minHeight: size.controlSm,
              paddingHorizontal: space[16],
              justifyContent: 'center',
              borderRadius: radius.pill,
              // The selected side is brand green in Hire and marigold in Earn.
              backgroundColor: on ? (dark ? colors.accent : colors.brand) : 'transparent',
            }}
          >
            <Text variant="bodySm" weight={600} color={on ? (dark ? colors.onAccent : colors.onBrand) : theme.ink}>
              {t(`mode.${option}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
