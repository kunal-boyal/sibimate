import { colors, radius, size, space } from '@sibimate/ui-tokens';
import { Pressable, View } from 'react-native';
import { Text } from './Text';

export interface ChoiceTilesProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** A labelled row of choice tiles where exactly one is selected. */
export function ChoiceTiles<T extends string>({ label, options, value, onChange }: ChoiceTilesProps<T>) {
  return (
    <View style={{ gap: space[8] }}>
      <Text variant="caption" weight={600} color={colors.inkMuted}>
        {label}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', gap: space[8] }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              onPress={() => onChange(option.value)}
              style={{
                flex: 1,
                minHeight: size.controlMd,
                paddingHorizontal: space[12],
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius[14],
                // The border stays 2px wide so the label does not shift when the choice changes.
                borderWidth: 2,
                borderColor: selected ? colors.brand : colors.borderStrong,
                backgroundColor: selected ? colors.brandSoft : colors.surface,
              }}
            >
              <Text variant="body" weight={selected ? 600 : 500} color={selected ? colors.brand : colors.ink}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
