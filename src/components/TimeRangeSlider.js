import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, PanResponder, StyleSheet } from 'react-native';
import { colors, spacing, fontSizes, radius } from '../styles/theme';

/**
 * TID-RÆKKEVIDDE SLIDER
 * 
 * Denne komponent er en "slider" som lader brugerne vælge en tidsperiode på en dag.
 * For eksempel kan de vælge at de vil lave aktiviteter mellem klokken 17:00 og 19:00.
 * 
 * Komponenten viser:
 * - To håndtag man kan trække på (start-tid og slut-tid)
 * - Klokkeslæt der viser hvad man har valgt (f.eks. "17:00" og "19:00")
 * - En linje med en farvet stripe viser det valgte tidsvindue
 * 
 * Komponenten sikrer at:
 * - Start-tid er altid før slut-tid
 * - Man kan ikke vælge mindre end 45 minutters forskel
 * - Værdierne altid stilles ind i 15-minutters trin
 * 
 * Forældre-komponenter sender:
 * - "startTime": Når skal dagslisten starte (f.eks. "17:00")
 * - "endTime": Når skal dagslisten slutte (f.eks. "19:00")
 * - "onChange": En funktion som bliver kaldt når brugeren ændrer
 */
const MINUTES_IN_DAY = 24 * 60;
const STEP_MINUTES = 15;
const MIN_RANGE_MINUTES = 45;
const HANDLE_WIDTH = 28;

const clampMinutes = (value) =>
  Math.max(0, Math.min(MINUTES_IN_DAY - 1, value));

const parseTimeToMinutes = (value, fallbackMinutes) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (match) {
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      if (
        Number.isFinite(hours) &&
        Number.isFinite(minutes) &&
        hours >= 0 &&
        hours < 24 &&
        minutes >= 0 &&
        minutes < 60
      ) {
        return hours * 60 + minutes;
      }
    }
  }
  return fallbackMinutes;
};

const minutesToLabel = (minutes) => {
  const clamped = clampMinutes(minutes);
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const usePanResponder = (enabled, onMoveStart, onMove) =>
  useMemo(() => {
    if (!enabled) {
      return null;
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: onMoveStart,
      onPanResponderMove: onMove,
    });
  }, [enabled, onMoveStart, onMove]);

const TimeRangeSlider = ({
  startTime,
  endTime,
  onChange,
  minRangeMinutes = MIN_RANGE_MINUTES,
}) => {
  const [trackWidth, setTrackWidth] = useState(0);

  const fallbackStart = 17 * 60;
  const fallbackEnd = 19 * 60;

  const startMinutes = useMemo(
    () => parseTimeToMinutes(startTime, fallbackStart),
    [startTime]
  );
  const endMinutes = useMemo(() => {
    const parsed = parseTimeToMinutes(endTime, fallbackEnd);
    return Math.max(startMinutes + MIN_RANGE_MINUTES, parsed);
  }, [endTime, startMinutes]);

  const rangeRef = useRef({ start: startMinutes, end: endMinutes });
  useEffect(() => {
    rangeRef.current = { start: startMinutes, end: endMinutes };
  }, [startMinutes, endMinutes]);

  const dragOriginRef = useRef({ start: startMinutes, end: endMinutes });

  const minutesFromDelta = useCallback(
    (dx) => {
      if (!trackWidth) {
        return 0;
      }
      const rawMinutes = (dx / trackWidth) * MINUTES_IN_DAY;
      return Math.round(rawMinutes / STEP_MINUTES) * STEP_MINUTES;
    },
    [trackWidth]
  );

  const emitChange = useCallback(
    (nextStart, nextEnd) => {
      const normalizedStart = clampMinutes(nextStart);
      const normalizedEnd = clampMinutes(
        Math.max(nextEnd, normalizedStart + minRangeMinutes)
      );
      if (typeof onChange === 'function') {
        onChange(
          minutesToLabel(normalizedStart),
          minutesToLabel(normalizedEnd)
        );
      }
    },
    [minRangeMinutes, onChange]
  );

  const handleStartGrant = useCallback(() => {
    dragOriginRef.current.start = rangeRef.current.start;
  }, []);

  const handleStartMove = useCallback(
    (_, gestureState) => {
      const base = dragOriginRef.current.start;
      const deltaMinutes = minutesFromDelta(gestureState.dx);
      const nextStart = Math.min(
        clampMinutes(base + deltaMinutes),
        rangeRef.current.end - minRangeMinutes
      );
      emitChange(nextStart, rangeRef.current.end);
    },
    [emitChange, minRangeMinutes, minutesFromDelta]
  );

  const handleEndGrant = useCallback(() => {
    dragOriginRef.current.end = rangeRef.current.end;
  }, []);

  const handleEndMove = useCallback(
    (_, gestureState) => {
      const base = dragOriginRef.current.end;
      const deltaMinutes = minutesFromDelta(gestureState.dx);
      const nextEnd = Math.max(
        clampMinutes(base + deltaMinutes),
        rangeRef.current.start + minRangeMinutes
      );
      emitChange(rangeRef.current.start, nextEnd);
    },
    [emitChange, minRangeMinutes, minutesFromDelta]
  );

  const startPanResponder = usePanResponder(
    Boolean(onChange),
    handleStartGrant,
    handleStartMove
  );
  const endPanResponder = usePanResponder(
    Boolean(onChange),
    handleEndGrant,
    handleEndMove
  );

  const startPosition =
    trackWidth > 0 ? (startMinutes / MINUTES_IN_DAY) * trackWidth : 0;
  const endPosition =
    trackWidth > 0 ? (endMinutes / MINUTES_IN_DAY) * trackWidth : trackWidth;

  return (
    <View style={styles.wrapper}>
      <View style={styles.sliderLabelRow}>
        <Text style={styles.sliderLabel}>{minutesToLabel(startMinutes)}</Text>
        <Text style={styles.sliderLabel}>{minutesToLabel(endMinutes)}</Text>
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
              left: startPosition,
              width: Math.max(0, endPosition - startPosition),
            },
          ]}
        />
        <View
          style={[
            styles.sliderHandle,
            { left: startPosition - HANDLE_WIDTH / 2 },
          ]}
          {...(startPanResponder?.panHandlers ?? {})}
        >
          <View style={styles.sliderHandleDot} />
        </View>
        <View
          style={[
            styles.sliderHandle,
            { left: endPosition - HANDLE_WIDTH / 2 },
          ]}
          {...(endPanResponder?.panHandlers ?? {})}
        >
          <View style={styles.sliderHandleDot} />
        </View>
      </View>
      <Text style={styles.sliderHelper}>
        Træk enderne for at justere tidsrummet.
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
    width: HANDLE_WIDTH,
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

export default TimeRangeSlider;
