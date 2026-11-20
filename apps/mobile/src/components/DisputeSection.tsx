import type { BookingDispute } from '@sibimate/shared';
import { radius, space, textStyles, themes } from '@sibimate/ui-tokens';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, TextInput, View } from 'react-native';
import { errorKey, useT } from '@/lib/i18n';
import { api } from '@/lib/session';
import type { TranslationKey } from '@/locales/en';
import { Button } from './Button';
import { Notice } from './Notice';
import { Text, fontFace } from './Text';

export interface DisputeSectionProps {
  bookingId: string;
  canDispute: boolean;
  dispute: BookingDispute | null;
  /** The button that opens the form: "Report a problem", or the helper's "Customer not giving the code?". */
  openLabel: TranslationKey;
  theme?: keyof typeof themes;
}

/** Reporting a problem with a job, and what Sibimate decided. */
export function DisputeSection({ bookingId, canDispute, dispute, openLabel, theme = 'light' }: DisputeSectionProps) {
  const t = useT();
  const colors = themes[theme];
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const send = useMutation({
    mutationFn: () => api.raiseDispute(bookingId, reason.trim()),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['jobs'] }),
      ]),
  });

  if (dispute) {
    if (dispute.status === 'open') {
      return <Notice variant="accent">{t(dispute.raisedByMe ? 'dispute.openMine' : 'dispute.openOther')}</Notice>;
    }
    return (
      <Notice variant="accent">
        {`${t(dispute.resolution === 'release' ? 'dispute.released' : 'dispute.refunded')} ${dispute.resolutionNote ?? ''}`.trim()}
      </Notice>
    );
  }
  if (!canDispute) {
    return null;
  }
  if (!open) {
    return (
      <Button
        label={t(openLabel)}
        variant={theme === 'dark' ? 'outlineOnBrand' : 'secondary'}
        size="sm"
        onPress={() => setOpen(true)}
      />
    );
  }

  const tooShort = reason.trim().length < 10;
  return (
    <View style={{ gap: space[12], padding: space[16], borderRadius: radius[18], backgroundColor: colors.surface }}>
      <Text variant="labelLg" color={colors.ink}>
        {t('dispute.title')}
      </Text>
      <Text variant="caption" color={colors.inkMuted}>
        {t('dispute.intro')}
      </Text>
      <TextInput
        accessibilityLabel={t('dispute.title')}
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={500}
        placeholder={t('dispute.placeholder')}
        placeholderTextColor={colors.inkMuted}
        textAlignVertical="top"
        style={[
          {
            minHeight: 96,
            padding: space[12],
            borderRadius: radius[12],
            borderWidth: 1,
            borderColor: colors.borderStrong,
            color: colors.ink,
            backgroundColor: theme === 'dark' ? colors.ground : colors.surface,
            fontFamily: fontFace('sans', 400),
            fontSize: textStyles.body.fontSize,
          },
          Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
        ]}
      />
      {send.isError ? <Notice variant="alert">{t(errorKey(send.error))}</Notice> : null}
      <View style={{ flexDirection: 'row', gap: space[8] }}>
        <Button
          label={t('common.back')}
          variant={theme === 'dark' ? 'outlineOnBrand' : 'secondary'}
          size="md"
          style={{ flex: 1 }}
          onPress={() => setOpen(false)}
        />
        <Button
          label={t('dispute.send')}
          variant="danger"
          size="md"
          style={{ flex: 1 }}
          disabled={tooShort}
          loading={send.isPending}
          onPress={() => send.mutate()}
        />
      </View>
    </View>
  );
}
