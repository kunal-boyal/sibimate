import { type TextStyle, type TextStyleName, fontFamilies, textStyles } from '@sibimate/ui-tokens';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

const WEIGHT_NAMES = {
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
} as const;

/** The name a face was loaded under in the root layout, for example Inter_600SemiBold. */
export function fontFace(family: keyof typeof fontFamilies, weight: TextStyle['fontWeight']) {
  return `${fontFamilies[family].replace(' ', '')}_${weight}${WEIGHT_NAMES[weight]}`;
}

export interface TextProps extends RNTextProps {
  /** A text style from the design system. */
  variant?: TextStyleName;
  /** Overrides the style's weight, where the system allows a heavier label. */
  weight?: TextStyle['fontWeight'];
  color: string;
}

export function Text({ variant = 'body', weight, color, style, ...rest }: TextProps) {
  const spec: TextStyle = textStyles[variant];
  return (
    <RNText
      {...rest}
      style={[
        {
          color,
          fontFamily: fontFace(spec.family, weight ?? spec.fontWeight),
          fontSize: spec.fontSize,
          lineHeight: spec.lineHeight,
          letterSpacing: spec.letterSpacing,
          textTransform: spec.uppercase ? 'uppercase' : undefined,
        },
        style,
      ]}
    />
  );
}
