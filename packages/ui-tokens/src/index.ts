/**
 * The Sibimate design system as TypeScript, mirrored from its tokens.json
 * (https://claude.ai/artifact/PxZhHugugLqpZvHXyTSz3x). Names match the system's
 * token names in camelCase. Change the design system first, then this file.
 */

/** Customer screens and the admin dashboard. */
const light = {
  ground: '#F4F6F2',
  surface: '#FFFFFF',
  surfaceSunken: '#E2E8E1',
  ink: '#13211C',
  inkMuted: '#55635D',
  border: '#DFE5DF',
  borderStrong: '#C9D3CB',
  brand: '#0E5A47',
  brandPressed: '#0A4335',
  brandRaised: '#1A6B57',
  brandSoft: '#E3F0EA',
  brandLine: '#8FC2B2',
  onBrand: '#FFFFFF',
  onBrandMuted: '#D9EBE4',
  accent: '#F4B321',
  accentHover: '#FFD060',
  accentSoft: '#FFF3D1',
  onAccent: '#13211C',
  onAccentSoft: '#4A4222',
  inverse: '#13211C',
  onInverse: '#FFFFFF',
  danger: '#9A3412',
  alertSoft: '#FDE8DC',
  alertInk: '#7A2A0C',
  warning: '#C2570C',
  success: '#2F9E7E',
  successOnDark: '#6FD3B4',
  inkOnSoft: '#33443D',
  stepPending: '#A9B8B1',
  chartMuted: '#A9C9BD',
  mapGround: '#DCE6DD',
  mapBlock: '#CFDCD1',
} as const;

export type ColorName = keyof typeof light;
export type Theme = Record<ColorName, string>;

/** Helper (Earn) screens. Only the colours those screens change; the rest fall back to light. */
const dark: Theme = {
  ...light,
  ground: '#13211C',
  surface: '#1D2E28',
  surfaceSunken: '#1D2E28',
  ink: '#F4F6F2',
  inkMuted: '#B4C2BB',
  border: '#2E423B',
  borderStrong: '#47605A',
  chartMuted: '#47605A',
};

export const themes = { light: light as Theme, dark } as const;
export type ThemeName = keyof typeof themes;

/** The light theme, for code that never renders a helper screen. */
export const colors = themes.light;

export const fontFamilies = {
  /** Headings, prices, figures, code digits and the wordmark. Weights 500 to 700. */
  display: 'Space Grotesk',
  /** Everything else. Weights 400 to 700. */
  sans: 'Inter',
} as const;

export interface TextStyle {
  family: keyof typeof fontFamilies;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  lineHeight?: number;
  letterSpacing?: number;
  uppercase?: boolean;
}

export const textStyles = {
  displayXl: {
    family: 'display',
    fontSize: 44,
    fontWeight: 700,
    lineHeight: 46,
    letterSpacing: -1,
  },
  displayLg: {
    family: 'display',
    fontSize: 40,
    fontWeight: 700,
    lineHeight: 44,
  },
  titleXl: {
    family: 'display',
    fontSize: 32,
    fontWeight: 700,
    lineHeight: 36,
    letterSpacing: -0.5,
  },
  titleLg: {
    family: 'display',
    fontSize: 30,
    fontWeight: 700,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  wordmark: {
    family: 'display',
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: -0.5,
  },
  figure: { family: 'display', fontSize: 24, fontWeight: 700 },
  titleMd: { family: 'display', fontSize: 22, fontWeight: 700 },
  titleSm: { family: 'display', fontSize: 20, fontWeight: 700, lineHeight: 26 },
  code: { family: 'display', fontSize: 30, fontWeight: 700, letterSpacing: 6 },
  lead: { family: 'sans', fontSize: 17, fontWeight: 400, lineHeight: 26 },
  bodyLg: { family: 'sans', fontSize: 17, fontWeight: 500, lineHeight: 24 },
  labelLg: { family: 'sans', fontSize: 16, fontWeight: 600, lineHeight: 22 },
  body: { family: 'sans', fontSize: 15, fontWeight: 400 },
  bodySm: { family: 'sans', fontSize: 14, fontWeight: 400, lineHeight: 20 },
  caption: { family: 'sans', fontSize: 13, fontWeight: 400, lineHeight: 18 },
  micro: { family: 'sans', fontSize: 12, fontWeight: 500, lineHeight: 18 },
  overline: {
    family: 'sans',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 0.4,
    uppercase: true,
  },
} as const satisfies Record<string, TextStyle>;

export type TextStyleName = keyof typeof textStyles;

/** space-N in the design system is space[N] here, in px. */
export const space = {
  2: 2,
  4: 4,
  6: 6,
  8: 8,
  10: 10,
  12: 12,
  14: 14,
  16: 16,
  20: 20,
  24: 24,
  28: 28,
  32: 32,
  40: 40,
} as const;

/** radius-N is radius[N]. Use `pill` for chips and toggles; a circle is half the element's size. */
export const radius = {
  2: 2,
  6: 6,
  10: 10,
  12: 12,
  14: 14,
  16: 16,
  18: 18,
  20: 20,
  24: 24,
  28: 28,
  pill: 999,
} as const;

/** Control heights. Every tappable control is at least `control` (44px). */
export const size = {
  controlSm: 36,
  control: 44,
  controlMd: 48,
  controlLg: 52,
  controlXl: 56,
} as const;
