import { colors, radius, size as controlSize, space } from '@sibimate/ui-tokens';
import { ActivityIndicator, Pressable, type PressableProps, type ViewStyle } from 'react-native';
import { Text } from './Text';

// Variants and sizes follow the Button component of the design system.
const VARIANTS = {
  primary: {
    background: colors.brand,
    pressed: colors.brandPressed,
    text: colors.onBrand,
    weight: 600,
  },
  accent: {
    background: colors.accent,
    pressed: colors.accentHover,
    text: colors.onAccent,
    weight: 700,
  },
  secondary: {
    background: colors.surface,
    pressed: colors.ground,
    text: colors.ink,
    weight: 600,
    border: colors.borderStrong,
    borderWidth: 1,
  },
  outlineOnBrand: {
    background: 'transparent',
    pressed: colors.brandPressed,
    text: colors.onBrand,
    weight: 600,
    border: colors.brandLine,
    borderWidth: 1.5,
  },
  danger: {
    background: colors.surface,
    pressed: colors.alertSoft,
    text: colors.danger,
    weight: 600,
    border: colors.danger,
    borderWidth: 1.5,
  },
  ghost: {
    background: 'transparent',
    pressed: 'transparent',
    text: colors.ink,
    weight: 600,
  },
} as const satisfies Record<
  string,
  {
    background: string;
    pressed: string;
    text: string;
    weight: 600 | 700;
    border?: string;
    borderWidth?: number;
  }
>;

const SIZES = {
  lg: {
    minHeight: controlSize.controlXl,
    borderRadius: radius[16],
    text: 'bodyLg',
  },
  md: {
    minHeight: controlSize.controlLg,
    borderRadius: radius[14],
    text: 'body',
  },
  sm: {
    minHeight: controlSize.control,
    borderRadius: radius[12],
    text: 'body',
  },
} as const;

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  /** Shows a spinner and ignores presses. */
  loading?: boolean;
  /** Overrides the label colour, for a ghost button on a coloured ground. */
  textColor?: string;
  style?: ViewStyle;
}

export function Button({
  label,
  variant = 'primary',
  size = 'lg',
  loading,
  disabled,
  textColor,
  style,
  ...rest
}: ButtonProps) {
  const v: (typeof VARIANTS)[keyof typeof VARIANTS] & {
    border?: string;
    borderWidth?: number;
  } = VARIANTS[variant];
  const s = SIZES[size];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      accessibilityLabel={label}
      {...rest}
      style={({ pressed }) => [
        {
          minHeight: s.minHeight,
          borderRadius: s.borderRadius,
          paddingHorizontal: space[20],
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? v.pressed : v.background,
          borderColor: v.border,
          borderWidth: v.borderWidth,
          opacity: disabled && !loading ? 0.5 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor ?? v.text} />
      ) : (
        <Text variant={s.text} weight={v.weight} color={textColor ?? v.text}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}
