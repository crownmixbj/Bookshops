import { Platform } from 'react-native';

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

  // Text — the three rungs of the type scale, and nothing else.
  //
  // Re-pointed onto the new palette rather than added alongside it, so
  // components that were never touched by the audit shift with the ones
  // that were. Anything else means two greys that are nearly the same
  // and a dashboard that reads as slightly out of register.
  //
  // Contrast on white, measured (WCAG AA needs 4.5:1 at any size):
  //   text       #1A2536  15.42:1   was #152238 15.94:1
  //   textMuted  #334155  10.35:1   was #5B6B85  5.40:1
  //   textFaint  #64748B   4.76:1   was #8B99AE  3.10:1  ← was FAILING
  //
  // textFaint is the one that matters: every caption, timestamp and
  // "3 of 12 quoted" note in the app was below the AA floor and is now
  // above it. textMuted moves the other way, from comfortable to dark;
  // that is the spec's call, not an accident.
  text: '#1A2536',
  textMuted: '#334155',
  textFaint: '#64748B',
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
 * The font stack — web only, deliberately.
 *
 * 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
 * sans-serif' is CSS. It is a LIST, and only a browser knows how to walk
 * it. React Native on iOS and Android takes fontFamily as the name of
 * ONE registered family: hand it that string and iOS matches nothing and
 * silently falls back, while Android has been known to render the string
 * as a family name and produce a default face with the wrong metrics.
 * Either way the native builds get no Inter and no guarantee of what
 * they do get.
 *
 * So native is left undefined — San Francisco on iOS, Roboto on Android,
 * which is what the stack asks for on those platforms anyway. To put
 * real Inter on native, add the .ttf files under assets/fonts, load them
 * with expo-font's useFonts in app/_layout.js, and set this to the single
 * family name 'Inter' under `default`.
 *
 * On web the stack is ALSO applied globally in app/+html.tsx, so text
 * that never reads a token here still inherits it.
 */
export const fontStack = Platform.select({
  web: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  default: undefined,
});

/**
 * The type scale. One object per rung, spread straight into a style.
 *
 *   ...typography.cardTitle     rather than
 *   fontSize: 18, fontWeight: '600', lineHeight: 23, color: '#1A2536'
 *
 * Spreading a whole rung is the point: size, weight, line height and
 * colour travel together, so a component cannot take the size of a card
 * title and the colour of body text and invent a fourth rung nobody
 * designed.
 *
 * lineHeight is in PIXELS here, not a ratio — React Native has no
 * unitless line-height. The CSS ratios from the spec are multiplied out
 * and rounded, and the comment on each rung keeps the original so the
 * intent survives the arithmetic.
 *
 * The annotation below is load-bearing, not decoration. Without it TS
 * infers `fontWeight: string` from this plain-JS object, and TextStyle
 * wants the literal union ('400' | '500' | ...). A rung that is not a
 * valid TextStyle poisons StyleSheet.create's per-key inference in every
 * .tsx file that spreads one, and the first symptom is a Pressable
 * complaining that a TextStyle is not a ViewStyle. The annotation gives
 * the literals a contextual type so they stay literal.
 *
 * @type {Record<string, import('react-native').TextStyle>}
 */
export const typography = {
  /** Hero headline, phone and tablet. 28px / 700 / 1.2 */
  heroTitle: {
    fontFamily: fontStack,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: -0.4,
  },
  /** Hero headline, desktop. 32px / 700 / 1.2 */
  heroTitleLarge: {
    fontFamily: fontStack,
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 38,
    letterSpacing: -0.5,
  },
  /** Card and section titles. 18px / 600 / 1.3 / #1A2536 */
  cardTitle: {
    fontFamily: fontStack,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 23,
    color: colors.text,
    letterSpacing: -0.2,
  },
  /** Secondary headings, row titles, empty-state titles. 15px / 500 / #334155 */
  heading: {
    fontFamily: fontStack,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
    color: colors.textMuted,
  },
  /**
   * An empty-state title. Same 15px as `heading`, but 600 and the title
   * ink — the spec asks for these to separate from the grey body line
   * directly beneath them, and at 15px weight is the only lever left.
   */
  emptyTitle: {
    fontFamily: fontStack,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    color: colors.text,
  },
  /** Body copy. 14px / 400 / 1.5 / #64748B */
  body: {
    fontFamily: fontStack,
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 21,
    color: colors.textFaint,
  },
  /**
   * Body that carries weight — a value beside a label, a name in a row.
   * Same rung as `body` so the two sit on one baseline grid; only the
   * weight and ink change.
   */
  bodyStrong: {
    fontFamily: fontStack,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 21,
    color: colors.text,
  },
  /** Micro and banner text. 13px / 500 / +0.3 tracking */
  micro: {
    fontFamily: fontStack,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    letterSpacing: 0.3,
  },
  /** The smallest rung — pills, badges, captions. 12px / 500 / +0.3 */
  caption: {
    fontFamily: fontStack,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    letterSpacing: 0.3,
    color: colors.textFaint,
  },
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
