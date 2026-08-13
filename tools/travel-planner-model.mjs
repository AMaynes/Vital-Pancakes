/**
 * Pure calendar and persistence helpers for the Travel Planner.
 */

export const TRAVEL_PLANNER_VERSION = 2;

const TITLE_LIMIT = 120;
const PLACE_LIMIT = 200;
const NOTES_LIMIT = 2000;
const TRIP_TEXT_LIMIT = 5000;

export function createCalendarMonth(year, monthIndex) {
  const normalizedMonth = new Date(Date.UTC(year, monthIndex, 1));
  const displayYear = normalizedMonth.getUTCFullYear();
  const displayMonth = normalizedMonth.getUTCMonth();
  const firstWeekday = normalizedMonth.getUTCDay();
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(displayYear, displayMonth, index - firstWeekday + 1));
    return {
      dateKey: formatDateKey(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
      ),
      day: date.getUTCDate(),
      monthIndex: date.getUTCMonth(),
      year: date.getUTCFullYear(),
      isCurrentMonth: date.getUTCMonth() === displayMonth,
    };
  });
}

export function formatDateKey(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function isValidDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return false;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  return formatDateKey(year, monthIndex, day) === value;
}

export function isValid24HourTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? ""));
}

export function toggleSelectedTravelDate(selectedDates, dateKey) {
  const normalized = [...new Set(
    (Array.isArray(selectedDates) ? selectedDates : []).filter(isValidDateKey),
  )];
  if (!isValidDateKey(dateKey)) return normalized;
  return normalized.includes(dateKey)
    ? normalized.filter((selectedDate) => selectedDate !== dateKey)
    : [...normalized, dateKey];
}

export function sanitizeTravelPlans(saved) {
  const source = Array.isArray(saved) ? saved : saved?.plans;
  if (!Array.isArray(source)) return [];
  return sortTravelPlans(source.map(sanitizeTravelPlan).filter(Boolean));
}

export function sanitizeTravelPlan(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const id = String(candidate.id ?? "").trim().slice(0, 128);
  const title = normalizeText(candidate.title, TITLE_LIMIT);
  const date = String(candidate.date ?? "");
  if (!id || !title || !isValidDateKey(date)) return null;
  return {
    id,
    title,
    date,
    time: normalizeTime(candidate.time),
    place: normalizeText(candidate.place, PLACE_LIMIT),
    notes: normalizeText(candidate.notes, NOTES_LIMIT, true),
    tripId: normalizeText(candidate.tripId, 128),
  };
}

export function sanitizeTravelTrips(saved) {
  const source = Array.isArray(saved) ? saved : saved?.trips;
  if (!Array.isArray(source)) return [];
  return source.map(sanitizeTravelTrip).filter(Boolean).sort((left, right) => (
    left.startDate.localeCompare(right.startDate) || left.title.localeCompare(right.title)
  ));
}

export function sanitizeTravelTrip(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const id = normalizeText(candidate.id, 128);
  const title = normalizeText(candidate.title, TITLE_LIMIT);
  if (!id || !title) return null;
  const startDate = isValidDateKey(candidate.startDate) ? candidate.startDate : "";
  const endDate = isValidDateKey(candidate.endDate) ? candidate.endDate : "";
  return {
    id,
    title,
    destination: normalizeText(candidate.destination, PLACE_LIMIT),
    startDate,
    endDate: startDate && endDate && endDate < startDate ? startDate : endDate,
    gettingThere: normalizeText(candidate.gettingThere, TRIP_TEXT_LIMIT, true),
    staying: normalizeText(candidate.staying, TRIP_TEXT_LIMIT, true),
    eating: normalizeText(candidate.eating, TRIP_TEXT_LIMIT, true),
    activities: normalizeText(candidate.activities, TRIP_TEXT_LIMIT, true),
    departure: normalizeText(candidate.departure, TRIP_TEXT_LIMIT, true),
    nextDestination: normalizeText(candidate.nextDestination, PLACE_LIMIT),
    notes: normalizeText(candidate.notes, TRIP_TEXT_LIMIT, true),
  };
}

export function sanitizeTravelPlannerState(saved) {
  const trips = sanitizeTravelTrips(saved);
  const tripIds = new Set(trips.map(({ id }) => id));
  const activeTripId = tripIds.has(saved?.activeTripId) ? saved.activeTripId : (trips[0]?.id ?? "");
  return {
    version: TRAVEL_PLANNER_VERSION,
    trips,
    activeTripId,
    plans: sanitizeTravelPlans(saved),
  };
}

export function upsertTravelTrip(trips, candidate) {
  const normalized = sanitizeTravelTrip(candidate);
  if (!normalized) return sanitizeTravelTrips(trips);
  return sanitizeTravelTrips([
    ...trips.filter((trip) => trip.id !== normalized.id),
    normalized,
  ]);
}

export function sortTravelPlans(plans) {
  return [...plans].sort((first, second) => (
    first.date.localeCompare(second.date)
    || timeSortKey(first.time).localeCompare(timeSortKey(second.time))
    || first.title.localeCompare(second.title)
  ));
}

export function getPlansForDate(plans, dateKey) {
  return sortTravelPlans(plans.filter((plan) => plan.date === dateKey));
}

export function upsertTravelPlan(plans, candidate) {
  const normalized = sanitizeTravelPlan(candidate);
  if (!normalized) return sortTravelPlans(plans);
  const nextPlans = plans.filter((plan) => plan.id !== normalized.id);
  nextPlans.push(normalized);
  return sortTravelPlans(nextPlans);
}

export function removeTravelPlan(plans, planId) {
  return plans.filter((plan) => plan.id !== planId);
}

function normalizeText(value, limit, preserveLines = false) {
  const source = String(value ?? "");
  const normalized = preserveLines
    ? source.replace(/\r\n?/g, "\n").trim()
    : source.replace(/\s+/g, " ").trim();
  return normalized.slice(0, limit);
}

function normalizeTime(value) {
  const time = String(value ?? "");
  return isValid24HourTime(time) ? time : "";
}

function timeSortKey(time) {
  return time || "00:00";
}
