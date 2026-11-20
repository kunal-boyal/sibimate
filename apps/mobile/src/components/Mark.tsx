import { colors } from '@sibimate/ui-tokens';
import Svg, { Circle } from 'react-native-svg';

/**
 * The Sibimate mark: a marigold disc overlapped by a white ring. It is drawn
 * for the brand-green and dark grounds only; on light grounds use the wordmark alone.
 */
export function Mark({ width = 44 }: { width?: number }) {
  return (
    <Svg width={width} height={(width * 32) / 44} viewBox="0 0 44 32" accessibilityLabel="Sibimate">
      <Circle cx={16} cy={16} r={14} fill={colors.accent} />
      <Circle cx={28} cy={16} r={14} fill="none" stroke={colors.onBrand} strokeWidth={4} />
    </Svg>
  );
}
