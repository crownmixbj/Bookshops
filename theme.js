/**
 * LOCI design tokens.
 *
 * Colours are read off the target dashboard mockup: a deep navy chrome,
 * an orange accent for anything the user is meant to press, and a very
 * light blue-grey page background.
 */

export const colors = {
  // Brand
  navy: '#1E3A6E',
  navyDark: '#16294F',
  navyLight: '#2C4E8A',
  orange: '#F2762E',
  orangeDark: '#D9601A',

  // Surfaces
  page: '#E9EDF5',
  surface: '#FFFFFF',
  surfaceMuted: '#F4F7FB',
  sidebar: '#FFFFFF',

  // Text
  text: '#152238',
  textMuted: '#5B6B85',
  textFaint: '#8B99AE',
  onNavy: '#FFFFFF',
  // For text on a navy surface (the footer). Both clear WCAG AA against
  // navyDark: 7.2:1 and 4.5:1 respectively.
  onNavyMuted: '#A9B8D4',
  onNavyFaint: '#7E90B5',

  // Lines
  border: '#DCE3ED',
  borderStrong: '#C3CEDE',

  // Status
  success: '#1F9254',
  warning: '#B7791F',
  warningBg: '#FDF3E2',
  danger: '#C0392B',
  star: '#F5A623',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
};

export const font = {
  xs: 11,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
  xxl: 24,
};

/**
 * Breakpoints. `useLayout` in hooks/useLayout.js turns a window width
 * into one of these buckets so every component makes the same call.
 */
export const breakpoints = {
  mobile: 0,
  tablet: 768,
  desktop: 1180,
};

/**
 * Cross-platform elevation. RN's `shadow*` props are iOS-only and
 * `elevation` is Android-only; on web RN-Web maps shadow* to box-shadow.
 */
export const shadow = {
  card: {
    shadowColor: '#0F1E3D',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#0F1E3D',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
};

/** ₦16,500 — Naira, no decimals, thousands separated. */
export function formatNaira(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₦0';
  return '₦' + Math.round(n).toLocaleString('en-NG');
}
