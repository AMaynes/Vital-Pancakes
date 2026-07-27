/**
 * Overview & Purpose
 * Renders and persists a deliberately simple month-based travel itinerary.
 *
 * Architectural Relationships
 * Called by: travel-planner.html.
 * Calls: travel-planner-model.mjs and browser localStorage.
 *
 * External Resources
 * localStorage key "pinakes-vitae-travel-planner-v1".
 *
 * Notes
 * Plans are device-local and have no reminders, notifications, or sync.
 */

import {
  TRAVEL_PLANNER_VERSION,
  createCalendarMonth,
  formatDateKey,
  getPlansForDate,
  isValidDateKey,
  removeTravelPlan,
  sanitizeTravelPlans,
  upsertTravelPlan,
} from "./travel-planner-model.mjs";

const STORAGE_KEY = "pinakes-vitae-travel-planner-v1";
const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const monthLabel = document.querySelector("#travel-month-label");
const calendarGrid = document.querySelector("#travel-calendar-grid");
const selectedDateLabel = document.querySelector("#selected-travel-date");
const selectedCount = document.querySelector("#selected-travel-count");
const agenda = document.querySelector("#travel-agenda");
const form = document.querySelector("#travel-plan-form");
const titleInput = document.querySelector("#travel-title");
const dateInput = document.querySelector("#travel-date");
const timeInput = document.querySelector("#travel-time");
const placeInput = document.querySelector("#travel-place");
const notesInput = document.querySelector("#travel-notes");
const saveButton = document.querySelector("#save-travel-plan");
const deleteButton = document.querySelector("#delete-travel-plan");
const status = document.querySelector("#travel-status");

const todayKey = getTodayKey();
const initialParts = parseDateKey(todayKey);
let plans = loadPlans();
let displayedYear = initialParts.year;
let displayedMonth = initialParts.monthIndex;
let selectedDate = todayKey;
let editingPlanId = null;

function loadPlans() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return sanitizeTravelPlans(saved);
  } catch (error) {
    console.error("Unable to load saved travel plans.", error);
    return [];
  }
}

function savePlans(message = "Saved locally") {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: TRAVEL_PLANNER_VERSION,
      plans,
    }));
    status.textContent = message;
    status.classList.remove("has-error");
  } catch (error) {
    console.error("Unable to save travel plans.", error);
    status.textContent = "Storage is full";
    status.classList.add("has-error");
  }
}

function renderPlanner() {
  renderMonth();
  renderSelectedDay();
}

function renderMonth() {
  const monthDate = new Date(displayedYear, displayedMonth, 1);
  monthLabel.textContent = MONTH_FORMATTER.format(monthDate);
  calendarGrid.replaceChildren();

  createCalendarMonth(displayedYear, displayedMonth).forEach((day) => {
    const dayPlans = getPlansForDate(plans, day.dateKey);
    const cell = document.createElement("div");
    cell.className = "travel-day-cell";
    cell.setAttribute("role", "gridcell");
    cell.dataset.date = day.dateKey;
    cell.dataset.selectDate = day.dateKey;
    cell.classList.toggle("is-outside-month", !day.isCurrentMonth);
    cell.classList.toggle("is-selected", day.dateKey === selectedDate);
    cell.classList.toggle("is-today", day.dateKey === todayKey);

    const header = document.createElement("div");
    header.className = "travel-day-header";
    const dayButton = document.createElement("button");
    dayButton.className = "travel-day-number";
    dayButton.type = "button";
    dayButton.dataset.selectDate = day.dateKey;
    dayButton.textContent = day.day;
    dayButton.setAttribute("aria-label", formatDayLabel(day.dateKey));
    header.append(dayButton);
    if (dayPlans.length) {
      const count = document.createElement("span");
      count.className = "travel-day-count";
      count.textContent = dayPlans.length;
      header.append(count);
    }

    const planList = document.createElement("div");
    planList.className = "travel-day-plans";
    dayPlans.slice(0, 3).forEach((plan) => {
      const planButton = document.createElement("button");
      planButton.className = "travel-calendar-plan";
      planButton.type = "button";
      planButton.dataset.editPlan = plan.id;
      planButton.title = [plan.title, plan.place].filter(Boolean).join(" · ");
      if (plan.time) {
        const time = document.createElement("time");
        time.textContent = formatTime(plan.time);
        planButton.append(time);
      }
      planButton.append(document.createTextNode(plan.title));
      planList.append(planButton);
    });
    if (dayPlans.length > 3) {
      const moreButton = document.createElement("button");
      moreButton.className = "travel-more-plans";
      moreButton.type = "button";
      moreButton.dataset.selectDate = day.dateKey;
      moreButton.textContent = `+${dayPlans.length - 3} more`;
      planList.append(moreButton);
    }

    cell.append(header, planList);
    calendarGrid.append(cell);
  });
}

function renderSelectedDay() {
  const dayPlans = getPlansForDate(plans, selectedDate);
  selectedDateLabel.textContent = formatDayLabel(selectedDate);
  selectedCount.textContent = `${dayPlans.length} plan${dayPlans.length === 1 ? "" : "s"}`;
  dateInput.value = selectedDate;
  agenda.replaceChildren();

  if (!dayPlans.length) {
    const empty = document.createElement("p");
    empty.className = "travel-agenda-empty";
    empty.textContent = "Nothing planned yet. Add the first stop for this day.";
    agenda.append(empty);
    return;
  }

  dayPlans.forEach((plan) => agenda.append(createAgendaEntry(plan)));
}

function createAgendaEntry(plan) {
  const entry = document.createElement("article");
  entry.className = "travel-agenda-entry";
  const header = document.createElement("header");
  const title = document.createElement("h3");
  title.textContent = plan.title;
  const time = document.createElement("time");
  time.textContent = plan.time ? formatTime(plan.time) : "All day";
  header.append(title, time);
  entry.append(header);

  if (plan.place) {
    const place = document.createElement("p");
    place.className = "travel-agenda-place";
    const label = document.createElement("span");
    label.textContent = plan.place;
    const mapLink = document.createElement("a");
    mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(plan.place)}`;
    mapLink.target = "_blank";
    mapLink.rel = "noopener noreferrer";
    mapLink.textContent = "Map ↗";
    place.append(label, mapLink);
    entry.append(place);
  }

  if (plan.notes) {
    const notes = document.createElement("p");
    notes.className = "travel-agenda-notes";
    notes.textContent = plan.notes;
    entry.append(notes);
  }

  const edit = document.createElement("button");
  edit.className = "travel-agenda-edit";
  edit.type = "button";
  edit.dataset.editPlan = plan.id;
  edit.textContent = "Edit plan";
  entry.append(edit);
  return entry;
}

function selectDate(dateKey, resetForm = true) {
  if (!isValidDateKey(dateKey)) return;
  selectedDate = dateKey;
  const parts = parseDateKey(dateKey);
  displayedYear = parts.year;
  displayedMonth = parts.monthIndex;
  if (resetForm) resetEditor();
  renderPlanner();
}

function startEditingPlan(planId) {
  const plan = plans.find((candidate) => candidate.id === planId);
  if (!plan) return;
  editingPlanId = plan.id;
  selectedDate = plan.date;
  const parts = parseDateKey(plan.date);
  displayedYear = parts.year;
  displayedMonth = parts.monthIndex;
  titleInput.value = plan.title;
  dateInput.value = plan.date;
  timeInput.value = plan.time;
  placeInput.value = plan.place;
  notesInput.value = plan.notes;
  saveButton.textContent = "Update plan";
  deleteButton.hidden = false;
  renderPlanner();
  titleInput.focus();
}

function resetEditor() {
  editingPlanId = null;
  form.reset();
  dateInput.value = selectedDate;
  saveButton.textContent = "Add to calendar";
  deleteButton.hidden = true;
}

function handleFormSubmit(event) {
  event.preventDefault();
  const planId = editingPlanId || createPlanId();
  const nextDate = dateInput.value;
  plans = upsertTravelPlan(plans, {
    id: planId,
    title: titleInput.value,
    date: nextDate,
    time: timeInput.value,
    place: placeInput.value,
    notes: notesInput.value,
  });
  selectedDate = nextDate;
  const parts = parseDateKey(nextDate);
  displayedYear = parts.year;
  displayedMonth = parts.monthIndex;
  savePlans(editingPlanId ? "Plan updated" : "Plan added");
  resetEditor();
  renderPlanner();
}

function deleteEditingPlan() {
  if (!editingPlanId) return;
  plans = removeTravelPlan(plans, editingPlanId);
  savePlans("Plan deleted");
  resetEditor();
  renderPlanner();
}

function changeDisplayedMonth(offset) {
  const month = new Date(displayedYear, displayedMonth + offset, 1);
  displayedYear = month.getFullYear();
  displayedMonth = month.getMonth();
  renderMonth();
}

function getTodayKey() {
  const today = new Date();
  return formatDateKey(today.getFullYear(), today.getMonth(), today.getDate());
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, monthIndex: month - 1, day };
}

function formatDayLabel(dateKey) {
  const parts = parseDateKey(dateKey);
  return DAY_FORMATTER.format(new Date(parts.year, parts.monthIndex, parts.day));
}

function formatTime(timeValue) {
  const [hour, minute] = timeValue.split(":").map(Number);
  return TIME_FORMATTER.format(new Date(2000, 0, 1, hour, minute));
}

function createPlanId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `travel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

calendarGrid.addEventListener("click", (event) => {
  const editTarget = event.target.closest("[data-edit-plan]");
  if (editTarget) {
    startEditingPlan(editTarget.dataset.editPlan);
    return;
  }
  const dateTarget = event.target.closest("[data-select-date]");
  if (dateTarget) selectDate(dateTarget.dataset.selectDate);
});

agenda.addEventListener("click", (event) => {
  const editTarget = event.target.closest("[data-edit-plan]");
  if (editTarget) startEditingPlan(editTarget.dataset.editPlan);
});

form.addEventListener("submit", handleFormSubmit);
dateInput.addEventListener("change", () => {
  if (!isValidDateKey(dateInput.value)) return;
  selectedDate = dateInput.value;
  const parts = parseDateKey(selectedDate);
  displayedYear = parts.year;
  displayedMonth = parts.monthIndex;
  renderMonth();
  renderSelectedDay();
});
deleteButton.addEventListener("click", deleteEditingPlan);
document.querySelector("#cancel-travel-edit").addEventListener("click", () => {
  resetEditor();
  titleInput.focus();
});
document.querySelector("#new-travel-plan").addEventListener("click", () => {
  resetEditor();
  titleInput.focus();
});
document.querySelector("#travel-today").addEventListener("click", () => selectDate(todayKey));
document.querySelector("#previous-travel-month").addEventListener("click", () => changeDisplayedMonth(-1));
document.querySelector("#next-travel-month").addEventListener("click", () => changeDisplayedMonth(1));

resetEditor();
renderPlanner();
