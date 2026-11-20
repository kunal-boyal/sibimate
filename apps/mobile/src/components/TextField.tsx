import { colors, radius, size, space, textStyles } from '@sibimate/ui-tokens';
import { useState } from 'react';
import { Platform, TextInput, type TextInputProps, View } from 'react-native';
import { Text, fontFace } from './Text';

export interface TextFieldProps extends TextInputProps {
  label: string;
  /** Fixed text before the value, such as +91. */
  prefix?: string;
  /** Label colours for a field on the brand-green ground. */
  onBrand?: boolean;
  /** Sets the value in the display face with wide tracking, for one-time codes. */
  code?: boolean;
  /** Sets the prefix and value in the display face at 24px, for prices. */
  figure?: boolean;
}

/** The labelled 56px field of the design system. */
export function TextField({ label, prefix, onBrand, code, figure, style, onFocus, onBlur, ...rest }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const text = code ? textStyles.code : figure ? textStyles.figure : textStyles.bodyLg;
  const restingBorder = onBrand ? colors.surface : colors.border;
  return (
    <View style={{ gap: space[8] }}>
      <Text
        variant={onBrand ? 'bodySm' : 'caption'}
        weight={600}
        color={onBrand ? colors.onBrandMuted : colors.inkMuted}
      >
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[10],
          minHeight: size.controlXl,
          paddingHorizontal: space[16],
          borderRadius: radius[16],
          backgroundColor: colors.surface,
          borderWidth: 2,
          // On green the focus ring is marigold, as the system's focus outline is.
          borderColor: focused ? (onBrand ? colors.accent : colors.brand) : restingBorder,
        }}
      >
        {prefix ? (
          <>
            <Text variant={figure ? 'figure' : 'bodyLg'} weight={figure ? 700 : 600} color={colors.ink}>
              {prefix}
            </Text>
            {figure ? null : <View style={{ width: 1, height: 24, backgroundColor: colors.borderStrong }} />}
          </>
        ) : null}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.inkMuted}
          {...rest}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            {
              flex: 1,
              minWidth: 0,
              height: size.controlXl - 4,
              padding: 0,
              color: colors.ink,
              fontFamily: fontFace(text.family, text.fontWeight),
              fontSize: text.fontSize,
              letterSpacing: code ? textStyles.code.letterSpacing : undefined,
            },
            // The browser draws its own outline otherwise; the box already shows focus.
            Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
            style,
          ]}
        />
      </View>
    </View>
  );
}
