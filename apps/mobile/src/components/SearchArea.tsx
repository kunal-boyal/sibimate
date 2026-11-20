import { SEARCH_AREA_STEPS_M } from '@sibimate/shared';
import { colors, radius, size, space } from '@sibimate/ui-tokens';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { errorKey, useT } from '@/lib/i18n';
import { formatDistance } from '@/lib/location';
import { api } from '@/lib/session';
import { Notice } from './Notice';
import { Text } from './Text';

/** How far the search for a helper reaches, with buttons to widen or narrow it. */
export function SearchArea({ taskId, radiusM }: { taskId: string; radiusM: number }) {
  const t = useT();
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (next: number) => api.setSearchArea(taskId, next),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const smaller = [...SEARCH_AREA_STEPS_M].reverse().find((step) => step < radiusM);
  const larger = SEARCH_AREA_STEPS_M.find((step) => step > radiusM);

  return (
    <View style={{ gap: space[8] }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[12],
          padding: space[12],
          borderRadius: radius[16],
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Step minus label={t('area.smaller')} disabled={!smaller || change.isPending} onPress={() => smaller && change.mutate(smaller)} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="caption" color={colors.inkMuted}>
            {t('area.label')}
          </Text>
          <Text variant="figure" color={colors.ink} accessibilityLiveRegion="polite">
            {formatDistance(radiusM)}
          </Text>
        </View>
        <Step label={t('area.larger')} disabled={!larger || change.isPending} onPress={() => larger && change.mutate(larger)} />
      </View>
      {change.isError ? <Notice variant="alert">{t(errorKey(change.error))}</Notice> : null}
    </View>
  );
}

function Step({ label, minus, disabled, onPress }: { label: string; minus?: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: size.controlMd,
        height: size.controlMd,
        borderRadius: size.controlMd / 2,
        borderWidth: 1,
        borderColor: colors.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <Path d={minus ? 'M5 12h14' : 'M12 5v14M5 12h14'} stroke={colors.ink} strokeWidth={2} strokeLinecap="round" />
      </Svg>
    </Pressable>
  );
}
