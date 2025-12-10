import { useEffect, useMemo, useState } from 'react';
import { WEEKDAY_ACTIVITIES, WEEKEND_ACTIVITIES } from '../data/activityCatalog';
import { db } from '../lib/firebase';
import { availabilityUtils } from '../lib/availability';

const ACTIVITY_COLLECTION = 'activities';

const isActivityShape = (value) =>
  value &&
  typeof value === 'object' &&
  typeof value.title === 'string' &&
  value.title.trim().length > 0;

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

const normalizeCatalogActivity = (activity, variant) => ({
  id: `${variant}_${activity.key}`,
  title: activity.label,
  description: activity.detail ?? '',
  tone: activity.tone ?? '',
  moods: Array.isArray(activity.moods) ? activity.moods : [],
  source: variant,
  isWeekendPreferred: variant === 'weekend',
});

const buildManualCatalog = () => {
  const weekday = WEEKDAY_ACTIVITIES.map((activity) =>
    normalizeCatalogActivity(activity, 'weekday')
  );
  const weekend = WEEKEND_ACTIVITIES.map((activity) =>
    normalizeCatalogActivity(activity, 'weekend')
  );
  return [...weekday, ...weekend];
};

const useActivityPool = () => {
  const [remoteActivities, setRemoteActivities] = useState([]);
  const [remoteLoading, setRemoteLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = db
      .collection(ACTIVITY_COLLECTION)
      .onSnapshot(
        (snapshot) => {
          const next = [];
          snapshot.forEach((docSnapshot) => {
            next.push(...flattenRemoteDoc(docSnapshot));
          });
          setRemoteActivities(next);
          setRemoteLoading(false);
        },
        (error) => {
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

  const manualActivities = useMemo(() => buildManualCatalog(), []);

  return {
    remoteActivities,
    manualActivities,
    loading: remoteLoading,
  };
};

export default useActivityPool;
