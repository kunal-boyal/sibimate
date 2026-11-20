import { type TaskInterpretation, VOICE_MAX_SECONDS } from '@sibimate/shared';
import { colors, size, space } from '@sibimate/ui-tokens';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { errorKey, useT } from '@/lib/i18n';
import { ApiClientError, api } from '@/lib/session';
import type { TranslationKey } from '@/locales/en';
import { Text } from './Text';

// Speech needs far less than music: one channel at 64 kbps keeps a full recording under 1 MB.
const PRESET = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64_000 };

export interface VoiceInputProps {
  disabled?: boolean;
  /** The task details written from what was heard. */
  onInterpreted: (interpretation: TaskInterpretation) => void;
  /** What was heard, when the details could not be written: the customer posts it in their own words. */
  onHeardOnly: (text: string) => void;
  onError: (key: TranslationKey | null) => void;
}

/** The round marigold microphone button: press to speak, press again to send. */
export function VoiceInput({ disabled, onInterpreted, onHeardOnly, onError }: VoiceInputProps) {
  const t = useT();
  const recorder = useAudioRecorder(PRESET);
  const { isRecording, durationMillis } = useAudioRecorderState(recorder, 250);
  const [sending, setSending] = useState(false);
  const seconds = Math.floor(durationMillis / 1000);

  async function start() {
    onError(null);
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        onError('voice.permission');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      limit.current = setTimeout(() => void stopAndSend(), VOICE_MAX_SECONDS * 1000);
    } catch {
      onError('voice.failed');
    }
  }

  async function stopAndSend() {
    clearTimeout(limit.current ?? undefined);
    setSending(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        onError('voice.failed');
        return;
      }
      // A browser hands back a blob: address; a phone hands back a file the upload reads itself.
      const audio =
        Platform.OS === 'web' ? await (await fetch(uri)).blob() : { uri, name: 'task.m4a', type: 'audio/mp4' };
      onInterpreted(await api.interpretVoice(audio));
    } catch (caught) {
      const heard = caught instanceof ApiClientError ? (caught.details as { text?: unknown } | undefined)?.text : null;
      if (caught instanceof ApiClientError && caught.code === 'interpreter_unavailable' && typeof heard === 'string') {
        onHeardOnly(heard);
      } else {
        onError(caught instanceof ApiClientError ? errorKey(caught) : 'voice.failed');
      }
    } finally {
      setSending(false);
    }
  }

  // A recording left running stops by itself and is sent.
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(limit.current ?? undefined), []);

  const label = isRecording ? t('voice.stop') : t('voice.start');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[12] }}>
      <Text
        variant="caption"
        weight={isRecording ? 600 : 400}
        color={isRecording ? colors.ink : colors.inkMuted}
        style={{ flex: 1 }}
        accessibilityLiveRegion="polite"
      >
        {sending
          ? t('voice.sending')
          : isRecording
            ? t('voice.listening', { time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` })
            : t('voice.hint')}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: disabled || sending, busy: sending }}
        disabled={disabled || sending}
        onPress={() => void (isRecording ? stopAndSend() : start())}
        style={({ pressed }) => ({
          width: size.controlXl,
          height: size.controlXl,
          borderRadius: size.controlXl / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isRecording ? colors.inverse : pressed ? colors.accentHover : colors.accent,
          opacity: disabled && !sending ? 0.5 : 1,
        })}
      >
        {sending ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : isRecording ? (
          <Svg width={26} height={26} viewBox="0 0 24 24">
            <Rect x={6} y={6} width={12} height={12} rx={2} fill={colors.onInverse} />
          </Svg>
        ) : (
          <Svg
            width={26}
            height={26}
            viewBox="0 0 24 24"
            fill="none"
            stroke={colors.onAccent}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
            <Path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </Svg>
        )}
      </Pressable>
    </View>
  );
}
