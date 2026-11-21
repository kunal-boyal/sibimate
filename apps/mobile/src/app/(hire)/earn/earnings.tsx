import { type HelperEarnings, formatRupees } from '@sibimate/shared';
import { colors, radius, space, themes } from '@sibimate/ui-tokens';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { errorKey, useT } from '@/lib/i18n';
import { api, useSession } from '@/lib/session';

const dark = themes.dark;

/** What a helper has earned, the commission they owe from cash jobs, and their paid jobs. */
export default function Earnings() {
  const t = useT();
  const router = useRouter();
  const earnings = useQuery({ queryKey: ['earnings'], queryFn: api.getHelperEarnings, refetchInterval: 60_000 });
  const back = () => (router.canGoBack() ? router.back() : router.replace('/earn'));
  const data = earnings.data;

  return (
    <Screen theme="dark" title={t('earnings.title')} onBack={back} backLabel={t('common.back')}>
      {earnings.isError ? <Notice variant="alert">{t(errorKey(earnings.error))}</Notice> : null}
      {!data && !earnings.isError ? <ActivityIndicator color={colors.accent} style={{ marginTop: space[40] }} /> : null}
      {data ? <Summary data={data} /> : null}
    </Screen>
  );
}

function Summary({ data }: { data: HelperEarnings }) {
  const t = useT();
  const language = useSession((state) => state.language);
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(language === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' });
  const limit = formatRupees(data.duesLimit);

  return (
    <>
      <View style={{ gap: space[12], padding: space[16], borderRadius: radius[18], backgroundColor: colors.ground }}>
        <View style={{ gap: 2 }}>
          <Text variant="caption" color={colors.inkMuted}>
            {t('earnings.week')}
          </Text>
          <Text variant="figure" color={colors.ink} style={{ fontSize: 34 }}>
            {formatRupees(data.week)}
          </Text>
          <Text variant="caption" color={colors.inkMuted}>
            {t('earnings.afterCommission')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: space[12] }}>
          {(
            [
              ['earnings.today', data.today],
              ['earnings.month', data.month],
              ['earnings.total', data.total],
            ] as const
          ).map(([label, amount]) => (
            <View key={label} style={{ flex: 1, gap: 2 }}>
              <Text variant="caption" color={colors.inkMuted}>
                {t(label)}
              </Text>
              <Text variant="labelLg" color={colors.ink}>
                {formatRupees(amount)}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="bodySm" color={colors.inkMuted}>
          {data.jobsDone === 1 ? t('earnings.jobsOne') : t('earnings.jobs', { count: data.jobsDone })}
        </Text>
      </View>

      <View style={{ gap: space[8], padding: space[16], borderRadius: radius[18], backgroundColor: dark.surface }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space[12] }}>
          <Text variant="labelLg" color={dark.ink}>
            {t('earnings.dues')}
          </Text>
          <Text variant="figure" color={data.overLimit ? colors.accent : dark.ink} style={{ fontSize: 22 }}>
            {formatRupees(data.duesOwed)}
          </Text>
        </View>
        <Text variant="bodySm" color={dark.inkMuted} style={{ lineHeight: 20 }}>
          {data.duesOwed === 0 ? t('earnings.noDues') : t('earnings.duesNote', { limit })}
        </Text>
      </View>
      {data.overLimit ? <Notice variant="alert">{t('earnings.overLimit', { limit })}</Notice> : null}

      <Text variant="titleSm" color={dark.ink} accessibilityRole="header" style={{ marginTop: space[6] }}>
        {t('earnings.recent')}
      </Text>
      {data.recent.length === 0 ? (
        <Text variant="body" color={dark.inkMuted}>
          {t('earnings.none')}
        </Text>
      ) : null}
      <View style={{ gap: space[8] }}>
        {data.recent.map((job) => (
          <View
            key={job.bookingId}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: space[12],
              padding: space[14],
              borderRadius: radius[16],
              backgroundColor: dark.surface,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="labelLg" color={dark.ink} numberOfLines={2}>
                {job.title}
              </Text>
              <Text variant="caption" color={dark.inkMuted}>
                {day(job.paidAt)} · {t(job.paymentMethod === 'cash' ? 'earnings.cash' : 'earnings.upi')}
              </Text>
            </View>
            <Text variant="labelLg" color={dark.ink}>
              {t('earnings.kept', { amount: formatRupees(job.netAmount) })}
            </Text>
          </View>
        ))}
      </View>
    </>
  );
}
