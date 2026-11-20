import { colors, radius, space } from '@sibimate/ui-tokens';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/Button';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { errorKey, formatPhone, useT } from '@/lib/i18n';
import { api, useSession } from '@/lib/session';

/** The signed-in person's account: details, the privacy notice, signing out and deleting the account. */
export default function Account() {
  const t = useT();
  const router = useRouter();
  const user = useSession((state) => state.user);
  const signOut = useSession((state) => state.signOut);
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: api.deleteAccount,
    // The account is gone: clear this phone's copy of the session too.
    onSuccess: () => signOut(),
  });

  return (
    <Screen
      title={t('account.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      backLabel={t('common.back')}
    >
      <View
        style={{
          gap: space[6],
          padding: space[16],
          borderRadius: radius[20],
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        {user?.name ? (
          <Text variant="labelLg" color={colors.ink}>
            {user.name}
          </Text>
        ) : null}
        <Text variant="body" color={colors.inkMuted}>
          {formatPhone(user?.phone ?? '')}
        </Text>
      </View>

      <Button label={t('account.privacy')} variant="secondary" size="md" onPress={() => router.push('/privacy')} />
      <Button label={t('home.signOut')} variant="secondary" size="md" onPress={() => void signOut()} />

      <View style={{ gap: space[10], marginTop: space[24] }}>
        <Text variant="titleSm" color={colors.ink} accessibilityRole="header">
          {t('account.deleteTitle')}
        </Text>
        <Text variant="body" color={colors.inkMuted} style={{ lineHeight: 22 }}>
          {t('account.deleteBody')}
        </Text>
        {remove.isError ? <Notice variant="alert">{t(errorKey(remove.error))}</Notice> : null}
        {confirming ? (
          <>
            <Notice variant="alert">{t('account.deleteConfirm')}</Notice>
            <View style={{ flexDirection: 'row', gap: space[8] }}>
              <Button
                label={t('account.keep')}
                variant="secondary"
                size="md"
                style={{ flex: 1 }}
                onPress={() => setConfirming(false)}
              />
              <Button
                label={t('account.deleteYes')}
                variant="danger"
                size="md"
                style={{ flex: 1 }}
                loading={remove.isPending}
                onPress={() => remove.mutate()}
              />
            </View>
          </>
        ) : (
          <Button label={t('account.delete')} variant="danger" size="md" onPress={() => setConfirming(true)} />
        )}
      </View>
    </Screen>
  );
}
