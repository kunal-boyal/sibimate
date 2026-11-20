import { BOOKING_CODE_LENGTH, type HelperBooking, formatRupees } from '@sibimate/shared';
import { colors, radius, space, themes } from '@sibimate/ui-tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { RatingPrompt } from '@/components/RatingPrompt';
import { Screen } from '@/components/Screen';
import { StatusPill } from '@/components/StatusPill';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { errorKey, formatPhone, useT } from '@/lib/i18n';
import { api } from '@/lib/session';
import { useLocationReporting } from '@/lib/use-location-reporting';

const dark = themes.dark;
type Step = Parameters<typeof api.bookingStep>[1];

/** One job in Earn mode: what to do, what it pays, and the next step. */
export default function Job() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [code, setCode] = useState('');
  const [givingUp, setGivingUp] = useState(false);

  const query = useQuery({ queryKey: ['jobs', id], queryFn: () => api.getHelperBooking(id), refetchInterval: 30_000 });
  const step = useMutation({
    mutationFn: (next: Step) => api.bookingStep(id, next, next === 'start' || next === 'complete' ? code : undefined),
    onSuccess: (job) => {
      queryClient.setQueryData(['jobs', id], job);
      setCode('');
      setGivingUp(false);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  // On the way to the customer, the helper's position is shared with them every 15 seconds.
  useLocationReporting(query.data?.status === 'en_route', 15);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/earn'));
  const job = query.data;
  if (!job) {
    return (
      <Screen theme="dark" title="" onBack={back} backLabel={t('common.back')}>
        {query.isError ? (
          <Notice variant="alert">{t(errorKey(query.error))}</Notice>
        ) : (
          <ActivityIndicator color={colors.accent} style={{ marginTop: space[40] }} />
        )}
      </Screen>
    );
  }

  const amount = formatRupees(job.agreedPrice);
  const needsCode = job.status === 'en_route' || job.status === 'in_progress';
  const canGiveUp = job.status === 'assigned' || job.status === 'en_route';
  const error = step.isError ? <Notice variant="alert">{t(errorKey(step.error))}</Notice> : null;

  return (
    <Screen
      theme="dark"
      title={job.title}
      onBack={back}
      backLabel={t('common.back')}
      footer={
        givingUp ? (
          <>
            <Notice variant="alert">{step.isError ? t(errorKey(step.error)) : t('earn.giveUpConfirm')}</Notice>
            <View style={{ flexDirection: 'row', gap: space[8] }}>
              <Button
                label={t('earn.giveUpNo')}
                variant="outlineOnBrand"
                size="md"
                style={{ flex: 1 }}
                onPress={() => setGivingUp(false)}
              />
              <Button
                label={t('earn.giveUpYes')}
                variant="danger"
                size="md"
                style={{ flex: 1 }}
                loading={step.isPending}
                onPress={() => step.mutate('cancel')}
              />
            </View>
          </>
        ) : (
          <>
            {job.status === 'assigned' ? (
              <>
                {error}
                <Button
                  label={t('earn.onMyWay')}
                  variant="accent"
                  loading={step.isPending}
                  onPress={() => step.mutate('en-route')}
                />
              </>
            ) : null}
            {needsCode ? (
              <>
                <TextField
                  label={t(job.status === 'en_route' ? 'earn.startCode' : 'earn.completionCode')}
                  onBrand
                  code
                  value={code}
                  onChangeText={(value) => {
                    setCode(value.replace(/\D/g, '').slice(0, BOOKING_CODE_LENGTH));
                    step.reset();
                  }}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  maxLength={BOOKING_CODE_LENGTH}
                />
                <Text variant="caption" color={dark.inkMuted}>
                  {t(job.status === 'en_route' ? 'earn.startHint' : 'earn.completionHint')}
                </Text>
                {error}
                <Button
                  label={t(job.status === 'en_route' ? 'earn.start' : 'earn.finish')}
                  variant="accent"
                  disabled={code.length !== BOOKING_CODE_LENGTH}
                  loading={step.isPending}
                  onPress={() => step.mutate(job.status === 'en_route' ? 'start' : 'complete')}
                />
              </>
            ) : null}
            {job.status === 'completed' ? (
              <>
                <Notice variant="accent">{t('earn.cashPrompt', { amount })}</Notice>
                {error}
                <Button
                  label={t('earn.cashReceived', { amount })}
                  variant="accent"
                  loading={step.isPending}
                  onPress={() => step.mutate('payment/cash-received')}
                />
              </>
            ) : null}
            {canGiveUp ? (
              <Button
                label={t('earn.giveUp')}
                variant="ghost"
                size="sm"
                textColor={dark.ink}
                onPress={() => setGivingUp(true)}
              />
            ) : null}
          </>
        )
      }
    >
      <StatusPill status={job.status} />
      {job.status === 'paid' ? <Notice variant="accent">{t('earn.paid')}</Notice> : null}
      {job.helpersNeeded > 1 && job.status !== 'paid' ? (
        <Notice variant="accent">{t('earn.team', { count: job.helpersNeeded })}</Notice>
      ) : null}
      {job.status === 'paid' && job.myRating === null ? (
        <RatingPrompt bookingId={job.id} question={t('rating.askCustomer')} />
      ) : null}

      <Panel>
        <Text variant="body" color={dark.ink} style={{ lineHeight: 22 }}>
          {job.description}
        </Text>
      </Panel>

      <Panel>
        <Line label={t('earn.price')} value={amount} />
        <Line label={t('earn.commission')} value={`− ${formatRupees(job.commission)}`} />
        <View style={{ height: 1, backgroundColor: dark.border }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text variant="labelLg" color={dark.ink}>
            {t('earn.youKeep')}
          </Text>
          <Text variant="figure" color={colors.accent}>
            {formatRupees(job.netAmount)}
          </Text>
        </View>
      </Panel>

      <CustomerPanel job={job} />
    </Screen>
  );
}

function CustomerPanel({ job }: { job: HelperBooking }) {
  const t = useT();
  const { name, phone } = job.customer;
  // Contact details are shown for the job in hand only.
  if (!phone) {
    return null;
  }
  return (
    <Panel>
      <Text variant="caption" weight={600} color={dark.inkMuted}>
        {t('earn.customer')}
      </Text>
      <Text variant="labelLg" color={dark.ink}>
        {name ?? formatPhone(phone)}
      </Text>
      <Text variant="bodySm" color={job.address ? dark.ink : dark.inkMuted}>
        {job.address ?? t('earn.addressLater')}
      </Text>
      <Button
        label={name ? t('earn.call', { name }) : t('earn.callCustomer')}
        variant="outlineOnBrand"
        size="sm"
        onPress={() => void Linking.openURL(`tel:${phone}`)}
      />
    </Panel>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ gap: space[10], padding: space[16], borderRadius: radius[18], backgroundColor: dark.surface }}>
      {children}
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant="bodySm" color={dark.inkMuted}>
        {label}
      </Text>
      <Text variant="bodySm" color={dark.inkMuted}>
        {value}
      </Text>
    </View>
  );
}
