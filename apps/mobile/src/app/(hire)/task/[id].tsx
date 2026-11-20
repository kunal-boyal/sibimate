import { ACTIVE_TASK_STATUSES, canTransitionTask, formatRupees } from '@sibimate/shared';
import { colors, radius, space } from '@sibimate/ui-tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { CodeCard } from '@/components/CodeCard';
import { SearchArea } from '@/components/SearchArea';
import { DisputeSection } from '@/components/DisputeSection';
import { RatingPrompt } from '@/components/RatingPrompt';
import { TrackingMap } from '@/components/TrackingMap';
import { distanceBetween, formatDistance } from '@/lib/location';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StatusPill } from '@/components/StatusPill';
import { Text } from '@/components/Text';
import { errorKey, formatPhone, useT } from '@/lib/i18n';
import { api, useSession } from '@/lib/session';

const NOTED = ['matching', 'assigned', 'en_route', 'paid', 'cancelled', 'expired'] as const;

export default function TaskScreen() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const language = useSession((state) => state.language);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [confirming, setConfirming] = useState(false);

  const query = useQuery({
    queryKey: ['tasks', id],
    queryFn: () => api.getTask(id),
    // Until live updates arrive with matching, an open task checks for news every 10 seconds.
    refetchInterval: (latest) =>
      latest.state.data && ACTIVE_TASK_STATUSES.includes(latest.state.data.status) ? 30_000 : false,
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelTask(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    onSuccess: () => setConfirming(false),
  });

  // While the task is looking for a helper, helpers' offers are checked along with it.
  const matching = query.data?.status === 'matching';
  const offers = useQuery({
    queryKey: ['tasks', id, 'offers'],
    queryFn: () => api.listTaskOffers(id),
    enabled: matching,
    refetchInterval: 30_000,
  });
  const choose = useMutation({
    mutationFn: (offerId: string) => api.chooseOffer(id, offerId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const retry = useMutation({
    mutationFn: () => api.retryTask(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

  // Live positions arrive over the live connection; until one does, the position the task came with is used.
  const moved = useQuery<{ lat: number; lng: number } | null>({
    queryKey: ['helperLocation', id],
    queryFn: () => null,
    enabled: false,
  });

  const goHome = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const task = query.data;

  if (!task) {
    return (
      <Screen title="" onBack={goHome} backLabel={t('common.back')}>
        {query.isError ? (
          <>
            <Notice variant="alert">{`${t('task.loadFailed')} ${t(errorKey(query.error))}`}</Notice>
            <Button label={t('task.retry')} variant="secondary" size="md" onPress={() => void query.refetch()} />
          </>
        ) : (
          <ActivityIndicator color={colors.brand} style={{ marginTop: space[40] }} />
        )}
      </Screen>
    );
  }

  const cancellable = canTransitionTask(task.status, 'cancelled', 'customer');
  const note = NOTED.find((status) => status === task.status);
  const booking = task.booking;
  const helperAt = task.status === 'en_route' ? (moved.data ?? booking?.helperLocation ?? null) : null;
  const helperName = booking ? (booking.helper.name ?? formatPhone(booking.helper.phone)) : '';

  return (
    <Screen
      title={task.title}
      onBack={goHome}
      backLabel={t('common.back')}
      footer={
        cancellable ? (
          confirming ? (
            <>
              <Notice variant="alert">{cancel.isError ? t(errorKey(cancel.error)) : t('task.cancelConfirm')}</Notice>
              <View style={{ flexDirection: 'row', gap: space[8] }}>
                <Button
                  label={t('task.cancelNo')}
                  variant="secondary"
                  size="md"
                  style={{ flex: 1 }}
                  onPress={() => setConfirming(false)}
                />
                <Button
                  label={t('task.cancelYes')}
                  variant="danger"
                  size="md"
                  style={{ flex: 1 }}
                  loading={cancel.isPending}
                  onPress={() => cancel.mutate()}
                />
              </View>
            </>
          ) : (
            <Button label={t('task.cancel')} variant="danger" size="md" onPress={() => setConfirming(true)} />
          )
        ) : (
          <Button label={t('task.backHome')} variant="secondary" size="md" onPress={goHome} />
        )
      }
    >
      <StatusPill status={task.status} />
      {note ? <Notice variant="accent">{t(`statusNote.${note}`)}</Notice> : null}
      {task.status === 'posted' && task.scheduleAt ? (
        <Notice variant="accent">
          {t('when.scheduledNote', {
            time: new Date(task.scheduleAt).toLocaleString(language === 'hi' ? 'hi-IN' : 'en-IN', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            }),
          })}
        </Notice>
      ) : null}
      {task.status === 'matching' ? <SearchArea taskId={task.id} radiusM={task.searchRadiusM} /> : null}

      {task.status === 'expired' ? (
        <Button label={t('task.postAgain')} loading={retry.isPending} onPress={() => retry.mutate()} />
      ) : null}
      {retry.isError ? <Notice variant="alert">{t(errorKey(retry.error))}</Notice> : null}

      {matching ? (
        <View style={{ gap: space[10] }}>
          <Text variant="caption" weight={600} color={colors.inkMuted} accessibilityRole="header">
            {t('task.offers')}
          </Text>
          {choose.isError ? <Notice variant="alert">{t(errorKey(choose.error))}</Notice> : null}
          {offers.data?.items.length === 0 ? (
            <Text variant="bodySm" color={colors.inkMuted}>
              {t('task.noOffers')}
            </Text>
          ) : null}
          {offers.data?.items.map((offer) => {
            const name = offer.helper.name ?? t('task.helper');
            const amount = formatRupees(offer.price);
            return (
              <View
                key={offer.id}
                style={{
                  gap: space[12],
                  padding: space[16],
                  borderRadius: radius[20],
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: space[12],
                  }}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text variant="labelLg" color={colors.ink}>
                      {name}
                    </Text>
                    <Text variant="caption" color={colors.inkMuted}>
                      {[
                        offer.helper.skillTag === 'skilled' ? t('task.skilled') : null,
                        offer.helper.rating !== null
                          ? t('rating.value', { rating: offer.helper.rating.toFixed(1) })
                          : null,
                        offer.helper.completedCount > 0
                          ? offer.helper.completedCount === 1
                            ? t('task.jobsDoneOne')
                            : t('task.jobsDone', { count: offer.helper.completedCount })
                          : t('task.newHelper'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {offer.etaMin ? (
                      <Text variant="bodySm" color={colors.ink}>
                        {t('task.eta', { minutes: offer.etaMin })}
                      </Text>
                    ) : null}
                  </View>
                  <Text variant="figure" color={colors.ink}>
                    {amount}
                  </Text>
                </View>
                <Button
                  label={t('task.choose')}
                  accessibilityLabel={t('task.chooseLabel', { name, amount })}
                  size="sm"
                  loading={choose.isPending && choose.variables === offer.id}
                  disabled={choose.isPending}
                  onPress={() => choose.mutate(offer.id)}
                />
              </View>
            );
          })}
        </View>
      ) : null}

      {helperAt ? (
        <>
          <TrackingMap pickup={task.pickup} helper={helperAt} />
          <Text variant="bodySm" weight={600} color={colors.ink} accessibilityLiveRegion="polite">
            {t('task.helperAway', {
              name: helperName,
              distance: formatDistance(distanceBetween(helperAt, task.pickup)),
            })}
          </Text>
        </>
      ) : null}

      {booking ? (
        <DisputeSection
          bookingId={booking.id}
          canDispute={booking.canDispute}
          dispute={booking.dispute}
          openLabel="dispute.report"
        />
      ) : null}

      {booking && task.status === 'paid' && booking.myRating === null ? (
        <RatingPrompt bookingId={booking.id} question={t('rating.askHelper', { name: helperName })} />
      ) : null}

      {booking?.startCode ? (
        <CodeCard
          title={t('task.startCode')}
          note={t('task.startCodeNote', { name: helperName })}
          code={booking.startCode}
        />
      ) : null}
      {booking?.completionCode ? (
        <CodeCard
          title={t('task.completionCode')}
          note={t('task.completionCodeNote', { name: helperName })}
          code={booking.completionCode}
        />
      ) : null}
      {booking && task.status === 'completed' ? (
        <Notice variant="accent">
          {t('task.payCash', { name: helperName, amount: formatRupees(booking.agreedPrice) })}
        </Notice>
      ) : null}

      {booking ? (
        <View
          style={{
            gap: space[10],
            padding: space[16],
            borderRadius: radius[20],
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text variant="caption" weight={600} color={colors.inkMuted}>
            {t('task.helper')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[12] }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.brandSoft,
              }}
            >
              <Text variant="bodyLg" weight={700} color={colors.brand} style={{ fontFamily: 'SpaceGrotesk_700Bold' }}>
                {helperName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="labelLg" color={colors.ink}>
                {helperName}
              </Text>
              {booking.helper.skillTag === 'skilled' ? (
                <Text variant="caption" weight={600} color={colors.brand}>
                  {t('task.skilled')}
                </Text>
              ) : null}
            </View>
          </View>
          {task.status !== 'paid' ? (
            <Button
              label={t('task.callHelper', { name: helperName })}
              variant="secondary"
              size="sm"
              onPress={() => void Linking.openURL(`tel:${booking.helper.phone}`)}
            />
          ) : null}
        </View>
      ) : null}

      <View
        style={{
          gap: space[12],
          padding: space[16],
          borderRadius: radius[20],
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text variant="body" color={colors.ink} style={{ lineHeight: 22 }}>
          {task.description}
        </Text>
        <View style={{ height: 1, backgroundColor: colors.border }} />
        {/* Once a helper is confirmed, the price that counts is the one agreed with them. */}
        <Row
          label={t(booking ? 'task.agreedPrice' : 'task.price')}
          value={formatRupees(booking?.agreedPrice ?? task.customerPrice)}
          figure
        />
        {task.category ? <Row label={t('confirm.category')} value={task.category.name} /> : null}
        <Row
          label={t('confirm.helpers')}
          value={
            task.helpersNeeded === 1 ? t('confirm.helpersOne') : t('confirm.helpersMany', { count: task.helpersNeeded })
          }
        />
        <Row label={t('task.payment')} value={t(`task.${task.paymentMethod}`)} />
        <Row label={t('task.address')} value={task.address} />
      </View>
    </Screen>
  );
}

function Row({ label, value, figure }: { label: string; value: string; figure?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space[16] }}>
      <Text variant="caption" color={colors.inkMuted}>
        {label}
      </Text>
      <Text
        variant={figure ? 'figure' : 'bodySm'}
        weight={figure ? 700 : 600}
        color={colors.ink}
        style={{ flex: 1, textAlign: 'right' }}
      >
        {value}
      </Text>
    </View>
  );
}
