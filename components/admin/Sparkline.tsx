import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../../theme';

/**
 * A 14-day sparkline for a metric tile.
 *
 * Deliberately minimal: one series, no axes, no legend, no gridlines. A
 * sparkline's job is shape, not values — the exact number is the large
 * figure beside it, so a second encoding here would be noise.
 *
 * Stroke colour is chosen for contrast against the white card, not for
 * brand match: navy measures 11.1:1 and the brand orange only 2.84:1,
 * which is below the 3:1 a lone mark needs. The revenue tile therefore
 * uses the darker orange (3.72:1) rather than the header orange.
 */
const SPARK_NAVY = colors.navy;      // 11.14:1 on #FFFFFF
const SPARK_ORANGE = colors.orangeDark; // 3.72:1 on #FFFFFF

export function Sparkline({
  data,
  accent,
  width = 150,
  height = 40,
}: {
  data: number[] | undefined;
  accent?: boolean;
  width?: number;
  height?: number;
}) {
  const values = (data ?? []).map((n) => Number(n) || 0);
  const stroke = accent ? SPARK_ORANGE : SPARK_NAVY;
  const gradientId = accent ? 'sparkFillAccent' : 'sparkFill';

  if (values.length < 2) {
    return (
      <View style={[styles.flat, { width, height }]}>
        <Text style={styles.flatText}>Not enough history yet</Text>
      </View>
    );
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pad = 3;
  const stepX = (width - pad * 2) / (values.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);

  const points = values.map((v, i) => [pad + i * stepX, y(v)] as const);
  const line = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;
  const last = points[points.length - 1];

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={stroke} stopOpacity={0.22} />
          <Stop offset="1" stopColor={stroke} stopOpacity={0.02} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill={`url(#${gradientId})`} />
      {/* 2px stroke, per the mark spec for lines. */}
      <Path d={line} stroke={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {/* The latest point is the one worth anchoring; a dot on every
          point would be a number-on-every-mark in disguise. */}
      <Circle cx={last[0]} cy={last[1]} r={3} fill={stroke} stroke={colors.surface} strokeWidth={1.5} />
    </Svg>
  );
}

/** Metric tile: figure, 14-day shape, and change vs the previous 7 days. */
export function MetricCard({
  label,
  value,
  series,
  trend,
  accent,
  width,
}: {
  label: string;
  value: string;
  series: number[] | undefined;
  trend: number | null;
  accent?: boolean;
  width?: number;
}) {
  const up = trend != null && trend > 0;
  const down = trend != null && trend < 0;

  return (
    <View style={[styles.card, width ? { width } : undefined]}>
      <View style={styles.cardHead}>
        <Text style={styles.cardLabel} numberOfLines={1}>
          {label}
        </Text>
        {trend != null && (
          <View style={styles.trend}>
            <Ionicons
              name={up ? 'trending-up' : down ? 'trending-down' : 'remove'}
              size={13}
              color={up ? colors.success : down ? colors.danger : colors.textFaint}
            />
            <Text
              style={[
                styles.trendText,
                { color: up ? colors.success : down ? colors.danger : colors.textFaint },
              ]}
            >
              {trend > 0 ? '+' : ''}
              {trend.toFixed(2)}%
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.cardValue} numberOfLines={1}>
        {value}
      </Text>

      <View style={styles.spark}>
        <Sparkline data={series} accent={accent} width={(width ?? 200) - 32} />
      </View>

      <Text style={styles.cardFoot}>Last 14 days</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardLabel: { flex: 1, fontSize: font.sm, color: colors.textMuted, fontWeight: '600' },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  trendText: { fontSize: font.xs, fontWeight: '700' },
  cardValue: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: 4 },
  spark: { marginTop: spacing.sm },
  cardFoot: { fontSize: font.xs, color: colors.textFaint, marginTop: 4 },

  flat: { alignItems: 'center', justifyContent: 'center' },
  flatText: { fontSize: font.xs, color: colors.textFaint, fontStyle: 'italic' },
});
