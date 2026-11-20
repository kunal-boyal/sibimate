import { OTP_LENGTH } from '@sibimate/shared';
import { colors, size, space } from '@sibimate/ui-tokens';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { BrandScreen } from '@/components/BrandScreen';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { type TranslationKey } from '@/locales/en';
import { errorKey, formatPhone, useT } from '@/lib/i18n';
import { api, useSession } from '@/lib/session';

export default function Verify() {
  const t = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ phone: string; resendIn?: string }>();
  const phone = params.phone;
  const signIn = useSession((state) => state.signIn);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'verify' | 'resend' | null>(null);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [resent, setResent] = useState(false);
  const [wait, setWait] = useState(Number(params.resendIn ?? 30));

  useEffect(() => {
    if (wait <= 0) {
      return;
    }
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function verify(value: string) {
    if (value.length !== OTP_LENGTH || busy) {
      return;
    }
    setError(null);
    setResent(false);
    setBusy('verify');
    try {
      // Signing in swaps this screen for the home screen.
      await signIn(await api.verifyOtp(phone, value));
    } catch (caught) {
      setError(errorKey(caught));
      setCode('');
      setBusy(null);
    }
  }

  async function resend() {
    setError(null);
    setBusy('resend');
    try {
      const { resendIn } = await api.requestOtp(phone);
      setWait(resendIn);
      setCode('');
      setResent(true);
    } catch (caught) {
      setError(errorKey(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <BrandScreen>
      <View style={{ gap: space[24] }}>
        <Button
          label={`‹  ${t('verify.back')}`}
          variant="ghost"
          size="sm"
          textColor={colors.onBrand}
          onPress={() => router.back()}
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 0,
            minHeight: size.control,
          }}
        />
        <View style={{ gap: space[12] }}>
          <Text variant="titleXl" color={colors.onBrand} accessibilityRole="header">
            {t('verify.title')}
          </Text>
          <Text variant="lead" color={colors.onBrandMuted}>
            {t('verify.sentTo', { phone: formatPhone(phone) })}
          </Text>
        </View>
      </View>

      <View style={{ gap: space[16] }}>
        <TextField
          label={t('verify.codeLabel')}
          onBrand
          code
          value={code}
          onChangeText={(value) => {
            const digits = value.replace(/\D/g, '').slice(0, OTP_LENGTH);
            setCode(digits);
            setError(null);
            void verify(digits);
          }}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoFocus
          editable={busy !== 'verify'}
          maxLength={OTP_LENGTH}
        />
        {error ? <Notice variant="alert">{t(error)}</Notice> : null}
        {resent && !error ? <Notice variant="accent">{t('verify.resent')}</Notice> : null}
        <Button
          label={t('verify.submit')}
          variant="accent"
          loading={busy === 'verify'}
          disabled={code.length !== OTP_LENGTH}
          onPress={() => void verify(code)}
        />
        {wait > 0 ? (
          <Text
            variant="bodySm"
            color={colors.onBrandMuted}
            style={{
              textAlign: 'center',
              minHeight: size.controlLg,
              paddingTop: space[16],
            }}
          >
            {t('verify.resendIn', { seconds: wait })}
          </Text>
        ) : (
          <Button
            label={t('verify.resend')}
            variant="outlineOnBrand"
            size="md"
            loading={busy === 'resend'}
            onPress={() => void resend()}
          />
        )}
      </View>
    </BrandScreen>
  );
}
