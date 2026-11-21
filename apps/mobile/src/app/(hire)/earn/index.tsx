import { HELPER_LOCATION_INTERVAL_SECONDS, type HelperBooking, type NearbyTask, formatRupees } from '@sibimate/shared';
import { colors, radius, size, space, themes } from '@sibimate/ui-tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Button } from '@/components/Button';
import { ModeToggle } from '@/components/ModeToggle';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StatusPill } from '@/components/StatusPill';
import { Text } from '@/components/Text';
import { errorKey, formatSlot, useT } from '@/lib/i18n';
import { formatDistance, getCurrentPoint } from '@/lib/location';
import { useLocationReporting } from '@/lib/use-location-reporting';
import { ApiClientError, api, useSession } from '@/lib/session';
import type { TranslationKey } from '@/locales/en';

const dark = themes.dark;

/** Earn mode home: go online, see tasks nearby, and follow the jobs you have. */
export default function EarnHome() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<TranslationKey | null>(null);

  const availability = useQuery({ queryKey: ['availability'], queryFn: api.getAvailability });
  const online = availability.data?.isOnline ?? false;
  const notHelper = availability.error instanceof ApiClientError && availability.error.code === 'forbidden';

  // Live updates refresh these lists at once; the slow timer covers a dropped connection.
  const nearby = useQuery({
    queryKey: ['nearby'],
    queryFn: api.listNearbyTasks,
    refetchInterval: 30_000,
    enabled: online,
  });
  const earnings = useQuery({ queryKey: ['earnings'], queryFn: api.getHelperEarnings, enabled: !notHelper });
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: api.listHelperBookings,
    refetchInterval: 30_000,
    enabled: !notHelper,
  });

  const toggle = useMutation({
    mutationFn: async (goOnline: boolean) => {
      if (!goOnline) {
        return api.setAvailability({ isOnline: false });
      }
      const location = await getCurrentPoint();
      if (!location) {
        throw new Error('location');
      }
      return api.setAvailability({ isOnline: true, location });
    },
    onMutate: () => setError(null),
    onSuccess: (data) => {
      queryClient.setQueryData(['availability'], data);
      void queryClient.invalidateQueries({ queryKey: ['nearby'] });
    },
    onError: (caught) => setError(caught instanceof ApiClientError ? errorKey(caught) : 'earn.locationNeeded'),
  });

  // While online, the app reports where the helper is about once a minute. It stops when they go offline or leave Earn.
  useLocationReporting(online, HELPER_LOCATION_INTERVAL_SECONDS);

  return (
    <Screen theme="dark">
      <ModeToggle mode="earn" />

      {notHelper ? (
        <>
          <Notice variant="accent">{t('earn.notHelper')}</Notice>
          <Button label={t('apply.link')} variant="accent" onPress={() => router.push('/earn/apply')} />
        </>
      ) : null}
      {!notHelper ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: online, busy: toggle.isPending }}
          accessibilityLabel={t('earn.online')}
          disabled={toggle.isPending || availability.isPending}
          onPress={() => toggle.mutate(!online)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: size.controlXl,
            paddingHorizontal: space[16],
            borderRadius: radius[18],
            backgroundColor: dark.surface,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="labelLg" color={dark.ink}>
              {t(online ? 'earn.online' : 'earn.offline')}
            </Text>
            {!online ? (
              <Text variant="caption" color={dark.inkMuted}>
                {t('earn.goOnlineHint')}
              </Text>
            ) : null}
          </View>
          {toggle.isPending ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <View
              style={{
                width: 52,
                height: 32,
                padding: 3,
                borderRadius: radius.pill,
                alignItems: online ? 'flex-end' : 'flex-start',
                backgroundColor: online ? colors.success : dark.borderStrong,
              }}
            >
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.onBrand }} />
            </View>
          )}
        </Pressable>
      ) : null}
      {error ? <Notice variant="alert">{t(error)}</Notice> : null}
      {earnings.data ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('earnings.title')}
          onPress={() => router.push('/earn/earnings')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: space[12],
            paddingHorizontal: space[16],
            paddingVertical: space[14],
            borderRadius: radius[18],
            backgroundColor: pressed ? dark.surfaceSunken : dark.surface,
          })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="labelLg" color={dark.ink}>
              {t('earnings.title')}
            </Text>
            <Text variant="caption" color={earnings.data.overLimit ? colors.accent : dark.inkMuted}>
              {earnings.data.overLimit
                ? t('earnings.overLimit', { limit: formatRupees(earnings.data.duesLimit) })
                : t('earnings.link', { amount: formatRupees(earnings.data.week) })}
            </Text>
          </View>
          <Text variant="labelLg" color={dark.inkMuted}>
            ›
          </Text>
        </Pressable>
      ) : null}

      {online ? (
        <>
          <Text variant="titleLg" color={dark.ink} accessibilityRole="header" style={{ marginTop: space[6] }}>
            {t('earn.nearby')}
          </Text>
          {nearby.data?.items.length === 0 ? (
            <Text variant="body" color={dark.inkMuted} style={{ lineHeight: 22 }}>
              {t('earn.noNearby')}
            </Text>
          ) : null}
          <View style={{ gap: space[10] }}>
            {nearby.data?.items.map((task) => (
              <NearbyCard
                key={task.id}
                task={task}
                onPress={() => router.push({ pathname: '/earn/task/[id]', params: { id: task.id } })}
              />
            ))}
          </View>
        </>
      ) : null}

      {jobs.data && jobs.data.items.length > 0 ? (
        <>
          <Text variant="titleSm" color={dark.ink} accessibilityRole="header" style={{ marginTop: space[10] }}>
            {t('earn.title')}
          </Text>
          <View style={{ gap: space[10] }}>
            {jobs.data.items.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onPress={() => router.push({ pathname: '/earn/[id]', params: { id: job.id } })}
              />
            ))}
          </View>
        </>
      ) : null}
      {!online && jobs.data?.items.length === 0 ? (
        <Text variant="body" color={dark.inkMuted} style={{ lineHeight: 22 }}>
          {t('earn.empty')}
        </Text>
      ) : null}
    </Screen>
  );
}

/** A card stays light on the dark ground, as in the design system. */
function Card({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        gap: space[10],
        padding: space[16],
        borderRadius: radius[18],
        backgroundColor: pressed ? colors.surfaceSunken : colors.ground,
      })}
    >
      {children}
    </Pressable>
  );
}

function NearbyCard({ task, onPress }: { task: NearbyTask; onPress: () => void }) {
  const t = useT();
  const language = useSession((state) => state.language);
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space[12] }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="labelLg" color={colors.ink} numberOfLines={2}>
            {task.title}
          </Text>
          <Text variant="caption" color={colors.inkMuted}>
            {[
              t('earn.away', { distance: formatDistance(task.distanceM) }),
              task.category,
              task.scheduleAt ? t('earn.at', { time: formatSlot(task.scheduleAt, language) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <Text variant="figure" color={colors.ink} style={{ fontSize: 22 }}>
          {formatRupees(task.customerPrice)}
        </Text>
      </View>
      {task.myOffer ? (
        <Text variant="caption" weight={600} color={colors.brand}>
          {t('earn.yourOffer', { amount: formatRupees(task.myOffer.price) })}
        </Text>
      ) : null}
    </Card>
  );
}

function JobCard({ job, onPress }: { job: HelperBooking; onPress: () => void }) {
  const t = useT();
  const language = useSession((state) => state.language);
  // A job booked for later shows its slot, so a helper with several can tell them apart.
  const slot = job.status === 'assigned' && job.scheduleAt ? formatSlot(job.scheduleAt, language) : null;
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space[12] }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="labelLg" color={colors.ink} numberOfLines={2}>
            {job.title}
          </Text>
          <Text variant="caption" color={colors.inkMuted}>
            {t('earn.youKeep')}
          </Text>
        </View>
        <Text variant="figure" color={colors.ink} style={{ fontSize: 22 }}>
          {formatRupees(job.netAmount)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[8] }}>
        <StatusPill status={job.status} />
        {slot ? (
          <Text variant="caption" weight={600} color={colors.ink}>
            {slot}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
