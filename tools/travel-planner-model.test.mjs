import test from "node:test";
import assert from "node:assert/strict";

import {
  createCalendarMonth,
  formatDateKey,
  getPlansForDate,
  isValidDateKey,
  removeTravelPlan,
  sanitizeTravelPlan,
  sanitizeTravelPlans,
  upsertTravelPlan,
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
