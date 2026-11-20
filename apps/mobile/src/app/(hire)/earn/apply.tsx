import type { DocumentKind, HelperProfile } from '@sibimate/shared';
import { colors, radius, size, space } from '@sibimate/ui-tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { Button } from '@/components/Button';
import { ChoiceTiles } from '@/components/ChoiceTiles';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TextField } from '@/components/TextField';
import { errorKey, useT } from '@/lib/i18n';
import { api, useSession } from '@/lib/session';
import type { TranslationKey } from '@/locales/en';

/** Applying to earn with Sibimate: a short form, then photos of the documents a verifier checks. */
export default function Apply() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['helperProfile'], queryFn: api.getHelperProfile });
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const setProfile = (data: HelperProfile) => queryClient.setQueryData(['helperProfile'], data);

  if (profile.data?.status === 'active' || profile.data?.status === 'paused') {
    return <Redirect href="/earn" />;
  }

  return (
    <Screen title={t('apply.title')} onBack={back} backLabel={t('common.back')}>
      {profile.isPending ? <ActivityIndicator color={colors.brand} style={{ marginTop: space[40] }} /> : null}
      {profile.isError ? <Notice variant="alert">{t(errorKey(profile.error))}</Notice> : null}
      {profile.isSuccess && (!profile.data || profile.data.status === 'rejected') ? (
        <ApplicationForm rejectionReason={profile.data?.rejectionReason ?? null} onApplied={setProfile} />
      ) : null}
      {profile.data?.status === 'pending' ? <Documents profile={profile.data} onChanged={setProfile} /> : null}
    </Screen>
  );
}

function ApplicationForm({
  rejectionReason,
  onApplied,
}: {
  rejectionReason: string | null;
  onApplied: (profile: HelperProfile) => void;
}) {
  const t = useT();
  const [name, setName] = useState(useSession.getState().user?.name ?? '');
  const [kind, setKind] = useState<'everyday' | 'skilled'>('everyday');
  const [skills, setSkills] = useState('');
  const [contact, setContact] = useState('');
  const [adult, setAdult] = useState(false);
  const [problem, setProblem] = useState<TranslationKey | null>(null);

  const apply = useMutation({
    mutationFn: () =>
      api.applyAsHelper({
        name: name.trim(),
        claimsSkilled: kind === 'skilled',
        skills: skills
          .split(',')
          .map((skill) => skill.trim())
          .filter((skill) => skill.length >= 2),
        emergencyContact: contact.trim(),
        isAdult: true,
      }),
    onSuccess: onApplied,
  });

  function submit() {
    const missing: TranslationKey | null =
      name.trim().length < 2
        ? 'apply.nameMissing'
        : contact.trim().length < 5
          ? 'apply.contactMissing'
          : !adult
            ? 'apply.adultMissing'
            : null;
    setProblem(missing);
    if (!missing) {
      apply.mutate();
    }
  }

  return (
    <>
      {rejectionReason ? <Notice variant="alert">{t('apply.rejected', { reason: rejectionReason })}</Notice> : null}
      <Text variant="body" color={colors.inkMuted} style={{ lineHeight: 22 }}>
        {t('apply.intro')}
      </Text>
      <TextField label={t('apply.name')} value={name} onChangeText={setName} autoComplete="name" maxLength={80} />
      <ChoiceTiles
        label={t('apply.kind')}
        value={kind}
        onChange={setKind}
        options={[
          { value: 'everyday', label: t('confirm.unskilled') },
          { value: 'skilled', label: t('confirm.skilled') },
        ]}
      />
      {kind === 'skilled' ? (
        <TextField
          label={t('apply.skills')}
          value={skills}
          onChangeText={setSkills}
          placeholder={t('apply.skillsPlaceholder')}
        />
      ) : null}
      <TextField
        label={t('apply.contact')}
        value={contact}
        onChangeText={setContact}
        placeholder={t('apply.contactPlaceholder')}
        maxLength={120}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={t('apply.adult')}
        accessibilityState={{ checked: adult }}
        onPress={() => setAdult(!adult)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space[12], minHeight: size.control }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: adult ? colors.brand : colors.inkMuted,
            backgroundColor: adult ? colors.brand : colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {adult ? (
            <Text variant="caption" weight={700} color={colors.onBrand}>
              ✓
            </Text>
          ) : null}
        </View>
        <Text variant="body" color={colors.ink} style={{ flex: 1 }}>
          {t('apply.adult')}
        </Text>
      </Pressable>
      {problem || apply.isError ? <Notice variant="alert">{t(problem ?? errorKey(apply.error))}</Notice> : null}
      <Button label={t('apply.continue')} loading={apply.isPending} onPress={submit} />
    </>
  );
}

function Documents({ profile, onChanged }: { profile: HelperProfile; onChanged: (profile: HelperProfile) => void }) {
  const t = useT();
  const kinds: DocumentKind[] = profile.claimsSkilled ? ['identity', 'photo', 'qualification'] : ['identity', 'photo'];
  const [failed, setFailed] = useState<TranslationKey | null>(null);
  const upload = useMutation({
    mutationFn: async (kind: DocumentKind) => {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      const asset = picked.assets?.[0];
      if (picked.canceled || !asset) {
        return profile;
      }
      // A browser gives the file itself; a phone gives its address on the device.
      const photo =
        Platform.OS === 'web' && asset.file
          ? asset.file
          : { uri: asset.uri, name: asset.fileName ?? `${kind}.jpg`, type: asset.mimeType ?? 'image/jpeg' };
      return api.uploadHelperDocument(kind, photo);
    },
    onMutate: () => setFailed(null),
    onSuccess: onChanged,
    onError: (error) => setFailed(errorKey(error)),
  });
  const have = (kind: DocumentKind) => profile.documents.some((document) => document.kind === kind);
  const ready = have('identity');

  return (
    <>
      <Notice variant="accent">{t(ready ? 'apply.checking' : 'apply.addDocuments')}</Notice>
      <Text variant="caption" color={colors.inkMuted}>
        {t('apply.privacy')}
      </Text>
      {failed ? <Notice variant="alert">{t(failed)}</Notice> : null}
      {kinds.map((kind) => (
        <View
          key={kind}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[12],
            padding: space[16],
            borderRadius: radius[16],
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="labelLg" color={colors.ink}>
              {t(`apply.doc.${kind}`)}
            </Text>
            <Text variant="caption" weight={have(kind) ? 600 : 400} color={have(kind) ? colors.brand : colors.inkMuted}>
              {t(have(kind) ? 'apply.docAdded' : `apply.docHint.${kind}`)}
            </Text>
          </View>
          <Button
            label={t(have(kind) ? 'apply.replace' : 'apply.addPhoto')}
            accessibilityLabel={`${t(have(kind) ? 'apply.replace' : 'apply.addPhoto')}: ${t(`apply.doc.${kind}`)}`}
            variant="secondary"
            size="sm"
            loading={upload.isPending && upload.variables === kind}
            disabled={upload.isPending}
            onPress={() => upload.mutate(kind)}
          />
        </View>
      ))}
    </>
  );
}
