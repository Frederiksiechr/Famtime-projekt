import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, PanResponder, StyleSheet } from 'react-native';
import { colors, spacing, fontSizes, radius } from '../styles/theme';

const STEP_MINUTES = 15;
const MIN_RANGE_MINUTES = 15;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const DurationRangeSlider = ({
  minValue,
  maxValue,
  onChange,
  minLimit = STEP_MINUTES,
  maxLimit = 5 * 60,
  step = STEP_MINUTES,
  minGap = MIN_RANGE_MINUTES,
}) => {
  const [trackWidth, setTrackWidth] = useState(0);

  const normalizedRange = useMemo(() => {
    const normalizedMin = clamp(
      Math.round(minValue / step) * step || minLimit,
      minLimit,
      maxLimit - minGap
    );
    const normalizedMax = clamp(
      Math.round(maxValue / step) * step || normalizedMin + minGap,
      normalizedMin + minGap,
      maxLimit
    );
    return [normalizedMin, normalizedMax];
  }, [minValue, maxValue, maxLimit, minLimit, minGap, step]);

  const [currentMin, currentMax] = normalizedRange;

  const rangeRef = useRef({ min: currentMin, max: currentMax });
  useEffect(() => {
    rangeRef.current = { min: currentMin, max: currentMax };
  }, [currentMin, currentMax]);

  const dragOriginRef = useRef({ min: currentMin, max: currentMax });

  const minutesFromDelta = useCallback(
    (dx) => {
      if (!trackWidth) {
        return 0;
      }
      const rawMinutes = (dx / trackWidth) * (maxLimit - minLimit);
      return Math.round(rawMinutes / step) * step;
    },
    [trackWidth, maxLimit, minLimit, step]
  );

  const emitChange = useCallback(
    (nextMin, nextMax) => {
      if (typeof onChange === 'function') {
        const normalizedMin = clamp(nextMin, minLimit, maxLimit - minGap);
        const normalizedMax = clamp(
          Math.max(normalizedMin + minGap, nextMax),
          normalizedMin + minGap,
          maxLimit
        );
        onChange(normalizedMin, normalizedMax);
      }
    },
    [maxLimit, minGap, minLimit, onChange]
  );

  const handleMinGrant = useCallback(() => {
    dragOriginRef.current.min = rangeRef.current.min;
  }, []);

  const handleMinMove = useCallback(
    (_, gestureState) => {
      const base = dragOriginRef.current.min;
      const delta = minutesFromDelta(gestureState.dx);
      const nextMin = clamp(base + delta, minLimit, rangeRef.current.max - minGap);
      emitChange(nextMin, rangeRef.current.max);
    },
    [emitChange, minGap, minLimit, minutesFromDelta]
  );

  const handleMaxGrant = useCallback(() => {
    dragOriginRef.current.max = rangeRef.current.max;
  }, []);

  const handleMaxMove = useCallback(
    (_, gestureState) => {
      const base = dragOriginRef.current.max;
      const delta = minutesFromDelta(gestureState.dx);
      const nextMax = clamp(
        base + delta,
        rangeRef.current.min + minGap,
        maxLimit
      );
      emitChange(rangeRef.current.min, nextMax);
    },
    [emitChange, maxLimit, minGap, minutesFromDelta]
  );

  const createPanResponder = (onGrant, onMove) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: onGrant,
      onPanResponderMove: onMove,
    });

  const minResponder = useMemo(
    () => createPanResponder(handleMinGrant, handleMinMove),
    [handleMinGrant, handleMinMove]
  );

  const maxResponder = useMemo(
    () => createPanResponder(handleMaxGrant, handleMaxMove),
    [handleMaxGrant, handleMaxMove]
  );

  const toPosition = (value) => {
    if (!trackWidth) {
      return 0;
    }
    const ratio = (value - minLimit) / (maxLimit - minLimit);
    return ratio * trackWidth;
  };

  const minPosition = toPosition(currentMin);
  const maxPosition = toPosition(currentMax);

  const formatLabel = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (!hours) {
      return `${mins} min`;
    }
    if (!mins) {
      return `${hours} t.`;
    }
    return `${hours} t. ${mins} min`;
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.sliderLabelRow}>
        <Text style={styles.sliderLabel}>{formatLabel(currentMin)}</Text>
        <Text style={styles.sliderLabel}>{formatLabel(currentMax)}</Text>
      </View>
      <View
        style={styles.sliderTrack}
        onLayout={({ nativeEvent }) => setTrackWidth(nativeEvent.layout.width)}
      >
        <View style={styles.sliderBackground} />
        <View
          style={[
            styles.sliderSelection,
            {
              left: minPosition,
              width: Math.max(0, maxPosition - minPosition),
            },
          ]}
        />
        <View
          style={[
            styles.sliderHandle,
            { left: minPosition - styles.sliderHandle.width / 2 },
          ]}
          {...minResponder.panHandlers}
        >
          <View style={styles.sliderHandleDot} />
        </View>
        <View
          style={[
            styles.sliderHandle,
            { left: maxPosition - styles.sliderHandle.width / 2 },
          ]}
          {...maxResponder.panHandlers}
        >
          <View style={styles.sliderHandleDot} />
        </View>
      </View>
      <Text style={styles.sliderHelper}>
        Træk i håndtagene for at sætte min og max varighed.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.sm,
  },
  sliderLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  sliderLabel: {
    fontSize: fontSizes.sm,
    color: colors.text,
    fontWeight: '600',
  },
  sliderTrack: {
    position: 'relative',
    height: 32,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  sliderBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(75, 46, 18, 0.15)',
  },
  sliderSelection: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(230, 138, 46, 0.35)',
  },
  sliderHandle: {
    position: 'absolute',
    top: -6,
    width: 28,
    height: 44,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  sliderHandleDot: {
    width: 6,
    height: 18,
    borderRadius: 3,
    backgroundColor: colors.surface,
  },
  sliderHelper: {
    marginTop: spacing.xs,
    fontSize: fontSizes.xs,
    color: colors.mutedText,
  },
});

export default DurationRangeSlider;

