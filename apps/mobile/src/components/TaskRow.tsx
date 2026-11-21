import { type Task, formatRupees } from '@sibimate/shared';
import { colors, radius, space } from '@sibimate/ui-tokens';
import { Pressable, View } from 'react-native';
import { StatusPill } from './StatusPill';
import { Text } from './Text';

/** One of the customer's tasks in a list: title, price and status, and its date when `date` is given. */
export function TaskRow({ task, date, onPress }: { task: Task; date?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        gap: space[8],
        padding: space[16],
        borderRadius: radius[16],
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space[12] }}>
        <Text variant="labelLg" color={colors.ink} style={{ flex: 1 }} numberOfLines={2}>
          {task.title}
        </Text>
        <Text variant="figure" color={colors.ink} style={{ fontSize: 20 }}>
          {formatRupees(task.customerPrice)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[8] }}>
        <StatusPill status={task.status} />
        {date ? (
          <Text variant="caption" color={colors.inkMuted}>
            {date}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
