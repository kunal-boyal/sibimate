import { TASK_TEXT_MAX, type Task, formatRupees } from '@sibimate/shared';
import { colors, radius, space, textStyles } from '@sibimate/ui-tokens';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ModeToggle } from '@/components/ModeToggle';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { StatusPill } from '@/components/StatusPill';
import { Text, fontFace } from '@/components/Text';
import { VoiceInput } from '@/components/VoiceInput';
import { useDraft } from '@/lib/draft';
import { errorKey, useT } from '@/lib/i18n';
import { ApiClientError, api, useSession } from '@/lib/session';
import type { TranslationKey } from '@/locales/en';

const SUGGESTIONS = ['carry', 'grocery', 'wait', 'shift', 'event'] as const;

export default function Home() {
  const t = useT();
  const router = useRouter();
  const signOut = useSession((state) => state.signOut);
  const text = useDraft((state) => state.text);
  const setText = useDraft((state) => state.setText);
  const setInterpretation = useDraft((state) => state.setInterpretation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);

  // An admin can make this account a helper at any time, so the profile is checked when the home screen opens.
  const me = useQuery({ queryKey: ['me'], queryFn: api.getMe });
  const savedUser = useSession((state) => state.user);
  const isHelper = (me.data ?? savedUser)?.roles.includes('helper') ?? false;

  const tasks = useQuery({ queryKey: ['tasks', 'active'], queryFn: () => api.listTasks({ status: 'active' }) });

  async function next() {
    const words = text.trim();
    if (words.length < 5) {
      setError('home.tooShort');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      setInterpretation(await api.interpretTask(words));
      router.push('/task/new');
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === 'interpreter_unavailable') {
        // No AI details just now: the customer posts the task in their own words.
        setInterpretation(null);
        router.push('/task/new');
      } else {
        setError(errorKey(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          {!isHelper ? (
            <Button label={t('apply.link')} variant="secondary" size="md" onPress={() => router.push('/earn/apply')} />
          ) : null}
          <Button label={t('home.signOut')} variant="ghost" size="sm" onPress={() => void signOut()} />
        </>
      }
    >
      {isHelper ? <ModeToggle mode="hire" /> : null}
      <Text
        variant="titleXl"
        color={colors.ink}
        accessibilityRole="header"
        style={{ marginTop: isHelper ? space[6] : space[24], marginBottom: space[6] }}
      >
        {t('home.title')}
      </Text>

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
        <Text variant="caption" weight={600} color={colors.inkMuted} nativeID="task-label">
          {t('home.inputLabel')}
        </Text>
        <TextInput
          accessibilityLabel={t('home.inputLabel')}
          accessibilityLabelledBy="task-label"
          value={text}
          onChangeText={(value) => {
            setText(value);
            setError(null);
          }}
          placeholder={t('home.inputPlaceholder')}
          placeholderTextColor={colors.inkMuted}
          multiline
          maxLength={TASK_TEXT_MAX}
          textAlignVertical="top"
          style={[
            {
              minHeight: textStyles.bodyLg.lineHeight * 3,
              padding: 0,
              color: colors.ink,
              fontFamily: fontFace('sans', 500),
              fontSize: textStyles.bodyLg.fontSize,
              lineHeight: textStyles.bodyLg.lineHeight,
            },
            Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
          ]}
        />
        <VoiceInput
          disabled={busy}
          onError={setError}
          onInterpreted={(interpretation) => {
            // The customer sees what was heard, and can correct it by going back.
            setText(interpretation.inputText);
            setInterpretation(interpretation);
            router.push('/task/new');
          }}
          onHeardOnly={(heard) => {
            setText(heard);
            setInterpretation(null);
            router.push('/task/new');
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[8] }}>
        {SUGGESTIONS.map((key) => (
          <Chip
            key={key}
            label={t(`home.suggest.${key}`)}
            onPress={() => {
              setText(t(`home.suggestText.${key}`));
              setError(null);
            }}
          />
        ))}
      </View>

      {error ? <Notice variant="alert">{t(error)}</Notice> : null}
      <Button label={t('home.continue')} loading={busy} onPress={() => void next()} />

      {tasks.data && tasks.data.items.length > 0 ? (
        <View style={{ gap: space[10], marginTop: space[10] }}>
          <Text variant="caption" weight={600} color={colors.inkMuted} accessibilityRole="header">
            {t('home.yourTasks')}
          </Text>
          {tasks.data.items.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onPress={() => router.push({ pathname: '/task/[id]', params: { id: task.id } })}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function TaskRow({ task, onPress }: { task: Task; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        gap: space[8],
        padding: space[16],
        borderRadius: radius[16],
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space[12] }}>
        <Text variant="labelLg" color={colors.ink} style={{ flex: 1 }} numberOfLines={2}>
          {task.title}
        </Text>
        <Text variant="figure" color={colors.ink} style={{ fontSize: 20 }}>
          {formatRupees(task.customerPrice)}
        </Text>
      </View>
      <StatusPill status={task.status} />
    </Pressable>
  );
}
