import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Path, Line, Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font } from '../../theme';
import type { AnalyticsBucket } from '../../hooks/useVendorAnalytics';

/**
 * The analytics page's charts, hand-built on View and react-native-svg
 * so they run the same on web, iOS and Android with no chart library.
 *
 * Series colours, validated for colour-blind separation and contrast on
 * white (dataviz validator: all checks pass):
 *   SERIES_A  #2C4E8A  navyLight   — quotes
 *   SERIES_B  #D9601A  orangeDark  — orders / revenue
 * Brand navy (#1E3A6E) was too dark to sit in the chart lightness band,
 * and brand orange (#F2762E) is under 3:1 on white, so neither is used
 * for a mark. Text never takes a series colour.
 *
 * Every chart answers hover (web) and tap (touch) with a readout above
 * the plot, so an exact value is always one gesture away.
 */
export const SERIES_A = colors.navyLight;
export const SERIES_B = colors.orangeDark;

const GRID = colors.border;
const AXIS_TEXT = colors.textFaint;

/** 1, 2, 5 × 10^k at or above v — gridlines land on round numbers. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return step * exp;
}

/** ₦1.2m, ₦45k, ₦800 — for axis ticks only; tooltips show the full figure. */
export function compactNaira(v: number): string {
  if (v >= 1_000_000) return `₦${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}m`;
  if (v >= 1_000) return `₦${Math.round(v / 1_000)}k`;
  return `₦${Math.round(v)}`;
}

/** Show every nth x label so they never collide. */
function labelStride(count: number, width: number): number {
  const fit = Math.max(Math.floor(width / 44), 1);
  return Math.max(Math.ceil(count / fit), 1);
}

function Readout({ text, placeholder }: { text: string | null; placeholder: string }) {
  return (
    <Text style={[styles.readout, !text && styles.readoutIdle]} numberOfLines={1} accessibilityLiveRegion="polite">
      {text ?? placeholder}
    </Text>
  );
}

/* ------------------------------------------------------------------ */
/* Bar chart — one series                                              */
/* ------------------------------------------------------------------ */

export function BarChart({
  buckets,
  value,
  format,
  tickFormat,
  describe,
  color = SERIES_B,
  height = 180,
}: {
  buckets: AnalyticsBucket[];
  value: (b: AnalyticsBucket) => number;
  format: (v: number) => string;
  tickFormat: (v: number) => string;
  /** Extra detail for the readout, e.g. "2 orders". */
  describe?: (b: AnalyticsBucket) => string;
  color?: string;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  const values = buckets.map(value);
  const max = niceMax(Math.max(...values, 0));
  const ticks = [max, max / 2, 0];
  const stride = labelStride(buckets.length, width);
  const h = hover != null ? buckets[hover] : null;

  return (
    <View>
      <Readout
        text={h ? `${h.title} · ${format(value(h))}${describe ? ` · ${describe(h)}` : ''}` : null}
        placeholder="Hover or tap a bar for its figure"
      />
      <View style={styles.plotRow}>
        <View style={[styles.yAxis, { height }]}>
          {ticks.map((t) => (
            <Text key={t} style={styles.tick}>
              {tickFormat(t)}
            </Text>
          ))}
        </View>

        <View style={styles.plotArea} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
          <View style={[styles.grid, { height }]} pointerEvents="none">
            {ticks.map((t, i) => (
              <View key={t} style={[styles.gridLine, i === ticks.length - 1 && styles.baseline]} />
            ))}
          </View>

          <View style={[styles.bars, { height }]}>
            {buckets.map((b, i) => {
              const v = values[i];
              const pct = max > 0 ? v / max : 0;
              const active = hover === i;
              return (
                <Pressable
                  key={b.key}
                  style={styles.barHit}
                  onHoverIn={() => setHover(i)}
                  onHoverOut={() => setHover((cur) => (cur === i ? null : cur))}
                  onPress={() => setHover((cur) => (cur === i ? null : i))}
                  accessibilityRole="button"
                  accessibilityLabel={`${b.title}: ${format(v)}`}
                >
                  {v > 0 && (
                    <View
                      style={[
                        styles.bar,
                        {
                          height: Math.max(pct * height, 3),
                          backgroundColor: color,
                          opacity: hover == null || active ? 1 : 0.45,
                        },
                      ]}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.xAxis}>
            {buckets.map((b, i) => (
              <Text key={b.key} style={styles.xLabel} numberOfLines={1}>
                {i % stride === 0 ? b.label : ''}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Line chart — two series on one scale                                */
/* ------------------------------------------------------------------ */

export function DualLineChart({
  buckets,
  a,
  b,
  height = 180,
}: {
  buckets: AnalyticsBucket[];
  a: { label: string; value: (x: AnalyticsBucket) => number };
  b: { label: string; value: (x: AnalyticsBucket) => number };
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  const av = buckets.map(a.value);
  const bv = buckets.map(b.value);
  // Counts: keep the midline on a whole number — "2.5 quotes" is not a thing.
  const peak = Math.max(...av, ...bv, 0);
  let max = niceMax(peak);
  if (!Number.isInteger(max / 2)) max = Math.max(Math.ceil(peak / 2) * 2, 2);
  const ticks = [max, max / 2, 0];
  const pad = 6;
  const n = buckets.length;
  const x = (i: number) => (n <= 1 ? width / 2 : pad + (i * (width - pad * 2)) / (n - 1));
  const y = (v: number) => pad + (1 - v / max) * (height - pad * 2);
  const path = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const stride = labelStride(n, width);
  const h = hover != null ? buckets[hover] : null;

  return (
    <View>
      <View style={styles.legend}>
        <LegendKey color={SERIES_A} label={a.label} />
        <LegendKey color={SERIES_B} label={b.label} />
      </View>
      <Readout
        text={h ? `${h.title} · ${a.label}: ${a.value(h)} · ${b.label}: ${b.value(h)}` : null}
        placeholder="Hover or tap the chart for a day’s figures"
      />
      <View style={styles.plotRow}>
        <View style={[styles.yAxis, { height }]}>
          {ticks.map((t) => (
            <Text key={t} style={styles.tick}>
              {t}
            </Text>
          ))}
        </View>

        <View style={styles.plotArea} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
          <View style={[styles.grid, { height }]} pointerEvents="none">
            {ticks.map((t, i) => (
              <View key={t} style={[styles.gridLine, i === ticks.length - 1 && styles.baseline]} />
            ))}
          </View>

          {width > 0 && n > 0 && (
            <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
              {hover != null && (
                <Line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke={colors.borderStrong} strokeWidth={1} />
              )}
              <Path d={path(av)} stroke={SERIES_A} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              <Path d={path(bv)} stroke={SERIES_B} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              {hover != null && (
                <>
                  <Circle cx={x(hover)} cy={y(av[hover])} r={5} fill={SERIES_A} stroke={colors.surface} strokeWidth={2} />
                  <Circle cx={x(hover)} cy={y(bv[hover])} r={5} fill={SERIES_B} stroke={colors.surface} strokeWidth={2} />
                </>
              )}
            </Svg>
          )}

          {/* Hit targets: one column per point, wider than any mark. */}
          <View style={[styles.hitRow, { height }]}>
            {buckets.map((bk, i) => (
              <Pressable
                key={bk.key}
                style={styles.hitCol}
                onHoverIn={() => setHover(i)}
                onHoverOut={() => setHover((cur) => (cur === i ? null : cur))}
                onPress={() => setHover((cur) => (cur === i ? null : i))}
                accessibilityRole="button"
                accessibilityLabel={`${bk.title}: ${a.label} ${av[i]}, ${b.label} ${bv[i]}`}
              />
            ))}
          </View>

          <View style={styles.xAxis}>
            {buckets.map((bk, i) => (
              <Text key={bk.key} style={styles.xLabel} numberOfLines={1}>
                {i % stride === 0 ? bk.label : ''}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendKey}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Quote outcomes — one stacked bar, three states                      */
/* ------------------------------------------------------------------ */

const OUTCOME = {
  won: { label: 'Won', color: colors.success, icon: 'checkmark-circle' as const },
  awaiting: { label: 'Awaiting buyer', color: colors.warning, icon: 'time' as const },
  declined: { label: 'Declined / expired', color: colors.textFaint, icon: 'close-circle' as const },
};

export function OutcomeBar({ won, awaiting, declined }: { won: number; awaiting: number; declined: number }) {
  const total = won + awaiting + declined;
  const parts = (['won', 'awaiting', 'declined'] as const).map((k) => ({
    key: k,
    n: k === 'won' ? won : k === 'awaiting' ? awaiting : declined,
    ...OUTCOME[k],
  }));

  if (total === 0) {
    return <Text style={styles.readoutIdle}>No quotes sent in this period.</Text>;
  }

  return (
    <View style={styles.outcome}>
      <View style={styles.stack} accessibilityLabel={parts.map((p) => `${p.label} ${p.n}`).join(', ')}>
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <View key={p.key} style={[styles.segment, { flex: p.n, backgroundColor: p.color }]} />
          ))}
      </View>
      <View style={styles.outcomeKeys}>
        {parts.map((p) => (
          <View key={p.key} style={styles.outcomeKey}>
            <Ionicons name={p.icon} size={14} color={p.color} />
            <Text style={styles.outcomeLabel}>{p.label}</Text>
            <Text style={styles.outcomeValue}>
              {p.n} <Text style={styles.outcomePct}>({Math.round((p.n / total) * 100)}%)</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  readout: { fontSize: font.sm, fontWeight: '700', color: colors.text, marginBottom: spacing.sm, minHeight: 18 },
  readoutIdle: { fontSize: font.sm, fontWeight: '400', color: colors.textFaint },

  plotRow: { flexDirection: 'row', gap: spacing.sm },
  yAxis: { justifyContent: 'space-between', alignItems: 'flex-end', minWidth: 34 },
  tick: { fontSize: 10, color: AXIS_TEXT, lineHeight: 12, marginTop: -6 },
  plotArea: { flex: 1, minWidth: 0 },

  grid: { position: 'absolute', left: 0, right: 0, top: 0, justifyContent: 'space-between' },
  gridLine: { height: 1, backgroundColor: GRID },
  baseline: { backgroundColor: colors.borderStrong },

  bars: { flexDirection: 'row', alignItems: 'flex-end' },
  barHit: { flex: 1, height: '100%', justifyContent: 'flex-end', paddingHorizontal: 1 },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4, maxWidth: 36, width: '100%', alignSelf: 'center' },

  hitRow: { flexDirection: 'row' },
  hitCol: { flex: 1, height: '100%' },

  xAxis: { flexDirection: 'row', marginTop: 6 },
  xLabel: { flex: 1, fontSize: 10, color: AXIS_TEXT, textAlign: 'center' },

  legend: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.sm, flexWrap: 'wrap' },
  legendKey: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 3, borderRadius: 2 },
  legendText: { fontSize: font.sm, color: colors.textMuted, fontWeight: '600' },

  outcome: { gap: spacing.md },
  stack: { flexDirection: 'row', height: 14, borderRadius: radius.pill, overflow: 'hidden', gap: 2 },
  segment: { height: '100%' },
  outcomeKeys: { gap: spacing.sm },
  outcomeKey: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  outcomeLabel: { flex: 1, fontSize: font.sm, color: colors.textMuted },
  outcomeValue: { fontSize: font.sm, fontWeight: '800', color: colors.text },
  outcomePct: { fontWeight: '500', color: colors.textFaint },
});
