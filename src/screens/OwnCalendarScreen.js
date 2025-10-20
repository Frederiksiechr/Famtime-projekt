/**
 * OwnCalendarScreen
 *
 * - Viser familiens begivenheder opdelt på godkendelsesstatus.
 * - Lader brugeren godkende eller afvise forslag samt foreslå nye ændringer.
 * - Alt data hentes fra Firestore - ingen direkte manipulation af Apple-kalenderen her.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Modal,
  TextInput,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  SafeAreaView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import Button from '../components/Button';
import ErrorMessage from '../components/ErrorMessage';
import { auth, db, firebase } from '../lib/firebase';
import { colors, spacing, fontSizes, radius } from '../styles/theme';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_AVATAR_EMOJI } from '../constants/avatarEmojis';

const isIOS = Platform.OS === 'ios';

const formatDateTime = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Ukendt tidspunkt';
  }

  return `${date.toLocaleDateString()} kl. ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

const formatDateRange = (start, end) => {
  if (!start) {
    return 'Ukendt tidspunkt';
  }

  if (!end) {
    return formatDateTime(start);
  }

  return `${formatDateTime(start)} - ${formatDateTime(end)}`;
};

const toDate = (value) => {
  if (!value) {
    return null;
  }

  if (value.toDate) {
    try {
      return value.toDate();
    } catch (_error) {
      return null;
    }
  }

  if (value instanceof Date) {
    return value;
  }

  return null;
};

const OwnCalendarScreen = () => {
  const currentUser = auth.currentUser;
  const currentUserId = currentUser?.uid ?? null;
  const currentUserEmail = currentUser?.email?.toLowerCase() ?? '';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  const [familyId, setFamilyId] = useState(null);
  const [familyName, setFamilyName] = useState('');
  const [familyMembers, setFamilyMembers] = useState([]);
  const [currentUserEmoji, setCurrentUserEmoji] = useState(DEFAULT_AVATAR_EMOJI);
  const memberById = useMemo(() => {
    const map = new Map();
    familyMembers.forEach((member) => {
      if (member?.userId) {
        map.set(member.userId, member);
      }
    });
    return map;
  }, [familyMembers]);
  const [userRole, setUserRole] = useState('');
  const [events, setEvents] = useState([]);

  const [proposalVisible, setProposalVisible] = useState(false);
  const [proposalEvent, setProposalEvent] = useState(null);
  const [proposalData, setProposalData] = useState({
    title: '',
    description: '',
    start: new Date(),
    end: new Date(new Date().getTime() + 60 * 60 * 1000),
  });
  const [proposalError, setProposalError] = useState('');
  const [proposalSaving, setProposalSaving] = useState(false);

  const [showProposalStartPicker, setShowProposalStartPicker] = useState(isIOS);
  const [showProposalEndPicker, setShowProposalEndPicker] = useState(isIOS);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState(null);
  const [cancelProposal, setCancelProposal] = useState(false);
  const [expandedEventIds, setExpandedEventIds] = useState(() => new Set());

  const toggleEventDetails = useCallback((eventId) => {
    setExpandedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  const resetProposalState = useCallback(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    const defaultEnd = new Date(now.getTime() + 60 * 60 * 1000);
    setProposalData({
      title: '',
      description: '',
      start: now,
      end: defaultEnd,
    });
    setProposalError('');
    setProposalSaving(false);
    setShowProposalStartPicker(isIOS);
    setShowProposalEndPicker(isIOS);
    setSuggestions([]);
    setSelectedSuggestionId(null);
    setCancelProposal(false);
  }, []);

  const openProposalModal = useCallback(
    (event) => {
      setProposalEvent(event);

      const base = event?.pendingChange ?? {
        title: event?.title ?? '',
        description: event?.description ?? '',
        start: event?.start ? new Date(event.start) : new Date(),
        end:
          event?.end && event?.start
            ? new Date(event.end)
            : new Date(new Date().getTime() + 60 * 60 * 1000),
      };

      setProposalData({
        title: base.title ?? '',
        description: base.description ?? '',
        start: base.start instanceof Date ? base.start : new Date(),
        end:
          base.end instanceof Date
            ? base.end
            : new Date(new Date().getTime() + 60 * 60 * 1000),
      });
      setProposalError('');
      setProposalSaving(false);
      setShowProposalStartPicker(isIOS);
      setShowProposalEndPicker(isIOS);
      setCancelProposal(Boolean(event?.pendingChange?.cancel));
      setSelectedSuggestionId(null);
      setSuggestions([]);
      setProposalVisible(true);
    },
    [setProposalVisible]
  );


  const openCancellationModal = useCallback(
    (event) => {
      openProposalModal(event);
      setCancelProposal(true);
    },
    [openProposalModal]
  );

  const closeProposalModal = useCallback(() => {
    setProposalVisible(false);
    setProposalEvent(null);
    resetProposalState();
  }, [resetProposalState]);

  const eventsPendingUser = useMemo(
    () =>
      events.filter(
        (event) =>
          Array.isArray(event.pendingApprovals) &&
          event.pendingApprovals.includes(currentUserId)
      ),
    [events, currentUserId]
  );

  const eventsPendingOthers = useMemo(
    () =>
      events.filter(
        (event) =>
          event.status === 'pending' &&
          (!Array.isArray(event.pendingApprovals) ||
            !event.pendingApprovals.includes(currentUserId))
      ),
    [events, currentUserId]
  );

  const eventsConfirmed = useMemo(
    () =>
      events
        .filter((event) => event.status === 'confirmed')
        .sort((a, b) => {
          const timeA = a.start ? a.start.getTime() : 0;
          const timeB = b.start ? b.start.getTime() : 0;
          return timeA - timeB;
        }),
    [events]
  );

  useEffect(() => {
    setExpandedEventIds((prev) => {
      if (!prev.size) {
        return prev;
      }
      const validIds = new Set(events.map((event) => event.id));
      const next = new Set();
      prev.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        }
      });
      if (next.size === prev.size) {
        return prev;
      }
      return next;
    });
  }, [events]);

  const loadProfileAndFamily = useCallback(() => {
    if (!currentUserId) {
      setLoading(false);
      setInfoMessage('Ingen aktiv bruger. Log venligst ind igen.');
      return () => {};
    }

    let unsubscribeUser = null;
    let unsubscribeFamilyDoc = null;

    unsubscribeUser = db
      .collection('users')
      .doc(currentUserId)
      .onSnapshot(
        (snapshot) => {
          const data = snapshot.data() ?? {};
          const nextEmoji =
            typeof data.avatarEmoji === 'string' && data.avatarEmoji.trim().length
              ? data.avatarEmoji.trim()
              : DEFAULT_AVATAR_EMOJI;
          setCurrentUserEmoji(nextEmoji);
          const nextFamilyId = data.familyId ?? null;
          setFamilyId(nextFamilyId);
          setUserRole(data.familyRole ?? '');

          if (!nextFamilyId) {
            setFamilyName('');
            setFamilyMembers([]);
            setEvents([]);
            setInfoMessage(
              'Du er endnu ikke tilknyttet en familie. Tilslut eller opret en familie for at se begivenheder.'
            );
            setLoading(false);
            if (unsubscribeFamilyDoc) {
              unsubscribeFamilyDoc();
              unsubscribeFamilyDoc = null;
            }
            return;
          }

          setInfoMessage('');

          if (unsubscribeFamilyDoc) {
            unsubscribeFamilyDoc();
          }

          unsubscribeFamilyDoc = db
            .collection('families')
            .doc(nextFamilyId)
            .onSnapshot(
              (familySnapshot) => {
                if (!familySnapshot.exists) {
                  setFamilyName('');
                  setFamilyMembers([]);
                  setEvents([]);
                  setInfoMessage(
                    'Familien blev ikke fundet. Måske er den blevet slettet.'
                  );
                  return;
                }

                const familyData = familySnapshot.data() ?? {};
                setFamilyName(familyData.name ?? 'FamTime familie');
                setFamilyMembers(
                  Array.isArray(familyData.members) ? familyData.members : []
                );
                setInfoMessage('');
              },
              () => {
                setFamilyName('');
                setFamilyMembers([]);
                setInfoMessage(
                  'Kunne ikke hente familieoplysninger. Prøv igen senere.'
                );
              }
            );
        },
        () => {
          setInfoMessage(
            'Kunne ikke hente brugeroplysninger. Prøv at logge ind igen.'
          );
          setLoading(false);
        }
      );

    return () => {
      if (unsubscribeUser) {
        unsubscribeUser();
      }
      if (unsubscribeFamilyDoc) {
        unsubscribeFamilyDoc();
      }
    };
  }, [currentUserId]);

  useEffect(() => {
    const unsubscribe = loadProfileAndFamily();
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [loadProfileAndFamily]);

  useEffect(() => {
    if (!familyId) {
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsubscribe = db
      .collection('families')
      .doc(familyId)
      .collection('events')
      .orderBy('start', 'asc')
      .onSnapshot(
        (snapshot) => {
          const nextEvents = [];
          snapshot.forEach((doc) => {
            const data = doc.data() ?? {};
            const pendingChangeData = data.pendingChange ?? null;

            const pendingChange = pendingChangeData
              ? {
                  title: pendingChangeData.title ?? '',
                  description: pendingChangeData.description ?? '',
                  start: toDate(pendingChangeData.start),
                  end: toDate(pendingChangeData.end),
                }
              : null;

            nextEvents.push({
              id: doc.id,
              title: data.title ?? 'Ingen titel',
              description: data.description ?? '',
              start: toDate(data.start),
              end: toDate(data.end),
              status: data.status ?? 'pending',
              createdBy: data.createdBy ?? '',
              createdByUid: data.createdByUid ?? '',
              pendingApprovals: Array.isArray(data.pendingApprovals)
                ? data.pendingApprovals
                : [],
              approvedBy: Array.isArray(data.approvedBy)
                ? data.approvedBy
                : [],
              pendingChange,
              lastModifiedBy: data.lastModifiedBy ?? null,
              lastModifiedEmail: data.lastModifiedEmail ?? '',
            });
          });

          setEvents(nextEvents);
          setLoading(false);
        },
        () => {
          setError('Kunne ikke hente familieevents. Prøv igen senere.');
          setEvents([]);
          setLoading(false);
        }
      );

    return () => unsubscribe();
  }, [familyId]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  const computeMemberIds = useCallback(async () => {
    const idsFromState = familyMembers
      .map((member) => member?.userId)
      .filter((id) => typeof id === 'string' && id.trim().length > 0);

    if (idsFromState.length > 1 || !familyId) {
      return Array.from(new Set(idsFromState));
    }

    try {
      const familyDoc = await db.collection('families').doc(familyId).get();
      if (!familyDoc.exists) {
        return idsFromState;
      }
      const docMembers = familyDoc.data()?.members ?? [];
      const ids = docMembers
        .map((member) => member?.userId)
        .filter((id) => typeof id === 'string' && id.trim().length > 0);
      return Array.from(new Set([...idsFromState, ...ids]));
    } catch (_error) {
      return idsFromState;
    }
  }, [familyId, familyMembers]);

  const handleApproveEvent = useCallback(
    async (event) => {
      if (!familyId || !event?.id || !currentUserId) {
        return;
      }

      const pendingList = Array.isArray(event.pendingApprovals)
        ? event.pendingApprovals
        : [];

      if (!pendingList.includes(currentUserId)) {
        return;
      }

      const remaining = pendingList.filter((id) => id !== currentUserId);
      const approvedBy = Array.isArray(event.approvedBy)
        ? Array.from(new Set([...event.approvedBy, currentUserId]))
        : [currentUserId];

      if (remaining.length === 0) {
        if (event.pendingChange?.cancel) {
          try {
            await db
              .collection('families')
              .doc(familyId)
              .collection('events')
              .doc(event.id)
              .delete();
            setStatusMessage('Begivenheden er aflyst for hele familien.');
          } catch (_deleteError) {
            setError('Kunne ikke aflyse begivenheden. Prøv igen.');
          }
          return;
        }
      }

      const updatePayload = {
        pendingApprovals: remaining,
        approvedBy,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      if (remaining.length === 0) {
        updatePayload.status = 'confirmed';
        updatePayload.approvedAt = firebase.firestore.FieldValue.serverTimestamp();

        if (event.pendingChange) {
          if (event.pendingChange.start) {
            updatePayload.start = firebase.firestore.Timestamp.fromDate(
              event.pendingChange.start
            );
          }
          if (event.pendingChange.end) {
            updatePayload.end = firebase.firestore.Timestamp.fromDate(
              event.pendingChange.end
            );
          }
          if (typeof event.pendingChange.title === 'string') {
            updatePayload.title = event.pendingChange.title;
          }
          if (typeof event.pendingChange.description === 'string') {
            updatePayload.description = event.pendingChange.description;
          }

          updatePayload.pendingChange =
            firebase.firestore.FieldValue.delete();
        }
      }

      try {
        await db
          .collection('families')
          .doc(familyId)
          .collection('events')
          .doc(event.id)
          .set(updatePayload, { merge: true });

        setStatusMessage(
          remaining.length === 0
            ? 'Begivenheden er godkendt af familien.'
            : 'Din godkendelse er registreret.'
        );
      } catch (_error) {
        setError('Kunne ikke godkende begivenheden. Prøv igen.');
      }
    },
    [currentUserId, familyId]
  );

  const handleRejectChange = useCallback(
    async (event) => {
      if (!familyId || !event?.id) {
        return;
      }

      try {
        await db
          .collection('families')
          .doc(familyId)
          .collection('events')
          .doc(event.id)
          .set(
            {
              pendingApprovals: [],
              approvedBy: [],
              pendingChange: firebase.firestore.FieldValue.delete(),
              status: 'confirmed',
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        setStatusMessage('Forslaget er afvist.');
      } catch (_error) {
        setError('Kunne ikke afvise forslaget. Prøv igen.');
      }
    },
    [familyId]
  );

  const handleProposalStartChange = useCallback(
    (_event, selectedDate) => {
      if (selectedDate) {
        const cleaned = new Date(selectedDate);
        cleaned.setSeconds(0, 0);
        setProposalData((prev) => {
          const nextEnd =
            prev.end <= cleaned
              ? new Date(cleaned.getTime() + 60 * 60 * 1000)
              : prev.end;
          return {
            ...prev,
            start: cleaned,
            end: nextEnd,
          };
        });
      }

      if (!isIOS) {
        setShowProposalStartPicker(false);
      }
    },
    []
  );

  const handleProposalEndChange = useCallback(
    (_event, selectedDate) => {
      if (selectedDate) {
        const cleaned = new Date(selectedDate);
        cleaned.setSeconds(0, 0);
        setProposalData((prev) => ({
          ...prev,
          end:
            cleaned > prev.start
              ? cleaned
              : new Date(prev.start.getTime() + 30 * 60 * 1000),
        }));
      }

      if (!isIOS) {
        setShowProposalEndPicker(false);
      }
    },
    []
  );

  const handleSelectSuggestion = useCallback((suggestion) => {
    if (!suggestion) {
      return;
    }

    const nextStart =
      suggestion.start instanceof Date
        ? suggestion.start
        : new Date(suggestion.start ?? Date.now());
    const nextEnd =
      suggestion.end instanceof Date
        ? suggestion.end
        : new Date(nextStart.getTime() + 60 * 60 * 1000);

    setSelectedSuggestionId(suggestion.id ?? nextStart.toISOString());
    setProposalData((prev) => ({
      ...prev,
      start: nextStart,
      end: nextEnd > nextStart ? nextEnd : new Date(nextStart.getTime() + 60 * 60 * 1000),
    }));
    setShowProposalStartPicker(isIOS);
    setShowProposalEndPicker(isIOS);
  }, []);

  const handleSubmitProposal = useCallback(async () => {
    if (!proposalEvent || !familyId || !currentUserId) {
      return;
    }

    const trimmedTitle = proposalData.title.trim();

    if (!cancelProposal && !trimmedTitle.length) {
      setProposalError('Tilføj en titel til begivenheden.');
      return;
    }

    if (!cancelProposal) {
      if (!(proposalData.start instanceof Date) || !(proposalData.end instanceof Date)) {
        setProposalError('Start og slut skal være gyldige tidspunkter.');
        return;
      }

      if (proposalData.end <= proposalData.start) {
        setProposalError('Sluttidspunkt skal være efter starttidspunkt.');
        return;
      }
    }

    setProposalSaving(true);
    setProposalError('');
    setStatusMessage('');

    const memberIds = await computeMemberIds();
    const pendingApprovals = memberIds.filter((id) => id !== currentUserId);

    const changePayload = cancelProposal
      ? {
          cancel: true,
          description: proposalData.description.trim(),
        }
      : {
          title: trimmedTitle,
          description: proposalData.description.trim(),
          start: firebase.firestore.Timestamp.fromDate(proposalData.start),
          end: firebase.firestore.Timestamp.fromDate(proposalData.end),
        };

    try {
      await db
        .collection('families')
        .doc(familyId)
        .collection('events')
        .doc(proposalEvent.id)
        .set(
          {
            pendingChange: changePayload,
            pendingApprovals,
            approvedBy: [currentUserId],
            status: 'pending',
            lastModifiedBy: currentUserId,
            lastModifiedEmail: currentUserEmail,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      setStatusMessage(
        cancelProposal
          ? 'Forslaget om at aflyse begivenheden er sendt til familien.'
          : 'Forslaget er sendt til familien.'
      );
      closeProposalModal();
    } catch (_error) {
      setProposalError('Kunne ikke sende forslaget. Prøv igen.');
    } finally {
      setProposalSaving(false);
    }
  }, [
    closeProposalModal,
    computeMemberIds,
    currentUserEmail,
    currentUserId,
    familyId,
    proposalData.description,
    proposalData.end,
    proposalData.start,
    proposalData.title,
    proposalEvent,
    cancelProposal,
  ]);

  const renderEventSection = (title, items, hint) => {
    if (!items.length) {
      return null;
    }

    return (
      <View style={styles.sectionGroup}>
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
          </View>
        </View>
        <View style={styles.eventList}>
            {items.map((event) => {
              const pendingList = Array.isArray(event.pendingApprovals)
                ? event.pendingApprovals.filter(
                    (id) => typeof id === 'string' && id.length > 0
                  )
                : [];
              const approvedList = Array.isArray(event.approvedBy)
                ? event.approvedBy.filter(
                    (id) => typeof id === 'string' && id.length > 0
                  )
                : [];

              const seenParticipantIds = new Set();

              const makeBadge = (memberId, status) => {
                const safeId =
                  typeof memberId === 'string' && memberId.length
                    ? memberId
                    : `unknown-${status}`;
                const member = memberById.get(memberId);
                const rawEmoji =
                  memberId === currentUserId && typeof currentUserEmoji === 'string' && currentUserEmoji.trim().length
                    ? currentUserEmoji
                    : member?.avatarEmoji;
                const emoji =
                  typeof rawEmoji === 'string' && rawEmoji.trim().length
                    ? rawEmoji.trim()
                    : DEFAULT_AVATAR_EMOJI;
                const label =
                  member?.name ||
                  member?.displayName ||
                  member?.email ||
                  (memberId === currentUserId ? 'Dig' : 'Familiemedlem');

                return {
                  key: `${safeId}-${status}`,
                  memberId: safeId,
                  emoji,
                  label,
                  status,
                };
              };

              const approvalBadges = [];

              pendingList.forEach((id) => {
                if (seenParticipantIds.has(id)) {
                  return;
                }
                seenParticipantIds.add(id);
                approvalBadges.push(makeBadge(id, 'pending'));
              });

              approvedList.forEach((id) => {
                if (seenParticipantIds.has(id)) {
                  return;
                }
                seenParticipantIds.add(id);
                approvalBadges.push(makeBadge(id, 'approved'));
              });

              if (!approvalBadges.length && familyMembers.length) {
                familyMembers.forEach((member) => {
                  const memberId =
                    typeof member?.userId === 'string' && member.userId.length
                      ? member.userId
                      : null;
                  if (!memberId || seenParticipantIds.has(memberId)) {
                    return;
                  }
                  seenParticipantIds.add(memberId);
                  const memberEmoji =
                    memberId === currentUserId && typeof currentUserEmoji === 'string' && currentUserEmoji.trim().length
                      ? currentUserEmoji
                      : member?.avatarEmoji;
                  approvalBadges.push({
                    key: `${memberId}-unknown`,
                    memberId,
                    emoji:
                      typeof memberEmoji === 'string' && memberEmoji.trim().length
                        ? memberEmoji.trim()
                        : DEFAULT_AVATAR_EMOJI,
                    label:
                      member?.name ||
                      member?.displayName ||
                      member?.email ||
                      'Familiemedlem',
                    status: 'unknown',
                  });
                });
              }

              if (currentUserId && !seenParticipantIds.has(currentUserId)) {
                seenParticipantIds.add(currentUserId);
                approvalBadges.push(
                  makeBadge(
                    currentUserId,
                    pendingList.includes(currentUserId) ? 'pending' : 'approved'
                  )
                );
              }

              const pendingCount = approvalBadges.filter(
                (badge) => badge.status === 'pending'
              ).length;

              const statusText =
                pendingCount > 0
                  ? pendingCount === 1
                    ? 'Afventer 1 familiemedlem'
                    : `Afventer ${pendingCount} familiemedlemmer`
                  : 'Alle medlemmer har godkendt.';
              const hasExpandableDetails =
                Boolean(event.description) || Boolean(event.pendingChange);
              const isExpanded = expandedEventIds.has(event.id);

              return (
              <View key={event.id} style={styles.eventCard}>
                <View style={styles.eventHeader}>
                  <View style={styles.eventHeaderText}>
                    <Text style={styles.eventTitle}>{event.title}</Text>
                    <Text style={styles.eventTime}>
                      {formatDateRange(event.start, event.end)}
                    </Text>
                  </View>
                  {hasExpandableDetails ? (
                    <Pressable
                      onPress={() => toggleEventDetails(event.id)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: isExpanded }}
                      accessibilityLabel={
                        isExpanded
                          ? 'Skjul detaljer for begivenhed'
                          : 'Vis detaljer for begivenhed'
                      }
                      style={styles.eventToggle}
                      hitSlop={12}
                    >
                      <Ionicons
                        name={isExpanded ? 'eye-off-outline' : 'eye-outline'}
                        style={[
                          styles.eventToggleIcon,
                          isExpanded ? styles.eventToggleIconActive : null,
                        ]}
                      />
                    </Pressable>
                  ) : null}
                </View>

                  <View style={styles.approvalRow}>
                    <Text style={styles.eventMeta}>{statusText}</Text>
                    <View style={styles.approvalBadges}>
                      {approvalBadges.map((badge) => {
                        const badgeStyle = [
                          styles.approvalBadge,
                          badge.status === 'approved'
                            ? styles.approvalBadgeApproved
                            : styles.approvalBadgePending,
                        ];
                        if (badge.status === 'unknown') {
                          badgeStyle.push(styles.approvalBadgeUnknown);
                        }

                        return (
                          <View
                            key={badge.key}
                            style={badgeStyle}
                            accessibilityLabel={`${badge.label}: ${
                              badge.status === 'approved'
                                ? 'har godkendt'
                                : badge.status === 'pending'
                                ? 'afventer svar'
                                : 'status ukendt'
                            }`}
                          >
                            <Text style={styles.approvalEmojiText}>{badge.emoji}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>

                {isExpanded ? (
                  <View style={styles.eventDetails}>
                    {event.description ? (
                      <Text style={styles.eventDescription}>{event.description}</Text>
                    ) : null}
                    {event.pendingChange ? (
                      <View style={styles.pendingChangeBox}>
                        <Text style={styles.pendingChangeTitle}>Foreslået ændring</Text>
                        {event.pendingChange.cancel ? (
                          <Text style={styles.pendingChangeText}>
                            Forslag: Aflys begivenheden
                            {event.pendingChange.description
                              ? ` - ${event.pendingChange.description}`
                              : ''}
                          </Text>
                        ) : (
                          <>
                            {event.pendingChange.title &&
                            event.pendingChange.title !== event.title ? (
                              <Text style={styles.pendingChangeText}>
                                Ny titel: {event.pendingChange.title}
                              </Text>
                            ) : null}
                            {event.pendingChange.description &&
                            event.pendingChange.description !== event.description ? (
                              <Text style={styles.pendingChangeText}>
                                Ny beskrivelse: {event.pendingChange.description}
                              </Text>
                            ) : null}
                            {event.pendingChange.start ? (
                              <Text style={styles.pendingChangeText}>
                                Nyt tidspunkt:{' '}
                                {formatDateRange(
                                  event.pendingChange.start,
                                  event.pendingChange.end
                                )}
                              </Text>
                            ) : null}
                          </>
                        )}
                      </View>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.eventActions}>
                  {event.status === 'pending' && pendingList.includes(currentUserId) ? (
                    <>
                      <Button
                        title="Godkend"
                        onPress={() => handleApproveEvent(event)}
                        style={[styles.eventActionButton, styles.eventApproveButton]}
                      />
                      {event.pendingChange ? (
                        <Button
                          title="Afvis forslag"
                          onPress={() => handleRejectChange(event)}
                          style={[styles.eventActionButton, styles.eventRejectButton]}
                        />
                      ) : null}
                    </>
                  ) : null}
                  {event.status === 'pending' &&
                  !pendingList.includes(currentUserId) &&
                  (event.createdByUid ? event.createdByUid === currentUserId : true) ? (
                    <Button
                      title="Aflys begivenhed"
                      onPress={() => openCancellationModal(event)}
                      style={[styles.eventActionButton, styles.eventRejectButton]}
                    />
                  ) : null}
                  <Button
                    title="Foreslå ændring"
                    onPress={() => openProposalModal(event)}
                    style={[styles.eventActionButton, styles.eventActionButtonPrimary]}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const shouldShowStatusCard = Boolean(error || statusMessage || infoMessage || loading);

  return (
    <>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        >
          <View style={styles.container}>
            <View style={styles.heroCard}>
              <Text style={styles.title}>Familiens kalender</Text>
              <Text style={styles.subtitle}>
                Godkend forslag, hold styr på afventende begivenheder, og foreslå ændringer
                for din familie.
              </Text>
            </View>

            {shouldShowStatusCard ? (
              <View style={styles.messagesCard}>
                <ErrorMessage message={error} />
                {statusMessage ? (
                  <View style={styles.statusPill}>
                    <Text style={styles.statusText}>{statusMessage}</Text>
                  </View>
                ) : null}
                {infoMessage ? (
                  <View style={styles.infoPill}>
                    <Text style={styles.infoText}>{infoMessage}</Text>
                  </View>
                ) : null}
                {loading ? (
                  <Text style={styles.infoText}>Indlæser begivenheder...</Text>
                ) : null}
              </View>
            ) : null}

            {renderEventSection(
              'Kræver din godkendelse',
              eventsPendingUser,
              'Disse begivenheder venter på din accept eller afvisning.'
            )}

            {renderEventSection(
              'Afventer andre familiemedlemmer',
              eventsPendingOthers,
              'Forslag sendt af dig eller andre familiemedlemmer, som stadig er i proces.'
            )}

            {renderEventSection('Bekræftede begivenheder', eventsConfirmed)}
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={proposalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeProposalModal}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={closeProposalModal}
          accessibilityRole="button"
          accessibilityLabel="Luk forslag"
        >
          <KeyboardAvoidingView
            behavior={isIOS ? 'padding' : undefined}
            style={styles.modalAvoiding}
          >
            <View style={styles.modalWrapper}>
              <ScrollView
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Pressable
                  onPress={(event) => event.stopPropagation()}
                  style={styles.modalCard}
                >
                  <Text style={styles.modalTitle}>Foreslå ændring</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Titel"
                    value={proposalData.title}
                    onChangeText={(text) =>
                      setProposalData((prev) => ({ ...prev, title: text }))
                    }
                  />
                  <TextInput
                    style={[styles.modalInput, styles.modalNotesInput]}
                    placeholder="Beskrivelse (valgfrit)"
                    value={proposalData.description}
                    onChangeText={(text) =>
                      setProposalData((prev) => ({ ...prev, description: text }))
                    }
                    multiline
                  />

                  <Button
                    title={cancelProposal ? 'Fortryd aflysning' : 'Aflys begivenhed'}
                    onPress={() => setCancelProposal((prev) => !prev)}
                    style={cancelProposal ? styles.cancelToggleActive : styles.cancelToggle}
                  />
                  {cancelProposal ? (
                    <Text style={styles.cancelHint}>
                      Når familien godkender forslaget, bliver begivenheden aflyst og fjernet fra kalendere.
                    </Text>
                  ) : (
                    <Text style={styles.cancelHint}>
                      Hvis du ønsker at aflyse begivenheden helt, kan du slå aflysning til.
                    </Text>
                  )}

                  {!cancelProposal ? (
                    <>
                      <Text style={styles.modalLabel}>Starttidspunkt</Text>
                      <Pressable
                        style={styles.modalDateButton}
                        onPress={() => setShowProposalStartPicker(true)}
                      >
                        <Text style={styles.modalDateText}>
                          {formatDateTime(proposalData.start)}
                        </Text>
                      </Pressable>
                      {(isIOS || showProposalStartPicker) && (
                        <DateTimePicker
                          value={proposalData.start}
                          mode="datetime"
                          display={isIOS ? 'inline' : 'default'}
                          onChange={handleProposalStartChange}
                        />
                      )}

                      <Text style={styles.modalLabel}>Sluttidspunkt</Text>
                      <Pressable
                        style={styles.modalDateButton}
                        onPress={() => setShowProposalEndPicker(true)}
                      >
                        <Text style={styles.modalDateText}>
                          {formatDateTime(proposalData.end)}
                        </Text>
                      </Pressable>
                      {(isIOS || showProposalEndPicker) && (
                        <DateTimePicker
                          value={proposalData.end}
                          mode="datetime"
                          display={isIOS ? 'inline' : 'default'}
                          onChange={handleProposalEndChange}
                        />
                      )}

                      <Text style={styles.modalLabel}>Hurtige forslag</Text>
                      {suggestions.length ? (
                        <View style={styles.suggestionsWrap}>
                          {suggestions.map((suggestion) => (
                            <Pressable
                              key={suggestion.id}
                              onPress={() => handleSelectSuggestion(suggestion)}
                              style={[
                                styles.suggestionChip,
                                selectedSuggestionId === suggestion.id
                                  ? styles.suggestionChipSelected
                                  : null,
                              ]}
                            >
                              <Text style={styles.suggestionText}>
                                {formatDateTime(suggestion.start)}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : (
                        <Text style={styles.modalHint}>
                          Ingen oplagte tider i de næste dage. Du kan vælge tidspunkt manuelt.
                        </Text>
                      )}
                    </>
                  ) : null}

                  <ErrorMessage message={proposalError} />

                  <Button
                    title={cancelProposal ? 'Send aflysning' : 'Send forslag'}
                    onPress={handleSubmitProposal}
                    loading={proposalSaving}
                    style={styles.modalPrimaryButton}
                  />
                  <Button
                    title="Annuller"
                    onPress={closeProposalModal}
                    disabled={proposalSaving}
                    style={styles.modalSecondaryButton}
                  />
                </Pressable>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    backgroundColor: colors.canvas,
  },
  container: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    gap: spacing.lg,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 0,
    padding: spacing.xl,
    gap: spacing.sm,
    shadowColor: colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  messagesCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 0,
    padding: spacing.lg,
    gap: spacing.sm,
    shadowColor: colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  title: {
    fontSize: fontSizes.xxl,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    marginTop: spacing.xs,
  },
  infoText: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
  },
  statusText: {
    color: colors.primaryDark,
    fontSize: fontSizes.sm,
    fontWeight: '600',
  },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(230, 138, 46, 0.16)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
  },
  infoPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
  },
  sectionGroup: {
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 0,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  eventList: {
    gap: spacing.md,
  },
  sectionHeader: {
    gap: spacing.xs,
  },
  sectionTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '700',
    color: colors.text,
  },
  sectionHint: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginTop: spacing.xs,
  },
  eventCard: {
    borderRadius: radius.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    gap: spacing.xs,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  eventHeaderText: {
    flex: 1,
  },
  eventToggle: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  eventToggleIcon: {
    fontSize: fontSizes.lg,
    color: colors.mutedText,
  },
  eventToggleIconActive: {
    color: colors.primary,
  },
  eventTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  eventTime: {
    fontSize: fontSizes.md,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  eventDescription: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginBottom: spacing.xs,
  },
  eventMeta: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginBottom: spacing.xs,
  },
  approvalRow: {
    marginBottom: spacing.sm,
  },
  approvalBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  approvalBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  approvalBadgePending: {
    borderColor: colors.border,
  },
  approvalBadgeApproved: {
    borderColor: colors.success,
  },
  approvalBadgeUnknown: {
    borderColor: colors.border,
    opacity: 0.6,
  },
  approvalEmojiText: {
    fontSize: 22,
  },
  eventDetails: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  pendingChangeBox: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    backgroundColor: 'rgba(230, 138, 46, 0.12)',
    marginBottom: spacing.sm,
  },
  pendingChangeTitle: {
    fontSize: fontSizes.sm,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  pendingChangeText: {
    fontSize: fontSizes.sm,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  eventActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  eventActionButton: {
    flexGrow: 1,
  },
  eventActionButtonPrimary: {
    minWidth: 160,
  },
  eventApproveButton: {
    backgroundColor: colors.primary,
  },
  eventRejectButton: {
    backgroundColor: colors.error,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(75, 46, 18, 0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalAvoiding: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalWrapper: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
  },
  modalCard: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '700',
    color: colors.text,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSizes.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  modalNotesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalLabel: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
  },
  modalDateButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  modalDateText: {
    fontSize: fontSizes.md,
    color: colors.text,
  },
  cancelToggle: {
    backgroundColor: '#F5C88B',
    marginTop: spacing.md,
  },
  cancelToggleActive: {
    backgroundColor: colors.error,
    marginTop: spacing.md,
  },
  cancelHint: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  modalPrimaryButton: {
    marginTop: spacing.sm,
  },
  modalSecondaryButton: {
    marginTop: spacing.xs,
    backgroundColor: '#BFA386',
  },
});

export default OwnCalendarScreen;
