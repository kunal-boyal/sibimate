import type { TaskStatus } from '@sibimate/shared';
import { colors, radius, space } from '@sibimate/ui-tokens';
import { View } from 'react-native';
import { useT } from '@/lib/i18n';
import { Text } from './Text';

const TONES = {
  live: { background: colors.brandSoft, text: colors.brand },
  waiting: { background: colors.accentSoft, text: colors.onAccentSoft },
  alert: { background: colors.alertSoft, text: colors.alertInk },
  done: { background: colors.surfaceSunken, text: colors.ink },
} as const;

const TONE_BY_STATUS: Record<TaskStatus, keyof typeof TONES> = {
  draft: 'done',
  posted: 'waiting',
  matching: 'waiting',
  assigned: 'live',
  en_route: 'live',
  in_progress: 'live',
  completed: 'live',
  paid: 'done',
  closed: 'done',
  expired: 'alert',
  cancelled: 'done',
  disputed: 'alert',
};

/** A task's status as a word in a soft fill; the colour is never the only cue. */
export function StatusPill({ status }: { status: TaskStatus }) {
  const t = useT();
  const tone = TONES[TONE_BY_STATUS[status]];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingVertical: 5,
        paddingHorizontal: space[10],
        borderRadius: radius.pill,
        backgroundColor: tone.background,
      }}
    >
      <Text variant="caption" weight={600} color={tone.text}>
        {t(`status.${status}`)}
      </Text>
    </View>
  );
}
