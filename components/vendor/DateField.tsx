import { useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, font, shadow } from '../../theme';
import { formatDay, monthGrid, todayKey, type DayKey } from '../../lib/promoDates';

/**
 * A date field with its own small calendar.
 *
 * The project has no date-picker dependency, and a typed "2026-10-01"
 * box is how people book the wrong month. This is one component that
 * behaves the same on web, iOS and Android, and greys out every day
 * outside [min, max] so an invalid range cannot be picked at all.
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
}: {
  label: string;
  value: DayKey;
  onChange: (key: DayKey) => void;
  min: DayKey;
  max: DayKey;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [y0, m0] = value.split('-').map(Number);
  const [cursor, setCursor] = useState<{ y: number; m: number }>({ y: y0, m: m0 });

  const today = todayKey();
  const [minY, minM] = min.split('-').map(Number);
  const [maxY, maxM] = max.split('-').map(Number);
  const canPrev = cursor.y > minY || (cursor.y === minY && cursor.m > minM);
  const canNext = cursor.y < maxY || (cursor.y === maxY && cursor.m < maxM);

  function shift(delta: number) {
    setCursor(({ y, m }) => {
      const n = m + delta;
      return n < 1 ? { y: y - 1, m: 12 } : n > 12 ? { y: y + 1, m: 1 } : { y, m: n };
    });
  }

  const monthLabel = new Date(Date.UTC(cursor.y, cursor.m - 1, 15)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={() => {
          const [y, m] = value.split('-').map(Number);
          setCursor({ y, m });
          setOpen(true);
        }}
        style={({ pressed }) => [styles.input, pressed && styles.inputPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${formatDay(value)}. Change date`}
      >
        <Ionicons name="calendar-outline" size={16} color={colors.navy} />
        <Text style={styles.value}>
          {formatDay(value)}
          {value === today ? ' (today)' : ''}
        </Text>
        <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
      </Pressable>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityLabel="Close calendar" />
        <View style={styles.sheetWrap} pointerEvents="box-none">
          <View style={styles.sheet} accessibilityViewIsModal>
            <View style={styles.sheetHead}>
              <Pressable
                onPress={() => shift(-1)}
                disabled={!canPrev}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Previous month"
              >
                <Ionicons name="chevron-back" size={20} color={canPrev ? colors.text : colors.border} />
              </Pressable>
              <Text style={styles.month}>{monthLabel}</Text>
              <Pressable
                onPress={() => shift(1)}
                disabled={!canNext}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Next month"
              >
                <Ionicons name="chevron-forward" size={20} color={canNext ? colors.text : colors.border} />
              </Pressable>
            </View>

            <View style={styles.week}>
              {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
                <Text key={d} style={styles.weekday}>
                  {d}
                </Text>
              ))}
            </View>

            {monthGrid(cursor.y, cursor.m).map((row, i) => (
              <View key={i} style={styles.week}>
                {row.map((key, j) => {
                  if (!key) return <View key={j} style={styles.cell} />;
                  const disabled = key < min || key > max;
                  const selected = key === value;
                  return (
                    <Pressable
                      key={key}
                      disabled={disabled}
                      onPress={() => {
                        onChange(key);
                        setOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.cell,
                        styles.day,
                        selected && styles.daySelected,
                        pressed && !selected && styles.dayPressed,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled }}
                      accessibilityLabel={formatDay(key)}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          key === today && styles.dayToday,
                          disabled && styles.dayDisabled,
                          selected && styles.dayTextSelected,
                        ]}
                      >
                        {Number(key.slice(8))}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}

            <Text style={styles.tz}>Dates are Lagos time (WAT).</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 5 },
  label: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  input: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  inputPressed: { backgroundColor: colors.surfaceMuted },
  value: { flex: 1, fontSize: font.md, color: colors.text },
  hint: { fontSize: font.xs, color: colors.textFaint },

  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,30,61,0.45)' },
  sheetWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  sheet: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 4,
    ...shadow.raised,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  month: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: font.xs, fontWeight: '700', color: colors.textFaint, paddingVertical: 4 },
  cell: { flex: 1, aspectRatio: 1, maxHeight: 44 },
  day: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  dayPressed: { backgroundColor: colors.surfaceMuted },
  daySelected: { backgroundColor: colors.navy },
  dayText: { fontSize: font.md, color: colors.text },
  dayToday: { fontWeight: '800', color: colors.orangeDark },
  dayDisabled: { color: colors.border },
  dayTextSelected: { color: colors.onNavy, fontWeight: '800' },
  tz: { fontSize: font.xs, color: colors.textFaint, marginTop: spacing.sm, textAlign: 'center' },
});
