import { normalizeIndianMobile } from '@sibimate/shared';
import { colors, space } from '@sibimate/ui-tokens';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { BrandScreen } from '@/components/BrandScreen';
import { Button } from '@/components/Button';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Mark } from '@/components/Mark';
import { Notice } from '@/components/Notice';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { type TranslationKey } from '@/locales/en';
import { errorKey, useT } from '@/lib/i18n';
import { ApiClientError, api } from '@/lib/session';

export default function Welcome() {
  const t = useT();
  const router = useRouter();
  const [number, setNumber] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);

  async function sendOtp() {
    const phone = normalizeIndianMobile(number);
    if (!phone) {
      setError('welcome.phoneInvalid');
      return;
    }
    setError(null);
    setSending(true);
    try {
      const { resendIn } = await api.requestOtp(phone);
      router.push({
        pathname: '/verify',
        params: { phone, resendIn: String(resendIn) },
      });
    } catch (caught) {
      // A code was sent to this number moments ago: go and enter it instead of blocking.
      const retryAfter = caught instanceof ApiClientError ? resendWait(caught) : null;
      if (retryAfter !== null) {
        router.push({
          pathname: '/verify',
          params: { phone, resendIn: String(retryAfter) },
        });
      } else {
        setError(errorKey(caught));
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <BrandScreen>
      <View style={{ gap: space[40], paddingTop: space[24] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[10] }}>
          <Mark />
          <Text variant="wordmark" color={colors.onBrand}>
            sibimate
          </Text>
        </View>
        <View style={{ gap: space[16] }}>
          <Text variant="displayXl" color={colors.onBrand} accessibilityRole="header">
            {t('brand.line1')}
            {'\n'}
            <Text variant="displayXl" color={colors.accent}>
              {t('brand.line2')}
            </Text>
          </Text>
          <Text variant="lead" color={colors.onBrandMuted}>
            {t('welcome.lead')}
          </Text>
        </View>
      </View>

      <View style={{ gap: space[16] }}>
        <TextField
          label={t('welcome.phoneLabel')}
          prefix="+91"
          onBrand
          value={number}
          onChangeText={(value) => {
            setNumber(value);
            setError(null);
          }}
          onSubmitEditing={() => void sendOtp()}
          placeholder="98765 43210"
          keyboardType="phone-pad"
          inputMode="tel"
          autoComplete="tel-national"
          textContentType="telephoneNumber"
          returnKeyType="send"
          maxLength={16}
        />
        {error ? <Notice variant="alert">{t(error)}</Notice> : null}
        <Button label={t('welcome.sendOtp')} variant="accent" loading={sending} onPress={() => void sendOtp()} />
        <LanguageToggle />
        <Text variant="micro" weight={400} color={colors.onBrandMuted} style={{ textAlign: 'center' }}>
          {t('welcome.terms')}
        </Text>
      </View>
    </BrandScreen>
  );
}

/** Seconds to wait when the API refused only because a code was just sent, else null. */
function resendWait(error: ApiClientError): number | null {
  const retryAfter = (error.details as { retryAfter?: unknown } | undefined)?.retryAfter;
  return error.code === 'rate_limited' && typeof retryAfter === 'number' && retryAfter <= 60 ? retryAfter : null;
}
