export const FAMILY_PREFERENCE_MODES = {
  CUSTOM: 'custom',
  FOLLOW: 'follow',
  NONE: 'none',
};

export const FAMILY_PREFERENCE_MODE_OPTIONS = [
  { key: FAMILY_PREFERENCE_MODES.CUSTOM, label: 'Tilpas selv' },
  { key: FAMILY_PREFERENCE_MODES.FOLLOW, label: 'Følg familiemedlem' },
  { key: FAMILY_PREFERENCE_MODES.NONE, label: 'Ingen præferencer' },
];

export const normalizeFamilyPreferenceMode = (value) => {
  if (value === FAMILY_PREFERENCE_MODES.FOLLOW) {
    return FAMILY_PREFERENCE_MODES.FOLLOW;
  }
  if (value === FAMILY_PREFERENCE_MODES.NONE) {
    return FAMILY_PREFERENCE_MODES.NONE;
  }
  return FAMILY_PREFERENCE_MODES.CUSTOM;
};
