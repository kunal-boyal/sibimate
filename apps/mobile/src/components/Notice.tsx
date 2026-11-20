import { colors, radius, space } from '@sibimate/ui-tokens';
import { View } from 'react-native';
import { Text } from './Text';

const VARIANTS = {
  accent: { background: colors.accentSoft, text: colors.onAccentSoft },
  alert: { background: colors.alertSoft, text: colors.alertInk },
} as const;

/** A short message in a soft fill. `alert` is announced to screen readers when it appears. */
export function Notice({ variant, children }: { variant: keyof typeof VARIANTS; children: string }) {
  const v = VARIANTS[variant];
  return (
    <View
      accessibilityRole={variant === 'alert' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={{
        paddingVertical: space[12],
        paddingHorizontal: space[14],
        borderRadius: radius[14],
        backgroundColor: v.background,
      }}
    >
      <Text variant="caption" weight={500} color={v.text}>
        {children}
      </Text>
    </View>
  );
}
