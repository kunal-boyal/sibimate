import type { GeoPoint } from '@sibimate/shared';
import { colors, radius, space } from '@sibimate/ui-tokens';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/Button';
import { ChoiceTiles } from '@/components/ChoiceTiles';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { useDraft } from '@/lib/draft';
import { errorKey, useT } from '@/lib/i18n';
import { getCurrentPoint } from '@/lib/location';
import { api } from '@/lib/session';
import type { TranslationKey } from '@/locales/en';

export default function ConfirmTask() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const text = useDraft((state) => state.text).trim();
  const interpretation = useDraft((state) => state.interpretation);
  const clearDraft = useDraft((state) => state.clear);

  const [kind, setKind] = useState<'unskilled' | 'skilled'>('unskilled');
  const [address, setAddress] = useState('');
  const [rupees, setRupees] = useState('');
  const [point, setPoint] = useState<GeoPoint | null | 'loading'>('loading');
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  // One key for this task, kept across retries so a weak connection never posts it twice.
  const idempotencyKey = useRef(Crypto.randomUUID());

  // Each attempt asks the phone for its position once; "Try again" starts another.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void getCurrentPoint().then((found) => {
      if (current) {
        setPoint(found);
      }
    });
    return () => {
      current = false;
    };
  }, [attempt]);
  function locate() {
    setPoint('loading');
    setAttempt((count) => count + 1);
  }

  if (!text && !posted) {
    return <Redirect href="/" />;
  }

  async function post() {
    const price = Number(rupees);
    if (address.trim().length < 5) {
      setError('confirm.addressMissing');
      return;
    }
    if (!Number.isFinite(price) || price < 1) {
      setError('confirm.budgetMissing');
      return;
    }
    if (!point || point === 'loading') {
      setError('confirm.locationFailed');
      return;
    }
    setError(null);
    setPosting(true);
    try {
      const task = await api.createTask(
        {
          interpretationId: interpretation?.id,
          title: interpretation?.title ?? (text.length > 60 ? `${text.slice(0, 57).trimEnd()}...` : text),
          description: interpretation?.description ?? text,
          requiresSkilled: interpretation?.requiresSkilled ?? kind === 'skilled',
          helpersNeeded: interpretation?.helpersNeeded ?? 1,
          customerPrice: Math.round(price * 100),
          pickup: point,
          address: address.trim(),
          paymentMethod: 'cash',
        },
        idempotencyKey.current,
      );
      setPosted(true);
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      clearDraft();
      router.replace({ pathname: '/task/[id]', params: { id: task.id } });
    } catch (caught) {
      setError(errorKey(caught));
      setPosting(false);
    }
  }

  return (
    <Screen
      title={t('confirm.title')}
      onBack={() => router.back()}
      backLabel={t('common.back')}
      footer={
        <>
          {error ? <Notice variant="alert">{t(error)}</Notice> : null}
          <Button
            label={t('confirm.post')}
            loading={posting}
            disabled={point === 'loading'}
            onPress={() => void post()}
          />
        </>
      }
    >
      {interpretation ? (
        <View style={{ gap: space[12], padding: space[16], borderRadius: radius[20], backgroundColor: colors.brand }}>
          <View style={{ gap: space[4] }}>
            <Text variant="overline" color={colors.onBrandMuted}>
              {t('confirm.understood')}
            </Text>
            <Text variant="titleSm" color={colors.onBrand}>
              {interpretation.title}
            </Text>
          </View>
          <Text variant="bodySm" color={colors.onBrandMuted}>
            {interpretation.description}
          </Text>
          <View style={{ flexDirection: 'row', gap: space[8] }}>
            <Fact label={t('confirm.category')} value={interpretation.category.name} />
            <Fact
              label={t('confirm.helpers')}
              value={
                interpretation.helpersNeeded === 1
                  ? t('confirm.helpersOne')
                  : t('confirm.helpersMany', { count: interpretation.helpersNeeded })
              }
            />
            <Fact label={t('confirm.duration')} value={t('confirm.minutes', interpretation.estimatedMinutes)} />
          </View>
          {interpretation.requiresSkilled ? (
            <Text variant="caption" weight={600} color={colors.onBrand}>
              {t('confirm.skilledTag')}
            </Text>
          ) : null}
          <Button label={t('confirm.reject')} variant="outlineOnBrand" size="sm" onPress={() => router.back()} />
        </View>
      ) : (
        <>
          <View
            style={{
              gap: space[8],
              padding: space[16],
              borderRadius: radius[20],
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text variant="caption" weight={600} color={colors.inkMuted}>
              {t('confirm.yourWords')}
            </Text>
            <Text variant="bodyLg" color={colors.ink}>
              {text}
            </Text>
          </View>
          <Notice variant="accent">{t('confirm.manualNote')}</Notice>
          <ChoiceTiles
            label={t('confirm.kind')}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'unskilled', label: t('confirm.unskilled') },
              { value: 'skilled', label: t('confirm.skilled') },
            ]}
          />
        </>
      )}

      {interpretation?.followUpQuestion ? <Notice variant="accent">{interpretation.followUpQuestion}</Notice> : null}

      <TextField
        label={t('confirm.address')}
        value={address}
        onChangeText={(value) => {
          setAddress(value);
          setError(null);
        }}
        placeholder={t('confirm.addressPlaceholder')}
        autoComplete="street-address"
        textContentType="fullStreetAddress"
        maxLength={300}
      />
      <Text variant="caption" color={colors.inkMuted}>
        {t('confirm.addressNote')}
      </Text>

      <TextField
        label={t('confirm.budget')}
        prefix="₹"
        figure
        value={rupees}
        onChangeText={(value) => {
          setRupees(value.replace(/\D/g, '').slice(0, 7));
          setError(null);
        }}
        placeholder="150"
        keyboardType="number-pad"
        inputMode="numeric"
      />
      <Text variant="caption" color={colors.inkMuted}>
        {t('confirm.cash')}
      </Text>

      {point === 'loading' ? (
        <Text variant="caption" color={colors.inkMuted}>
          {t('confirm.locating')}
        </Text>
      ) : point ? (
        <Text variant="caption" color={colors.inkMuted}>
          {t('confirm.locationFound')}
        </Text>
      ) : (
        <>
          <Notice variant="alert">{t('confirm.locationFailed')}</Notice>
          <Button label={t('confirm.retryLocation')} variant="secondary" size="sm" onPress={locate} />
        </>
      )}
    </Screen>
  );
}

/** A fact tile on the brand-green card. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flex: 1,
        gap: space[2],
        padding: space[10],
        borderRadius: radius[12],
        backgroundColor: colors.brandRaised,
      }}
    >
      <Text variant="micro" weight={400} color={colors.onBrandMuted}>
        {label}
      </Text>
      <Text variant="bodySm" weight={600} color={colors.onBrand}>
        {value}
      </Text>
    </View>
  );
}
