import type { Language } from '@sibimate/shared';
import { colors, radius, size, space } from '@sibimate/ui-tokens';
import { Pressable, View } from 'react-native';
import { useSession } from '@/lib/session';
import { Text } from './Text';

const OPTIONS: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी' },
];

/** The English and हिन्दी pills from the welcome screen, on brand green. */
export function LanguageToggle() {
  const language = useSession((state) => state.language);
  const setLanguage = useSession((state) => state.setLanguage);
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', justifyContent: 'center', gap: space[8] }}>
      {OPTIONS.map(({ value, label }) => {
        const selected = value === language;
        return (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => void setLanguage(value)}
            style={{
              minHeight: size.control,
              paddingHorizontal: 18,
              justifyContent: 'center',
              borderRadius: radius.pill,
              borderWidth: 1.5,
              borderColor: selected ? colors.surface : colors.brandLine,
              backgroundColor: selected ? colors.surface : 'transparent',
            }}
          >
            <Text variant="bodySm" weight={600} color={selected ? colors.ink : colors.onBrand}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
