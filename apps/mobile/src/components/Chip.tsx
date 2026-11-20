import { colors, radius, size, space } from '@sibimate/ui-tokens';
import { Pressable } from 'react-native';
import { Text } from './Text';

/** A pill that fills in or filters something. */
export function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: size.control,
        paddingHorizontal: space[16],
        justifyContent: 'center',
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.borderStrong,
        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
      })}
    >
      <Text variant="bodySm" weight={500} color={colors.ink}>
        {label}
      </Text>
    </Pressable>
  );
}
