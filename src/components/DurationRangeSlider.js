import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, PanResponder, StyleSheet } from 'react-native';
import { colors, spacing, fontSizes, radius } from '../styles/theme';

/**
 * VARIGHED-RÆKKEVIDDE SLIDER
 * 
 * Denne komponent er en "slider" som lader brugerne vælge en tidsperiode ved at
 * trække med fingrene. For eksempel kan de vælge at en aktivitet skal tage mellem
 * 30 minutter og 2 timer.
 * 
 * Komponenten viser:
 * - To håndtag man kan trække på (startdato og slutdato)
 * - Tekst der viser hvad man har valgt (f.eks. "30 min" og "2 t. 30 min")
 * - En linje med en farvet stripe viser det valgte område
 * 
 * Komponenten sikrer at:
 * - Start-tid er altid før slut-tid
 * - Man kan ikke vælge mindre end 15 minutters forskel
 * - Værdierne altid stilles ind i 15-minutters trin
 * 
 * Forældre-komponenter sender:
 * - "minValue": Start-minutterne
 * - "maxValue": Slut-minutterne
 * - "onChange": En funktion som bliver kaldt når brugeren ændrer
 */
/**
 * KONSTANTER - REGLER FOR SLIDEREN
 * 
 * STEP_MINUTES: Slideren rykker i trin på 15 minutter. Man kan ikke vælge
 * f.eks. 13 minutter, kun 0, 15, 30, 45 osv.
 * 
 * MIN_RANGE_MINUTES: Den mindste forskel mellem min og max er 15 minutter.
 * Man kan ikke vælge f.eks. "fra 10 til 12 minutter".
 */
const STEP_MINUTES = 15;
const MIN_RANGE_MINUTES = 15;

/**
 * HJÆLPER - BEGRÆNSER EN VÆRDI
 * 
 * clamp fungerer som en "sikkerhedsbælte" - hvis en værdi er for høj
 * eller for lav, sætter den den til min eller max i stedet.
 * 
 * Eksempel: clamp(100, 0, 50) returnerer 50 fordi 100 er for høj.
 */
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
  /**
   * TRACK-BREDDE - HVOR BRED ER SLIDEREN
   * 
   * trackWidth gemmer hvor bred slideren er på skærmen (i pixels).
   * Dette bruges til at beregne hvor håndtagene skal placeres når
   * brugeren trækker.
   */
  const [trackWidth, setTrackWidth] = useState(0);

  /**
   * NORMALISERING AF VÆRDIER
   * 
   * Denne del sørger for at min og max værdierne altid er "rene" og gyldige.
   * 
   * Det betyder:
   * - Værdierne sættes altid til nærmeste 15-minutters trin
   * - Min er aldrig større end Max
   * - Der er altid mindst 15 minutters forskel
   * - Værdierne er indenfor min/max limiterne
   * 
   * useMemo betyder at denne beregning kun foretages når værdierne ændrer sig,
   * ikke hver gang komponenten tegnes (det er mere efficient).
   */
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

  /**
   * HUSKE STARTPOSITION NÅR MAN BEGYNDER AT TRÆKKE
   * 
   * dragOriginRef gemmer hvor brugeren begyndte at trække (x,y-position).
   * Dette bruges til at beregne hvor meget han/hun har trukket siden da.
   */
  const dragOriginRef = useRef({ min: currentMin, max: currentMax });

  /**
   * OMREGN TRÆK-AFSTAND TIL MINUTTER
   * 
   * Når brugeren trækker med fingeren (fx 50 pixels til høyre),
   * skal det omregnes til minutter (fx "20 minutter mere").
   * 
   * Denne funktion:
   * - Tager træk-afstanden (dx) fra gesturen
   * - Ser hvor bred slideren er (trackWidth)
   * - Beregner hvor mange minutter det svarer til
   * - Afrunder det til nærmeste 15-minutters trin
   */
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

  /**
   * SEND ÆNDRING TIL FORÆLDER
   * 
   * Når brugeren ændrer slideren, skal forældre-komponenten informeres.
   * 
   * Denne funktion:
   * - Tjekker at onChange-funktionen eksisterer
   * - Normaliserer værdierne (sikrer min < max osv.)
   * - Kalder onChange-funktionen med de nye værdier
   * 
   * På den måde ved forældre-komponenten hvad brugeren har valgt.
   */
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

  /**
   * HÅNDTERING AF MIN-HÅNDTAG (STARTPOSITION)
   * 
   * handleMinGrant bliver kaldt når brugeren begynder at trække i
   * venstre håndtag (start-minutterne).
   * 
   * Det eneste det gør er at gemme hvor håndtaget STARTEDE på.
   */
  const handleMinGrant = useCallback(() => {
    dragOriginRef.current.min = rangeRef.current.min;
  }, []);

  /**
   * HÅNDTERING AF MIN-HÅNDTAG (BEVÆGELSE)
   * 
   * handleMinMove bliver kaldt mens brugeren trækker i venstre håndtag.
   * 
   * Det gør følgende:
   * - Læser hvor langt brugeren har trukket (gestureState.dx)
   * - Omregner det til minutter ved hjælp af minutesFromDelta
   * - Beregner den nye min-værdi
   * - Sender det til forældre via emitChange
   */
  const handleMinMove = useCallback(
    (_, gestureState) => {
      const base = dragOriginRef.current.min;
      const delta = minutesFromDelta(gestureState.dx);
      const nextMin = clamp(base + delta, minLimit, rangeRef.current.max - minGap);
      emitChange(nextMin, rangeRef.current.max);
    },
    [emitChange, minGap, minLimit, minutesFromDelta]
  );

  /**
   * HÅNDTERING AF MAX-HÅNDTAG (STARTPOSITION)
   * 
   * handleMaxGrant bliver kaldt når brugeren begynder at trække i
   * højre håndtag (slut-minutterne).
   * 
   * Det gemmer hvor håndtaget STARTEDE på.
   */
  const handleMaxGrant = useCallback(() => {
    dragOriginRef.current.max = rangeRef.current.max;
  }, []);

  /**
   * HÅNDTERING AF MAX-HÅNDTAG (BEVÆGELSE)
   * 
   * handleMaxMove bliver kaldt mens brugeren trækker i højre håndtag.
   * 
   * Det gør det samme som handleMinMove men for max-værdi:
   * - Læser træk-afstanden
   * - Omregner til minutter
   * - Beregner ny max-værdi
   * - Sender til forældre
   */
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

  /**
   * PAN RESPONDER - HÅNDTERING AF DRAG/SWIPE
   * 
   * PanResponder er en React Native feature der registrerer når brugeren
   * begynder at trække og bevæger fingeren. Den kalder onGrant når det
   * starter og onMove hele tiden mens man trækker.
   * 
   * onStartShouldSetPanResponder og onMoveShouldSetPanResponder betyder at
   * systemet skal registrerer trækken.
   */
  const createPanResponder = (onGrant, onMove) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: onGrant,
      onPanResponderMove: onMove,
    });

  /**
   * RESPONDERE FOR MIN OG MAX HÅNDTAG
   * 
   * minResponder håndterer træk på venstre håndtag.
   * maxResponder håndterer træk på højre håndtag.
   * 
   * useMemo betyder at vi ikke laver nye respondere hver gang komponenten
   * tegnes - kun når handleMinGrant/handleMinMove osv. ændrer sig.
   */
  const minResponder = useMemo(
    () => createPanResponder(handleMinGrant, handleMinMove),
    [handleMinGrant, handleMinMove]
  );

  const maxResponder = useMemo(
    () => createPanResponder(handleMaxGrant, handleMaxMove),
    [handleMaxGrant, handleMaxMove]
  );

  /**
   * OMREGN MINUTTAL TIL PIXEL-POSITION
   * 
   * Denne funktion bestemmer hvor på slideren et håndtag skal være.
   * 
   * Hvis slider går fra 0-300 minutter og er 200 pixels bred:
   * - 0 minutter = 0 pixels (helt venstre)
   * - 150 minutter = 100 pixels (midt på)
   * - 300 minutter = 200 pixels (helt højre)
   */
  const toPosition = (value) => {
    if (!trackWidth) {
      return 0;
    }
    const ratio = (value - minLimit) / (maxLimit - minLimit);
    return ratio * trackWidth;
  };

  /**
   * BEREGN HÅNDTAGS-POSITIONER
   * 
   * minPosition: Hvor skal venstre håndtag være (i pixels)
   * maxPosition: Hvor skal højre håndtag være (i pixels)
   */
  const minPosition = toPosition(currentMin);
  const maxPosition = toPosition(currentMax);

  /**
   * FORMATERING AF TIDSVISNING
   * 
   * Denne funktion omregner minutter til pæn tekst.
   * 
   * Eksempler:
   * - 30 minutter -> "30 min"
   * - 60 minutter -> "1 t."
   * - 90 minutter -> "1 t. 30 min"
   * 
   * Det bruges til at vise teksten øverst på slideren.
   */
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

  /**
   * HVAD VI VISER TIL BRUGEREN
   * 
   * Vi viser:
   * 1. Øverst: Teksten "30 min" og "2 t. 30 min" (hvad der er valgt)
   * 2. I midten: Slideren med to håndtag man kan trække
   * 3. Nederst: En hjælpetekst der siger man skal trække i håndtagene
   * 
   * Slideren viser også en farvet stripe der repræsenterer det valgte område.
   */
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

