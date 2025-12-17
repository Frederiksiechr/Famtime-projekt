/**
 * AKTIVITETS-POOL HOOK
 * 
 * Denne hook samler aktiviteter fra to kilder:
 * 1. LOKALE AKTIVITETER - Aktiviteter der er "hard-coded" i appen
 * 2. REMOTE AKTIVITETER - Aktiviteter hentet fra Firebase database i realtid
 * 
 * Komponenter kan bruge denne hook til at få alle disponible aktiviteter,
 * uanset hvor de kommer fra.
 * 
 * Eksempel på brug:
 *   const { remoteActivities, manualActivities, loading } = useActivityPool();
 *   const allActivities = [...remoteActivities, ...manualActivities];
 */
import { useEffect, useMemo, useState } from 'react';
import { WEEKDAY_ACTIVITIES, WEEKEND_ACTIVITIES } from '../data/activityCatalog';
import { db } from '../lib/firebase';
import { availabilityUtils } from '../lib/availability';

const ACTIVITY_COLLECTION = 'activities';

/**
 * TJEK OM NOGET ER EN GYLDIG AKTIVITET
 * 
 * Denne hjælper tjekker om en værdi har de vigtigste egenskaber
 * for at være en aktivitet:
 * - Den skal være et objekt (ikke null)
 * - Den skal have en title-egenskab
 * - Title skal være tekst og ikke være tom
 * 
 * Hvis alt stemmer, er det en gyldig aktivitet.
 * Bruges til at filtrere og validere data fra databasen.
 */
const isActivityShape = (value) =>
  value &&
  typeof value === 'object' &&
  typeof value.title === 'string' &&
  value.title.trim().length > 0;

/**
 * NORMALISERING AF FJERNAKTIVITETER
 * 
 * Når vi henter aktiviteter fra Firebase, kan de have forskellige formater
 * og forskellige egenskaber. Denne funktion "standardiserer" dem så de
 * ser ens ud som alle andre aktiviteter.
 * 
 * Den tager:
 * - id: Unik identifikator fra Firebase
 * - data: Aktivitets-dataene fra databasen
 * 
 * Og returnerer et standardiseret objekt med:
 * - title, description, city, price (eller standard-værdier hvis de mangler)
 * - startDate: Når aktiviteten skal være
 * - lengthMinutes: Hvor lang tid den tager
 * - source: "remote" for at markere den kommer fra databasen
 * - raw: Den originale data hvis vi skulle have brug for det
 */
const normalizeRemoteActivity = (id, data = {}) => {
  const startDate = availabilityUtils.toDate(
    data.datetime ?? data.start ?? data.startDate ?? null
  );
  const durationMinutes =
    typeof data.length === 'number' && Number.isFinite(data.length) ? data.length : null;

  return {
    id,
    title: data.title ?? 'Aktivitet',
    description: data.description ?? '',
    city: data.city ?? '',
    price: typeof data.price === 'number' ? data.price : null,
    startDate,
    lengthMinutes: durationMinutes,
    source: 'remote',
    raw: data,
  };
};

/**
 * FLAD LISTE AF AKTIVITETER FRA ET FIREBASE-DOKUMENT
 * 
 * Firebase dokumenter kan have kompliceret struktur med indlejrede data.
 * 
 * Denne funktion:
 * 1. Tager et Firebase-dokument
 * 2. Tjekker om dokumentet selv er en aktivitet
 * 3. Hvis ja, tilføjer den til listen
 * 4. Går derefter gennem alle egenskaber i dokumentet
 * 5. Hvis nogen egenskab er en aktivitet, tilføjer den også den
 * 
 * Resultat: En liste med alle aktiviteter - både toppen og indlejret.
 * 
 * Eksempel:
 *   Firebase-dokument:
 *   {
 *     title: "Besøg zoo",
 *     activity1: { title: "See fugle" },
 *     activity2: { title: "Se løver" }
 *   }
 *   
 *   Bliver til 3 aktiviteter: "Besøg zoo", "See fugle", "Se løver"
 */
const flattenRemoteDoc = (docSnapshot) => {
  const data = docSnapshot.data() ?? {};
  if (!data || typeof data !== 'object') {
    return [];
  }

  const entries = [];
  if (isActivityShape(data)) {
    entries.push(normalizeRemoteActivity(docSnapshot.id, data));
  }

  Object.entries(data).forEach(([key, value]) => {
    if (isActivityShape(value)) {
      entries.push(normalizeRemoteActivity(`${docSnapshot.id}_${key}`, value));
    }
  });

  return entries;
};

/**
 * NORMALISERING AF LOKALE KATALOG-AKTIVITETER
 * 
 * De lokale aktiviteter (dem der er skrevet direkte i appen) har et
 * anderledes format end de fra Firebase. Denne funktion "standardiserer"
 * dem så de ser ud som fjern-aktiviteterne.
 * 
 * Den tager:
 * - activity: En aktivitet fra WEEKDAY_ACTIVITIES eller WEEKEND_ACTIVITIES
 * - variant: Om det er "weekday" eller "weekend"
 * 
 * Og returnerer et standardiseret objekt som alle andre.
 */
const normalizeCatalogActivity = (activity, variant) => ({
  id: `${variant}_${activity.key}`,
  title: activity.label,
  description: activity.detail ?? '',
  tone: activity.tone ?? '',
  moods: Array.isArray(activity.moods) ? activity.moods : [],
  source: variant,
  isWeekendPreferred: variant === 'weekend',
});

/**
 * BYGNING AF LOKALT KATALOG
 * 
 * Denne funktion tager alle de lokale aktiviteter der er skrevet i koden
 * (WEEKDAY_ACTIVITIES og WEEKEND_ACTIVITIES) og gør dem til et standardiseret
 * format så de kan blandes med fjern-aktiviteterne.
 * 
 * Den:
 * 1. Normaliserer alle WEEKDAY_ACTIVITIES
 * 2. Normaliserer alle WEEKEND_ACTIVITIES
 * 3. Slår dem sammen til en enkelt liste
 * 
 * Resultat: En liste med alle lokale aktiviteter i standardformat.
 */
const buildManualCatalog = () => {
  const weekday = WEEKDAY_ACTIVITIES.map((activity) =>
    normalizeCatalogActivity(activity, 'weekday')
  );
  const weekend = WEEKEND_ACTIVITIES.map((activity) =>
    normalizeCatalogActivity(activity, 'weekend')
  );
  return [...weekday, ...weekend];
};

/**
 * AKTIVITETS-POOL HOOK - HOVEDFUNKTIONEN
 * 
 * Dette er en React Hook som komponenter kan kalde for at få aktiviteter.
 * 
 * State:
 * - remoteActivities: Aktiviteter fra Firebase (opdateres i realtid)
 * - remoteLoading: Om vi stadig henter data fra Firebase
 * 
 * Returner:
 * - remoteActivities: Liste med fjern-aktiviteter
 * - manualActivities: Liste med lokale aktiviteter
 * - loading: Om fjern-aktiviteterne stadig indlæses
 */
const useActivityPool = () => {
  const [remoteActivities, setRemoteActivities] = useState([]);
  const [remoteLoading, setRemoteLoading] = useState(true);

  /**
   * LIVE-FORBINDELSE TIL FIREBASE
   * 
   * Denne useEffect sætter op en "live-forbindelse" til Firebase.
   * Det betyder at hver gang der tilføjes, opdateres eller slettes
   * aktiviteter i databasen, opdateres remoteActivities automatisk.
   * 
   * onSnapshot betyder: "Hver gang der sker en ændring, kald denne funktion"
   * 
   * Hvis der sker en fejl (f.eks. internet er væk), logger vi det og
   * sætter remoteActivities til tom liste.
   * 
   * Cleanup-funktionen (unsubscribe) stopper lyttningen når komponenten
   * bliver fjernet fra skærmen.
   */
  useEffect(() => {
    // Live-lytning på remote aktivitetskollektionen (Firestore), fjerner/tilføjer i realtid.
    const unsubscribe = db
      .collection(ACTIVITY_COLLECTION)
      .onSnapshot(
        (snapshot) => {
          /**
           * SNAPSHOT-HANDLER - AKTIVITETER ER KOMMET
           * 
           * snapshot indeholder alle aktiviteterne fra Firebase.
           * Vi går gennem hver en og flader den (hvis den har indlejret data).
           * Derefter sætter vi remoteActivities til den nye liste.
           */
          const next = [];
          snapshot.forEach((docSnapshot) => {
            next.push(...flattenRemoteDoc(docSnapshot));
          });
          setRemoteActivities(next);
          setRemoteLoading(false);
        },
        (error) => {
          /**
           * FEJLBEHANDLING
           * 
           * Hvis der sker en fejl (f.eks. ingen internet eller forkert tilladelse),
           * logger vi advarslen så udvikler kan se hvad der gik galt.
           * Derefter sætter vi remoteActivities til tom liste så appen ikke
           * viser gamle data eller fejl.
           */
          console.warn('[useActivityPool] activities snapshot failed', error);
          setRemoteActivities([]);
          setRemoteLoading(false);
        }
      );

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  /**
   * BYGG LOKALT KATALOG
   * 
   * useMemo betyder at vi kun bygger katalog-listan når komponenten først
   * indsættes. Vi bygger det ikke igen og igen hver gang komponenten
   * tegnes (det ville være ineffektivt).
   */
  const manualActivities = useMemo(() => buildManualCatalog(), []);

  /**
   * RETURNÉR ALT
   * 
   * Vi returnerer:
   * - remoteActivities: Aktiviteter fra Firebase (opdateres i realtid)
   * - manualActivities: Lokale aktiviteter (fast liste)
   * - loading: Om vi stadig henter fra Firebase
   * 
   * Komponenter der bruger denne hook kan så kombinere begge lister
   * og vise alle aktiviteter til brugeren.
   */
  return {
    remoteActivities,
    manualActivities,
    loading: remoteLoading,
  };
};

export default useActivityPool;
