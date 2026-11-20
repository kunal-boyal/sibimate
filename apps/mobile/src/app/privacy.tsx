import { PRIVACY_NOTICE_VERSION } from '@sibimate/shared';
import { colors, space } from '@sibimate/ui-tokens';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useT } from '@/lib/i18n';
import type { TranslationKey } from '@/locales/en';

const SECTIONS = ['collect', 'use', 'voice', 'share', 'keep', 'rights'] as const;

/** The privacy notice, in plain language. Open whether or not someone is signed in. */
export default function Privacy() {
  const t = useT();
  const router = useRouter();
  return (
    <Screen
      title={t('privacy.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      backLabel={t('common.back')}
    >
      <Text variant="body" color={colors.inkMuted} style={{ lineHeight: 22 }}>
        {t('privacy.intro')}
      </Text>
      {SECTIONS.map((section) => (
        <View key={section} style={{ gap: space[6] }}>
          <Text variant="titleSm" color={colors.ink} accessibilityRole="header">
            {t(`privacy.${section}.title` as TranslationKey)}
          </Text>
          <Text variant="body" color={colors.ink} style={{ lineHeight: 22 }}>
            {t(`privacy.${section}.body` as TranslationKey)}
          </Text>
        </View>
      ))}
      <Text variant="caption" color={colors.inkMuted}>
        {t('privacy.version', { version: PRIVACY_NOTICE_VERSION })}
      </Text>
    </Screen>
  );
}
