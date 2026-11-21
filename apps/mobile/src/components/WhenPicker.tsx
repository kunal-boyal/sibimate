import { SCHEDULE_MAX_DAYS } from '@sibimate/shared';
import { colors, radius, size, space } from '@sibimate/ui-tokens';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { ChoiceTiles } from './ChoiceTiles';
import { Text } from './Text';

/** Times a task can start: every half hour from 7 in the morning to 9 at night. */
const SLOTS = Array.from({ length: 29 }, (_, i) => ({ hour: 7 + Math.floor(i / 2), minute: (i % 2) * 30 }));
/** The earliest a later task can start, so a helper has time to plan. */
const MIN_NOTICE_MS = 60 * 60_000;

export interface When {
  later: boolean;
  /** Midnight of the chosen day, as a timestamp. */
  day: number | null;
  slot: { hour: number; minute: number } | null;
}

export function scheduleAtOf(when: When): string | null {
  if (!when.later || when.day === null || !when.slot) {
    return null;
  }
  const at = new Date(when.day);
  at.setHours(when.slot.hour, when.slot.minute, 0, 0);
  return at.toISOString();
}

/** "Right now", or a day and a half-hour slot within the next two weeks. */
export function WhenPicker({ value, onChange }: { value: When; onChange: (value: When) => void }) {
  const t = useT();
  const locale = useSession((state) => state.language) === 'hi' ? 'hi-IN' : 'en-IN';
  // The time is read once, when the picker opens, so the slots do not shift while someone chooses.
  const [now] = useState(() => Date.now());
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const days = Array.from({ length: Math.min(SCHEDULE_MAX_DAYS, 7) }, (_, i) => {
    const day = new Date(midnight);
    day.setDate(day.getDate() + i);
    return day.getTime();
  });
  const slotsFor = (day: number) =>
    SLOTS.filter(({ hour, minute }) => {
      const at = new Date(day);
      at.setHours(hour, minute, 0, 0);
      return at.getTime() >= now + MIN_NOTICE_MS;
    });
  const openDays = days.filter((day) => slotsFor(day).length > 0);
  const dayLabel = (day: number, index: number) =>
    index === 0 && day === midnight.getTime()
      ? t('when.today')
      : day === midnight.getTime() + 86_400_000
        ? t('when.tomorrow')
        : new Date(day).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const timeLabel = ({ hour, minute }: { hour: number; minute: number }) => {
    const at = new Date(now);
    at.setHours(hour, minute, 0, 0);
    return at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <View style={{ gap: space[12] }}>
      <ChoiceTiles
        label={t('when.label')}
        value={value.later ? 'later' : 'now'}
        onChange={(choice) =>
          onChange(
            choice === 'now'
              ? { later: false, day: null, slot: null }
              : { later: true, day: openDays[0] ?? null, slot: null },
          )
        }
        options={[
          { value: 'now', label: t('when.now') },
          { value: 'later', label: t('when.later') },
        ]}
      />
      {value.later ? (
        <>
          <Row>
            {openDays.map((day, index) => (
              <Pill
                key={day}
                label={dayLabel(day, index)}
                selected={value.day === day}
                onPress={() => onChange({ ...value, day, slot: null })}
              />
            ))}
          </Row>
          {value.day !== null ? (
            <Row>
              {slotsFor(value.day).map((slot) => (
                <Pill
                  key={`${slot.hour}:${slot.minute}`}
                  label={timeLabel(slot)}
                  selected={value.slot?.hour === slot.hour && value.slot.minute === slot.minute}
                  onPress={() => onChange({ ...value, slot })}
                />
              ))}
            </Row>
          ) : null}
          <Text variant="caption" color={colors.inkMuted}>
            {t('when.note')}
          </Text>
        </>
      ) : null}
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[8] }}>
      {children}
    </ScrollView>
  );
}

function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: size.control,
        paddingHorizontal: space[16],
        justifyContent: 'center',
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.inverse : colors.borderStrong,
        backgroundColor: selected ? colors.inverse : colors.surface,
      }}
    >
      <Text variant="bodySm" weight={selected ? 600 : 500} color={selected ? colors.onInverse : colors.ink}>
        {label}
      </Text>
    </Pressable>
  );
}
