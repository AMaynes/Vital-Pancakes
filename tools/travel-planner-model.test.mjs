import test from "node:test";
import assert from "node:assert/strict";

import {
  createCalendarMonth,
  formatDateKey,
  getPlansForDate,
  isValid24HourTime,
  isValidDateKey,
  removeTravelPlan,
  sanitizeTravelPlannerState,
  sanitizeTravelPlan,
  sanitizeTravelPlans,
  sanitizeTravelTrip,
  toggleSelectedTravelDate,
  upsertTravelPlan,
  upsertTravelTrip,
} from "./travel-planner-model.mjs";

test("calendar months always provide six complete Sunday-first weeks", () => {
  const days = createCalendarMonth(2026, 6);
  assert.equal(days.length, 42);
  assert.equal(days[0].dateKey, "2026-06-28");
  assert.equal(days[41].dateKey, "2026-08-08");
  assert.equal(days.filter((day) => day.isCurrentMonth).length, 31);
});

test("date keys validate leap days and reject rolled-over dates", () => {
  assert.equal(formatDateKey(2024, 1, 29), "2024-02-29");
  assert.equal(isValidDateKey("2024-02-29"), true);
  assert.equal(isValidDateKey("2025-02-29"), false);
  assert.equal(isValidDateKey("2026-13-01"), false);
});

test("times use strict 24-hour HH:MM values", () => {
  assert.equal(isValid24HourTime("00:00"), true);
  assert.equal(isValid24HourTime("23:59"), true);
  assert.equal(isValid24HourTime("24:00"), false);
  assert.equal(isValid24HourTime("9:30"), false);
  assert.equal(isValid24HourTime("09:60"), false);
});

test("selected days toggle independently while preserving page order", () => {
  const firstSelection = toggleSelectedTravelDate([], "2026-07-15");
  const multipleSelection = toggleSelectedTravelDate(firstSelection, "2026-07-18");
  assert.deepEqual(multipleSelection, ["2026-07-15", "2026-07-18"]);
  assert.deepEqual(
    toggleSelectedTravelDate(multipleSelection, "2026-07-15"),
    ["2026-07-18"],
  );
  assert.deepEqual(toggleSelectedTravelDate(multipleSelection, "invalid"), multipleSelection);
});

test("saved plans are trimmed, bounded, and ordered by date and time", () => {
  const plans = sanitizeTravelPlans({
    plans: [
      { id: "late", title: "  Dinner   reservation ", date: "2026-07-12", time: "19:30", place: " Old Quarter " },
      { id: "early", title: "Train", date: "2026-07-12", time: "08:10" },
      { id: "all-day", title: "Explore", date: "2026-07-12", time: "invalid" },
      { id: "", title: "Missing identifier", date: "2026-07-12" },
    ],
  });
  assert.deepEqual(plans.map((plan) => plan.id), ["all-day", "early", "late"]);
  assert.equal(plans[2].title, "Dinner reservation");
  assert.equal(plans[2].place, "Old Quarter");
});

test("malformed plans are rejected at the persistence boundary", () => {
  assert.equal(sanitizeTravelPlan(null), null);
  assert.equal(sanitizeTravelPlan({ id: "x", title: "", date: "2026-07-12" }), null);
  assert.equal(sanitizeTravelPlan({ id: "x", title: "Flight", date: "not-a-date" }), null);
});

test("plans can be added, updated, queried, and removed without duplicates", () => {
  const initial = upsertTravelPlan([], {
    id: "flight",
    title: "Flight to Hanoi",
    date: "2026-07-15",
    time: "09:20",
  });
  const updated = upsertTravelPlan(initial, {
    id: "flight",
    title: "Flight to Da Nang",
    date: "2026-07-16",
    time: "10:20",
  });
  assert.equal(updated.length, 1);
  assert.equal(getPlansForDate(updated, "2026-07-16")[0].title, "Flight to Da Nang");
  assert.deepEqual(removeTravelPlan(updated, "flight"), []);
});

test("a trip preserves the five planning answers and normalized date range", () => {
  const trip = sanitizeTravelTrip({
    id: "trip-1",
    title: "Vietnam",
    destination: " Hanoi ",
    startDate: "2026-09-10",
    endDate: "2026-09-18",
    gettingThere: "Flight and airport transfer",
    staying: "Old Quarter hotel",
    eating: "Markets and saved restaurants",
    activities: "Museums and day trip",
    departure: "Train on the final morning",
    nextDestination: "Da Nang",
  });
  assert.equal(trip.destination, "Hanoi");
  assert.equal(trip.nextDestination, "Da Nang");
  assert.equal(trip.activities, "Museums and day trip");
});

test("trip state migrates legacy events and upserts trips without duplicates", () => {
  const legacy = sanitizeTravelPlannerState({
    version: 1,
    plans: [{ id: "event", title: "Explore", date: "2026-09-10" }],
  });
  assert.equal(legacy.version, 2);
  assert.equal(legacy.plans[0].tripId, "");
  const trips = upsertTravelTrip([], { id: "trip", title: "First trip" });
  const updated = upsertTravelTrip(trips, { id: "trip", title: "Renamed trip" });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].title, "Renamed trip");
});
