import { commissionFor, formatRupees } from '@sibimate/shared';
import { colors, radius, size, space, themes } from '@sibimate/ui-tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { errorKey, formatSlot, useT } from '@/lib/i18n';
import { api, useSession } from '@/lib/session';
import { formatDistance } from '@/lib/location';

const dark = themes.dark;
const STEP = 1000; // ₹10 in paise

/** A task the helper has been shown: take it at the customer's price, name a price, or pass. */
export default function NearbyTaskScreen() {
  const t = useT();
  const language = useSession((state) => state.language);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const nearby = useQuery({ queryKey: ['nearby'], queryFn: api.listNearbyTasks });
  const task = nearby.data?.items.find((item) => item.id === id);
  const [quote, setQuote] = useState<number | null>(null);
  const [sent, setSent] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/earn'));
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['nearby'] }),
      queryClient.invalidateQueries({ queryKey: ['jobs'] }),
    ]);

  const act = useMutation({
    mutationFn: (action: 'accept' | 'quote') =>
      action === 'accept' ? api.acceptTask(id) : api.quoteTask(id, quote ?? task!.customerPrice),
    onSuccess: async (result) => {
      await refresh();
      if (result.outcome === 'assigned' && result.bookingId) {
        router.replace({ pathname: '/earn/[id]', params: { id: result.bookingId } });
      } else {
        setSent(true);
      }
    },
  });
  const decline = useMutation({
    mutationFn: () => api.declineTask(id),
    onSuccess: async () => {
      await refresh();
      back();
    },
  });

  if (!task) {
    return (
      <Screen theme="dark" title="" onBack={back} backLabel={t('common.back')}>
        {nearby.isPending ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: space[40] }} />
        ) : (
          <Notice variant="alert">{t(nearby.isError ? errorKey(nearby.error) : 'earn.taskGone')}</Notice>
        )}
      </Screen>
    );
  }

  const price = quote ?? task.myOffer?.price ?? task.customerPrice;
  const keep = price - commissionFor(price, task.commissionBps);
  const amount = formatRupees(task.customerPrice);
  const busy = act.isPending || decline.isPending;

  return (
    <Screen
      theme="dark"
      title={task.title}
      onBack={back}
      backLabel={t('common.back')}
      footer={
        sent || task.myOffer ? (
          <>
            <Notice variant="accent">{t('earn.offerSent')}</Notice>
            <Button label={t('common.back')} variant="outlineOnBrand" size="md" onPress={back} />
          </>
        ) : (
          <>
            {act.isError || decline.isError ? (
              <Notice variant="alert">{t(errorKey(act.error ?? decline.error))}</Notice>
            ) : null}
            {price === task.customerPrice ? (
              <Button
                label={t(task.instant ? 'earn.accept' : 'earn.offerAtPrice', { amount })}
                variant="accent"
                loading={act.isPending}
                disabled={busy}
                onPress={() => act.mutate('accept')}
              />
            ) : (
              <Button
                label={t('earn.sendQuote', { amount: formatRupees(price) })}
                variant="accent"
                loading={act.isPending}
                disabled={busy}
                onPress={() => act.mutate('quote')}
              />
            )}
            <Button
              label={t('earn.notForMe')}
              variant="ghost"
              size="sm"
              textColor={dark.ink}
              disabled={busy}
              onPress={() => decline.mutate()}
            />
          </>
        )
      }
    >
      <Text variant="bodySm" color={dark.inkMuted}>
        {[
          t('earn.away', { distance: formatDistance(task.distanceM) }),
          task.category,
          task.scheduleAt
            ? t('earn.at', { time: formatSlot(task.scheduleAt, language) })
            : t('earn.now'),
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>

      {task.helpersNeeded > 1 ? (
        <Notice variant="accent">{t('earn.team', { count: task.helpersNeeded })}</Notice>
      ) : null}

      <View style={{ gap: space[10], padding: space[16], borderRadius: radius[18], backgroundColor: dark.surface }}>
        <Text variant="body" color={dark.ink} style={{ lineHeight: 22 }}>
          {task.description}
        </Text>
        <Text variant="caption" color={dark.inkMuted}>
          {t('earn.addressLater')}
        </Text>
      </View>

      <View style={{ gap: space[12], padding: 18, borderRadius: radius[20], backgroundColor: dark.surface }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text variant="bodySm" color={dark.inkMuted}>
            {t('earn.customerOffers')}
          </Text>
          <Text variant="labelLg" color={dark.ink}>
            {amount}
          </Text>
        </View>
        {!task.instant ? (
          <Text variant="caption" color={dark.inkMuted}>
            {t('earn.skilledNote')}
          </Text>
        ) : null}

        {!task.myOffer && !sent ? (
          <>
            <View style={{ height: 1, backgroundColor: dark.border }} />
            <Text variant="body" weight={600} color={dark.ink}>
              {t('earn.orQuote')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <StepButton
                label={t('earn.lower')}
                minus
                disabled={price - STEP < 100}
                onPress={() => setQuote(price - STEP)}
              />
              <Text variant="displayXl" color={colors.accent} accessibilityLiveRegion="polite">
                {formatRupees(price)}
              </Text>
              <StepButton label={t('earn.raise')} onPress={() => setQuote(price + STEP)} />
            </View>
          </>
        ) : null}
        <Text variant="bodySm" color={dark.inkMuted}>
          {t('earn.keepAt', { amount: formatRupees(keep), percent: task.commissionBps / 100 })}
        </Text>
      </View>
    </Screen>
  );
}

function StepButton({
  label,
  minus,
  disabled,
  onPress,
}: {
  label: string;
  minus?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: size.controlLg,
        height: size.controlLg,
        borderRadius: size.controlLg / 2,
        borderWidth: 1,
        borderColor: dark.borderStrong,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
        <Path d={minus ? 'M5 12h14' : 'M12 5v14M5 12h14'} stroke={dark.ink} strokeWidth={2} strokeLinecap="round" />
      </Svg>
    </Pressable>
  );
}
