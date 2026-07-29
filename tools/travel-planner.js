/**
 * Overview & Purpose
 * Renders a local-first travel calendar with overhead Select and Add Event
 * tools, multi-day itinerary paging, 24-hour timelines, and explicit place
 * searches.
 *
 * Architectural Relationships
 * Called by: travel-planner.html.
 * Calls: travel-planner-model.mjs, travel-place-search.mjs, localStorage, and
 * the user-configured Nominatim-compatible place-search endpoint.
 *
 * External Resources
 * localStorage keys "pinakes-vitae-travel-planner-v1" and
 * "pinakes-vitae-travel-place-cache-v1"; travel-planner-config.json.
 *
 * Notes
 * Plans remain device-local. Only a place query explicitly submitted with the
 * Search button is sent to the configured external geocoder.
 */

import {
  TRAVEL_PLANNER_VERSION,
  createCalendarMonth,
  formatDateKey,
  getPlansForDate,
  isValid24HourTime,
  isValidDateKey,
  removeTravelPlan,
  sanitizeTravelPlans,
  toggleSelectedTravelDate,
  upsertTravelPlan,
} from "./travel-planner-model.mjs";
import {
  DEFAULT_PLACE_SEARCH_ENDPOINT,
  buildPlaceSearchUrl,
  normalizePlaceQuery,
  sanitizePlaceSearchResults,
} from "./travel-place-search.mjs";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
  requireCommandRecord,
  requireCommandString,
} from "./current-tool-ai-adapter.mjs";

const STORAGE_KEY = "pinakes-vitae-travel-planner-v1";
const PLACE_CACHE_KEY = "pinakes-vitae-travel-place-cache-v1";
const PLACE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const PLACE_CACHE_LIMIT = 30;
const PLACE_REQUEST_INTERVAL = 1000;

const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const DAY_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

const monthLabel = document.querySelector("#travel-month-label");
const calendarGrid = document.querySelector("#travel-calendar-grid");
const modeInstruction = document.querySelector("#travel-mode-instruction");
const selectionCount = document.querySelector("#travel-selection-count");
const selectedDateLabel = document.querySelector("#selected-travel-date");
const selectedPageLabel = document.querySelector("#selected-travel-page");
const previousSelectedDayButton = document.querySelector("#previous-selected-day");
const nextSelectedDayButton = document.querySelector("#next-selected-day");
const dayPageBody = document.querySelector("#travel-day-page-body");
const eventPopover = document.querySelector("#travel-event-popover");
const eventTitle = document.querySelector("#travel-event-title");
const eventDateLabel = document.querySelector("#travel-event-date-label");
const form = document.querySelector("#travel-plan-form");
const titleInput = document.querySelector("#travel-title");
const dateInput = document.querySelector("#travel-date");
const timeInput = document.querySelector("#travel-time");
const placeInput = document.querySelector("#travel-place");
const notesInput = document.querySelector("#travel-notes");
const placeSearchButton = document.querySelector("#search-travel-place");
const placeSearchStatus = document.querySelector("#travel-place-search-status");
const placeResults = document.querySelector("#travel-place-results");
const saveButton = document.querySelector("#save-travel-plan");
const deleteButton = document.querySelector("#delete-travel-plan");
const status = document.querySelector("#travel-status");
const modeButtons = [...document.querySelectorAll("[data-travel-mode]")];

const todayKey = getTodayKey();
const initialParts = parseDateKey(todayKey);
const placeSearchConfigPromise = loadPlaceSearchConfig();

let plans = loadPlans();
let displayedYear = initialParts.year;
let displayedMonth = initialParts.monthIndex;
let selectedDates = [todayKey];
let activeSelectedIndex = 0;
let activeMode = "select";
let editingPlanId = null;
let editorDate = todayKey;
let latestPlaceResults = [];
let placeSearchCache = loadPlaceSearchCache();
let lastPlaceRequestAt = 0;

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
  renderToolbar();
  renderMonth();
  renderSelectedDayPage();
}

function renderToolbar() {
  modeButtons.forEach((button) => {
    const isActive = button.dataset.travelMode === activeMode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  selectionCount.textContent = `${selectedDates.length} day${selectedDates.length === 1 ? "" : "s"} selected`;
  document.querySelector("#clear-travel-selection").disabled = selectedDates.length === 0;
  modeInstruction.textContent = activeMode === "event"
    ? "Click any calendar day to open an event box directly above it."
    : "Select one or more days to compare their complete itineraries.";
}

function renderMonth() {
  const monthDate = new Date(displayedYear, displayedMonth, 1);
  monthLabel.textContent = MONTH_FORMATTER.format(monthDate);
  calendarGrid.replaceChildren();

  const activeDate = selectedDates[activeSelectedIndex] ?? "";
  createCalendarMonth(displayedYear, displayedMonth).forEach((day) => {
    const dayPlans = getPlansForDate(plans, day.dateKey);
    const cell = document.createElement("div");
    cell.className = "travel-day-cell";
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-selected", String(selectedDates.includes(day.dateKey)));
    cell.dataset.date = day.dateKey;
    cell.classList.toggle("is-outside-month", !day.isCurrentMonth);
    cell.classList.toggle("is-selected", selectedDates.includes(day.dateKey));
    cell.classList.toggle("is-active-page", day.dateKey === activeDate);
    cell.classList.toggle("is-today", day.dateKey === todayKey);

    const header = document.createElement("div");
    header.className = "travel-day-header";
    const dayButton = document.createElement("button");
    dayButton.className = "travel-day-number";
    dayButton.type = "button";
    dayButton.textContent = day.day;
    dayButton.setAttribute("aria-label", formatDayLabel(day.dateKey));
    header.append(dayButton);

    if (dayPlans.length) {
      const count = document.createElement("span");
      count.className = "travel-day-count";
      count.textContent = `${dayPlans.length} event${dayPlans.length === 1 ? "" : "s"}`;
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
        time.textContent = plan.time;
        planButton.append(time);
      }
      planButton.append(document.createTextNode(plan.title));
      planList.append(planButton);
    });

    if (dayPlans.length > 3) {
      const moreButton = document.createElement("button");
      moreButton.className = "travel-more-plans";
      moreButton.type = "button";
      moreButton.dataset.showDay = day.dateKey;
      moreButton.textContent = `+${dayPlans.length - 3} more`;
      planList.append(moreButton);
    }

    cell.append(header, planList);
    calendarGrid.append(cell);
  });
}

function renderSelectedDayPage() {
  dayPageBody.replaceChildren();

  if (!selectedDates.length) {
    activeSelectedIndex = 0;
    selectedDateLabel.textContent = "Select a day";
    selectedPageLabel.textContent = "0 / 0";
    previousSelectedDayButton.disabled = true;
    nextSelectedDayButton.disabled = true;
    dayPageBody.append(createDayPageEmpty(
      "No days selected",
      "Use Select, then click one or more calendar days. Each selected day becomes a page here.",
    ));
    return;
  }

  activeSelectedIndex = clamp(activeSelectedIndex, 0, selectedDates.length - 1);
  const dateKey = selectedDates[activeSelectedIndex];
  const dayPlans = getPlansForDate(plans, dateKey);
  selectedDateLabel.textContent = formatDayLabel(dateKey);
  selectedPageLabel.textContent = `${activeSelectedIndex + 1} / ${selectedDates.length}`;
  previousSelectedDayButton.disabled = activeSelectedIndex === 0;
  nextSelectedDayButton.disabled = activeSelectedIndex === selectedDates.length - 1;
  dayPageBody.append(createDayTimeline(dayPlans));
}

function createDayPageEmpty(title, copy) {
  const empty = document.createElement("p");
  empty.className = "travel-day-page-empty";
  const heading = document.createElement("strong");
  heading.textContent = title;
  empty.append(heading, document.createTextNode(copy));
  return empty;
}

function createDayTimeline(dayPlans) {
  const timeline = document.createDocumentFragment();
  const allDayPlans = dayPlans.filter((plan) => !plan.time);

  if (allDayPlans.length) {
    const allDay = document.createElement("section");
    allDay.className = "travel-all-day";
    const label = document.createElement("div");
    label.className = "travel-all-day-label";
    label.textContent = "All day";
    const events = document.createElement("div");
    events.className = "travel-all-day-events";
    allDayPlans.forEach((plan) => events.append(createTimelineEvent(plan)));
    allDay.append(label, events);
    timeline.append(allDay);
  }

  const hours = document.createElement("div");
  hours.className = "travel-day-timeline";
  for (let hour = 0; hour < 24; hour += 1) {
    const hourKey = String(hour).padStart(2, "0");
    const row = document.createElement("section");
    row.className = "travel-hour-row";
    const label = document.createElement("div");
    label.className = "travel-hour-label";
    label.textContent = `${hourKey}:00`;
    const events = document.createElement("div");
    events.className = "travel-hour-events";
    dayPlans
      .filter((plan) => plan.time.startsWith(`${hourKey}:`))
      .forEach((plan) => events.append(createTimelineEvent(plan)));
    row.append(label, events);
    hours.append(row);
  }
  timeline.append(hours);
  return timeline;
}

function createTimelineEvent(plan) {
  const entry = document.createElement("article");
  entry.className = "travel-timeline-event";
  const header = document.createElement("header");
  const title = document.createElement("h3");
  title.textContent = plan.title;
  const time = document.createElement("time");
  time.textContent = plan.time || "All day";
  header.append(title, time);
  entry.append(header);

  if (plan.place) {
    const place = document.createElement("p");
    place.className = "travel-timeline-place";
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
    notes.className = "travel-timeline-notes";
    notes.textContent = plan.notes;
    entry.append(notes);
  }

  const edit = document.createElement("button");
  edit.className = "travel-timeline-edit";
  edit.type = "button";
  edit.dataset.editPlan = plan.id;
  edit.textContent = "Edit event";
  entry.append(edit);
  return entry;
}

function setMode(nextMode) {
  if (!["select", "event"].includes(nextMode)) return;
  if (nextMode === activeMode) return;
  activeMode = nextMode;
  if (activeMode === "select") closeEventEditor();
  renderToolbar();
  renderMonth();
}

function toggleDateSelection(dateKey) {
  if (!isValidDateKey(dateKey)) return;
  const previousIndex = selectedDates.indexOf(dateKey);
  const previousActiveIndex = activeSelectedIndex;
  selectedDates = toggleSelectedTravelDate(selectedDates, dateKey);

  if (previousIndex < 0) {
    activeSelectedIndex = selectedDates.length - 1;
  } else if (!selectedDates.length) {
    activeSelectedIndex = 0;
  } else if (previousIndex < previousActiveIndex) {
    activeSelectedIndex = previousActiveIndex - 1;
  } else if (previousIndex === previousActiveIndex) {
    activeSelectedIndex = Math.min(previousIndex, selectedDates.length - 1);
  }

  renderPlanner();
}

function activateDate(dateKey) {
  if (!isValidDateKey(dateKey)) return;
  if (!selectedDates.includes(dateKey)) selectedDates.push(dateKey);
  activeSelectedIndex = selectedDates.indexOf(dateKey);
}

function changeSelectedDayPage(offset) {
  const nextIndex = activeSelectedIndex + offset;
  if (nextIndex < 0 || nextIndex >= selectedDates.length) return;
  closeEventEditor();
  activeSelectedIndex = nextIndex;
  renderMonth();
  renderSelectedDayPage();
}

function clearSelectedDates() {
  closeEventEditor();
  selectedDates = [];
  activeSelectedIndex = 0;
  renderPlanner();
}

function showToday() {
  closeEventEditor();
  const parts = parseDateKey(todayKey);
  displayedYear = parts.year;
  displayedMonth = parts.monthIndex;
  activateDate(todayKey);
  renderPlanner();
}

function openNewEventEditor(dateKey) {
  if (!isValidDateKey(dateKey)) return;
  editingPlanId = null;
  editorDate = dateKey;
  activateDate(dateKey);
  renderPlanner();
  resetEventForm();
  eventTitle.textContent = "Add event";
  saveButton.textContent = "Add event";
  deleteButton.hidden = true;
  showEventEditor(getCalendarCell(dateKey));
}

function openExistingEventEditor(planId) {
  const plan = plans.find((candidate) => candidate.id === planId);
  if (!plan) return;

  editingPlanId = plan.id;
  editorDate = plan.date;
  activeMode = "event";
  activateDate(plan.date);
  const parts = parseDateKey(plan.date);
  displayedYear = parts.year;
  displayedMonth = parts.monthIndex;
  renderPlanner();
  resetEventForm();
  titleInput.value = plan.title;
  timeInput.value = plan.time;
  placeInput.value = plan.place;
  notesInput.value = plan.notes;
  eventTitle.textContent = "Edit event";
  saveButton.textContent = "Update event";
  deleteButton.hidden = false;
  showEventEditor(getCalendarCell(plan.date));
}

function resetEventForm() {
  form.reset();
  dateInput.value = editorDate;
  eventDateLabel.textContent = formatDayLabel(editorDate);
  timeInput.setCustomValidity("");
  latestPlaceResults = [];
  placeResults.replaceChildren();
  placeResults.hidden = true;
  setPlaceSearchStatus("");
}

function showEventEditor(anchorCell) {
  document.querySelectorAll(".travel-day-cell.is-editor-anchor")
    .forEach((cell) => cell.classList.remove("is-editor-anchor"));
  anchorCell?.classList.add("is-editor-anchor");

  eventPopover.hidden = false;
  eventPopover.classList.remove("is-opening");
  eventPopover.style.visibility = "hidden";
  window.requestAnimationFrame(() => {
    positionEventEditor(anchorCell);
    eventPopover.style.visibility = "";
    eventPopover.classList.add("is-opening");
    titleInput.focus({ preventScroll: true });
  });
}

function positionEventEditor(anchorCell = getCalendarCell(editorDate)) {
  const margin = 12;
  const popoverRect = eventPopover.getBoundingClientRect();
  const anchorRect = anchorCell?.getBoundingClientRect();
  let left = anchorRect
    ? anchorRect.left + (anchorRect.width - popoverRect.width) / 2
    : (window.innerWidth - popoverRect.width) / 2;
  left = clamp(left, margin, window.innerWidth - popoverRect.width - margin);

  let top = anchorRect
    ? anchorRect.top - popoverRect.height - 8
    : (window.innerHeight - popoverRect.height) / 2;
  if (top < margin && anchorRect) top = anchorRect.bottom + 8;
  top = clamp(top, margin, window.innerHeight - popoverRect.height - margin);

  eventPopover.style.left = `${Math.round(left)}px`;
  eventPopover.style.top = `${Math.round(top)}px`;
}

function closeEventEditor() {
  eventPopover.hidden = true;
  eventPopover.classList.remove("is-opening");
  document.querySelectorAll(".travel-day-cell.is-editor-anchor")
    .forEach((cell) => cell.classList.remove("is-editor-anchor"));
  editingPlanId = null;
}

function handleFormSubmit(event) {
  event.preventDefault();
  const enteredTime = timeInput.value.trim();
  if (enteredTime && !isValid24HourTime(enteredTime)) {
    timeInput.setCustomValidity("Use 24-hour HH:MM time from 00:00 to 23:59.");
    timeInput.reportValidity();
    return;
  }

  const wasEditing = Boolean(editingPlanId);
  const planId = editingPlanId || createPlanId();
  plans = upsertTravelPlan(plans, {
    id: planId,
    title: titleInput.value,
    date: editorDate,
    time: enteredTime,
    place: placeInput.value,
    notes: notesInput.value,
  });
  activateDate(editorDate);
  savePlans(wasEditing ? "Event updated" : "Event added");
  closeEventEditor();
  renderPlanner();
}

function deleteEditingEvent() {
  if (!editingPlanId) return;
  const confirmed = window.confirm("Delete this travel event?");
  if (!confirmed) return;
  plans = removeTravelPlan(plans, editingPlanId);
  savePlans("Event deleted");
  closeEventEditor();
  renderPlanner();
}

function changeDisplayedMonth(offset) {
  closeEventEditor();
  const month = new Date(displayedYear, displayedMonth + offset, 1);
  displayedYear = month.getFullYear();
  displayedMonth = month.getMonth();
  renderMonth();
}

function getCalendarCell(dateKey) {
  return [...calendarGrid.querySelectorAll(".travel-day-cell")]
    .find((cell) => cell.dataset.date === dateKey) ?? null;
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

function createPlanId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `travel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

async function loadPlaceSearchConfig() {
  try {
    const response = await fetch("./travel-planner-config.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Configuration request failed with ${response.status}`);
    const config = await response.json();
    return buildPlaceSearchUrl(config.placeSearchEndpoint, "test")
      ? { endpoint: config.placeSearchEndpoint }
      : { endpoint: DEFAULT_PLACE_SEARCH_ENDPOINT };
  } catch (error) {
    console.warn("Using the default place-search service.", error);
    return { endpoint: DEFAULT_PLACE_SEARCH_ENDPOINT };
  }
}

function loadPlaceSearchCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLACE_CACHE_KEY));
    if (!parsed || typeof parsed !== "object") return {};
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, entry]) => (
          Number.isFinite(entry?.savedAt)
          && now - entry.savedAt < PLACE_CACHE_TTL
          && Array.isArray(entry.results)
        ))
        .slice(-PLACE_CACHE_LIMIT),
    );
  } catch {
    return {};
  }
}

function getCachedPlaceResults(query) {
  const cacheKey = query.toLocaleLowerCase();
  const entry = placeSearchCache[cacheKey];
  if (!entry || Date.now() - entry.savedAt >= PLACE_CACHE_TTL) return null;
  return sanitizePlaceSearchResults(entry.results);
}

function rememberPlaceResults(query, results) {
  placeSearchCache[query.toLocaleLowerCase()] = {
    savedAt: Date.now(),
    results,
  };
  const boundedEntries = Object.entries(placeSearchCache)
    .sort(([, first], [, second]) => first.savedAt - second.savedAt)
    .slice(-PLACE_CACHE_LIMIT);
  placeSearchCache = Object.fromEntries(boundedEntries);
  try {
    localStorage.setItem(PLACE_CACHE_KEY, JSON.stringify(placeSearchCache));
  } catch (error) {
    console.warn("Unable to cache place-search results.", error);
  }
}

async function searchPlaces() {
  const query = normalizePlaceQuery(placeInput.value);
  if (query.length < 3) {
    setPlaceSearchStatus("Enter at least three characters.", true);
    placeInput.focus();
    return;
  }

  const cached = getCachedPlaceResults(query);
  if (cached) {
    latestPlaceResults = cached;
    renderPlaceResults();
    setPlaceSearchStatus(`${cached.length} cached result${cached.length === 1 ? "" : "s"}.`);
    return;
  }

  placeSearchButton.disabled = true;
  setPlaceSearchStatus("Searching addresses and businesses…");
  try {
    const waitTime = Math.max(0, PLACE_REQUEST_INTERVAL - (Date.now() - lastPlaceRequestAt));
    if (waitTime) await new Promise((resolve) => window.setTimeout(resolve, waitTime));
    const config = await placeSearchConfigPromise;
    const url = buildPlaceSearchUrl(config.endpoint, query);
    if (!url) throw new Error("The place-search service is not configured correctly.");
    lastPlaceRequestAt = Date.now();
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      referrerPolicy: "strict-origin-when-cross-origin",
    });
    if (!response.ok) throw new Error(`Place search failed with ${response.status}`);
    latestPlaceResults = sanitizePlaceSearchResults(await response.json());
    rememberPlaceResults(query, latestPlaceResults);
    renderPlaceResults();
    setPlaceSearchStatus(
      latestPlaceResults.length
        ? `${latestPlaceResults.length} result${latestPlaceResults.length === 1 ? "" : "s"}. Choose one below.`
        : "No matching address or business was found.",
      latestPlaceResults.length === 0,
    );
  } catch (error) {
    console.error("Unable to search places.", error);
    latestPlaceResults = [];
    renderPlaceResults();
    setPlaceSearchStatus("Place search is unavailable. You can still type and save the place.", true);
  } finally {
    placeSearchButton.disabled = false;
  }
}

function renderPlaceResults() {
  placeResults.replaceChildren();
  placeResults.hidden = latestPlaceResults.length === 0;
  latestPlaceResults.forEach((result, index) => {
    const button = document.createElement("button");
    button.className = "travel-place-result";
    button.type = "button";
    button.role = "option";
    button.dataset.placeResult = String(index);
    button.textContent = result.displayName;
    placeResults.append(button);
  });
}

function setPlaceSearchStatus(message, isError = false) {
  placeSearchStatus.textContent = message;
  placeSearchStatus.classList.toggle("has-error", isError);
}

calendarGrid.addEventListener("click", (event) => {
  const editTarget = event.target.closest("[data-edit-plan]");
  if (editTarget) {
    openExistingEventEditor(editTarget.dataset.editPlan);
    return;
  }

  const showDayTarget = event.target.closest("[data-show-day]");
  if (showDayTarget) {
    activateDate(showDayTarget.dataset.showDay);
    renderPlanner();
    return;
  }

  const cell = event.target.closest(".travel-day-cell");
  if (!cell) return;
  if (activeMode === "event") {
    openNewEventEditor(cell.dataset.date);
  } else {
    toggleDateSelection(cell.dataset.date);
  }
});

dayPageBody.addEventListener("click", (event) => {
  const editTarget = event.target.closest("[data-edit-plan]");
  if (editTarget) openExistingEventEditor(editTarget.dataset.editPlan);
});

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.travelMode));
});

form.addEventListener("submit", handleFormSubmit);
timeInput.addEventListener("input", () => timeInput.setCustomValidity(""));
deleteButton.addEventListener("click", deleteEditingEvent);
document.querySelector("#cancel-travel-edit").addEventListener("click", closeEventEditor);
document.querySelector("#close-travel-event").addEventListener("click", closeEventEditor);
document.querySelector("#clear-travel-selection").addEventListener("click", clearSelectedDates);
document.querySelector("#travel-today").addEventListener("click", showToday);
document.querySelector("#previous-travel-month").addEventListener("click", () => changeDisplayedMonth(-1));
document.querySelector("#next-travel-month").addEventListener("click", () => changeDisplayedMonth(1));
previousSelectedDayButton.addEventListener("click", () => changeSelectedDayPage(-1));
nextSelectedDayButton.addEventListener("click", () => changeSelectedDayPage(1));
placeSearchButton.addEventListener("click", searchPlaces);

placeInput.addEventListener("input", () => {
  latestPlaceResults = [];
  placeResults.replaceChildren();
  placeResults.hidden = true;
  setPlaceSearchStatus("");
});

placeInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (!placeSearchButton.disabled) searchPlaces();
});

placeResults.addEventListener("click", (event) => {
  const resultButton = event.target.closest("[data-place-result]");
  if (!resultButton) return;
  const result = latestPlaceResults[Number(resultButton.dataset.placeResult)];
  if (!result) return;
  placeInput.value = result.displayName;
  placeResults.hidden = true;
  setPlaceSearchStatus("Place linked to this event.");
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!eventPopover.hidden) {
    closeEventEditor();
    return;
  }
  setMode("select");
});

window.addEventListener("resize", () => {
  if (!eventPopover.hidden) positionEventEditor();
});

renderPlanner();

installCurrentToolAiHost({
  id: "travel-planner",
  title: "Travel Planner",
  description: "Reads and safely stages local itinerary events without invoking network place search.",
  limitations: [
    "Place search is not available through AI commands because it sends a query to an external geocoder.",
    "Event deletion remains an explicit user action.",
  ],
  getSnapshot: () => ({
    plans,
    selectedDates,
    displayedYear,
    displayedMonth,
  }),
  getContext: (_options, snapshot) => ({
    eventCount: snapshot.plans.length,
    selectedDates: snapshot.selectedDates,
    displayedMonth: {
      year: snapshot.displayedYear,
      month: snapshot.displayedMonth + 1,
    },
    dateRange: snapshot.plans.length
      ? {
        first: snapshot.plans[0].date,
        last: snapshot.plans.at(-1).date,
      }
      : null,
  }),
  commitSnapshot(nextState) {
    if (!eventPopover.hidden) {
      throw new Error("Close the open event editor before applying AI changes.");
    }
    const nextPlans = sanitizeTravelPlans(nextState.plans);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: TRAVEL_PLANNER_VERSION,
      plans: nextPlans,
    }));
    plans = nextPlans;
    status.textContent = "AI changes saved locally";
    status.classList.remove("has-error");
    renderPlanner();
  },
  commands: [
    {
      type: "calendar.describe",
      description: "Describe itinerary coverage without exposing event content.",
      permissions: ["read-summary"],
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, [], commandIndex);
        return {
          value: {
            eventCount: state.plans.length,
            selectedDates: state.selectedDates,
            dateRange: state.plans.length
              ? { first: state.plans[0].date, last: state.plans.at(-1).date }
              : null,
          },
        };
      },
    },
    {
      type: "plans.list",
      description: "List itinerary events, optionally for one date.",
      permissions: ["read-content"],
      schema: {
        type: "object",
        properties: { date: { type: "string", format: "date" } },
        additionalProperties: false,
      },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["date"], commandIndex);
        if (command.date === undefined) return { value: state.plans };
        const date = requireCommandString(
          command.date,
          "date",
          commandIndex,
          { maximumLength: 10 },
        );
        if (!isValidDateKey(date)) throw new Error("date must use YYYY-MM-DD.");
        return { value: getPlansForDate(state.plans, date) };
      },
    },
    {
      type: "plans.get",
      description: "Read one itinerary event by stable ID.",
      permissions: ["read-content"],
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["planId"], commandIndex);
        const planId = requireCommandString(
          command.planId,
          "planId",
          commandIndex,
          { maximumLength: 128 },
        );
        return { value: state.plans.find((plan) => plan.id === planId) ?? null };
      },
    },
    {
      type: "plans.upsert",
      description: "Create or replace one validated itinerary event.",
      permissions: ["create", "update"],
      mutates: true,
      schema: {
        type: "object",
        required: ["plan"],
        properties: { plan: { type: "object" } },
        additionalProperties: false,
      },
      execute(state, command, { commandIndex }) {
        rejectUnknownCommandFields(command, ["plan"], commandIndex);
        const record = requireCommandRecord(command.plan, "plan", commandIndex);
        const id = typeof record.id === "string" && record.id.trim()
          ? record.id.trim()
          : createPlanId();
        const previous = state.plans.find((plan) => plan.id === id);
        const candidate = { ...(previous ?? {}), ...record, id };
        const nextPlans = upsertTravelPlan(state.plans, candidate);
        const saved = nextPlans.find((plan) => plan.id === id);
        if (!saved) {
          throw new Error("The event needs a title and valid YYYY-MM-DD date.");
        }
        return {
          state: { ...state, plans: nextPlans },
          ...(previous ? { updatedIds: [id] } : { createdIds: [id] }),
          value: saved,
        };
      },
    },
  ],
});
