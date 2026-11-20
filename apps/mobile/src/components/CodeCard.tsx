import { colors, radius, space } from '@sibimate/ui-tokens';
import { View } from 'react-native';
import { Text } from './Text';

/** The start or completion code the customer reads out to the helper, on brand green. */
export function CodeCard({ title, note, code }: { title: string; note: string; code: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[12],
        paddingVertical: space[14],
        paddingHorizontal: space[16],
        borderRadius: radius[16],
        backgroundColor: colors.brand,
      }}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text variant="body" weight={600} color={colors.onBrand}>
          {title}
        </Text>
        <Text variant="caption" color={colors.onBrandMuted}>
          {note}
        </Text>
      </View>
      {/* Read digit by digit by screen readers. */}
      <Text variant="code" color={colors.accent} accessibilityLabel={code.split('').join(' ')}>
        {code}
      </Text>
    </View>
  );
}
