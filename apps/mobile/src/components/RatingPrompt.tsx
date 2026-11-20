import { colors, radius, size, space } from '@sibimate/ui-tokens';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { errorKey, useT } from '@/lib/i18n';
import { api } from '@/lib/session';
import { Button } from './Button';
import { Notice } from './Notice';
import { Text } from './Text';

const STAR = 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z';

/** Asks for a rating from 1 to 5 once a job is paid. Shown until the person has rated. */
export function RatingPrompt({ bookingId, question }: { bookingId: string; question: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const send = useMutation({
    mutationFn: () => api.reviewBooking(bookingId, rating),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['jobs'] }),
      ]),
  });

  return (
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
      <Text variant="labelLg" color={colors.ink}>
        {question}
      </Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={question}
        style={{ flexDirection: 'row', justifyContent: 'space-between' }}
      >
        {[1, 2, 3, 4, 5].map((value) => {
          const filled = value <= rating;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: value === rating }}
              accessibilityLabel={t('rating.stars', { count: value })}
              onPress={() => setRating(value)}
              style={{ width: size.controlLg, height: size.controlLg, alignItems: 'center', justifyContent: 'center' }}
            >
              <Svg width={36} height={36} viewBox="0 0 24 24">
                <Path
                  d={STAR}
                  fill={filled ? colors.accent : 'none'}
                  stroke={filled ? colors.onAccentSoft : colors.inkMuted}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>
          );
        })}
      </View>
      {send.isError ? <Notice variant="alert">{t(errorKey(send.error))}</Notice> : null}
      <Button
        label={t('rating.send')}
        size="md"
        disabled={rating === 0}
        loading={send.isPending}
        onPress={() => send.mutate()}
      />
    </View>
  );
}
