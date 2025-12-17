/**
 * Hjælpefunktioner til at håndtere lokale notifikations-actions for pending familieevents.
 * Bruges når brugeren trykker "Godkend/Afvis" direkte fra notifikationen.
 */
import * as Notifications from 'expo-notifications';

import { auth, db, firebase } from '../lib/firebase';
import {
  PENDING_APPROVAL_APPROVE_ACTION,
  PENDING_APPROVAL_REJECT_ACTION,
} from '../constants/notifications';

const getEventDocRef = (familyId, eventId) =>
  db.collection('families').doc(familyId).collection('events').doc(eventId);

const toFirestoreTimestamp = (value) => {
  if (!value) {
    return null;
  }
  if (value instanceof firebase.firestore.Timestamp) {
    return value;
  }
  if (value instanceof Date) {
    return firebase.firestore.Timestamp.fromDate(value);
  }
  return null;
};

// Markerer et event som godkendt fra en notifikation (og opdaterer/aflyser ved behov).
const approvePendingEvent = async ({ familyId, eventId, userId }) => {
  const docRef = getEventDocRef(familyId, eventId);
  const snapshot = await docRef.get();
  if (!snapshot.exists) {
    return false;
  }

  const event = snapshot.data() ?? {};
  const pendingList = Array.isArray(event.pendingApprovals)
    ? event.pendingApprovals
    : [];

  if (!pendingList.includes(userId)) {
    return false;
  }

  const remaining = pendingList.filter((id) => id !== userId);
  const approvedBy = Array.isArray(event.approvedBy)
    ? Array.from(new Set([...event.approvedBy, userId]))
    : [userId];

  if (remaining.length === 0 && event.pendingChange?.cancel) {
    await docRef.delete();
    return true;
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
      const nextStart = toFirestoreTimestamp(event.pendingChange.start);
      const nextEnd = toFirestoreTimestamp(event.pendingChange.end);
      if (nextStart) {
        updatePayload.start = nextStart;
      }
      if (nextEnd) {
        updatePayload.end = nextEnd;
      }
      if (typeof event.pendingChange.title === 'string') {
        updatePayload.title = event.pendingChange.title;
      }
      if (typeof event.pendingChange.description === 'string') {
        updatePayload.description = event.pendingChange.description;
      }

      updatePayload.pendingChange = firebase.firestore.FieldValue.delete();
    }
  }

  await docRef.set(updatePayload, { merge: true });
  return true;
};

// Afviser en ventende ændring/aflysning fra en notifikation.
const rejectPendingChange = async ({ familyId, eventId }) => {
  const docRef = getEventDocRef(familyId, eventId);
  const snapshot = await docRef.get();
  if (!snapshot.exists) {
    return false;
  }
  const event = snapshot.data() ?? {};
  if (!event.pendingChange) {
    return false;
  }

  await docRef.set(
    {
      pendingApprovals: [],
      approvedBy: [],
      pendingChange: firebase.firestore.FieldValue.delete(),
      status: 'confirmed',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return true;
};

// Entry-point fra Expo notifications: ruter godkend/afvis actions til Firestore.
export const handlePendingApprovalNotificationResponse = async (response) => {
  try {
    const actionId = response?.actionIdentifier;
    if (
      !actionId ||
      actionId === Notifications.DEFAULT_ACTION_IDENTIFIER
    ) {
      return;
    }

    const data = response?.notification?.request?.content?.data ?? {};
    const familyId = typeof data.familyId === 'string' ? data.familyId : '';
    const eventId = typeof data.eventId === 'string' ? data.eventId : '';
    if (!familyId || !eventId) {
      return;
    }

    const currentUserId = auth.currentUser?.uid ?? '';
    if (!currentUserId) {
      return;
    }

    if (actionId === PENDING_APPROVAL_APPROVE_ACTION) {
      await approvePendingEvent({ familyId, eventId, userId: currentUserId });
      return;
    }

    if (actionId === PENDING_APPROVAL_REJECT_ACTION) {
      await rejectPendingChange({ familyId, eventId });
    }
  } catch (error) {
    console.warn('Kunne ikke håndtere notifikationshandling', error);
  }
};
