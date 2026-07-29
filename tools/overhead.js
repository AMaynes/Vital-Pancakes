import {
  buildBackup,
  createId,
  createRepository,
  createUndoManager,
  downloadJson,
  mergeImportedRecords,
  readJsonFile,
  validateBackupEnvelope,
} from "./local-toolkit.mjs";
import {
  FOREGROUND_LIMIT,
  TRACKER_TEMPLATES,
  calculateTrackerSummary,
  classifyDueDate,
  completeTask,
  decryptPrivatePayload,
  emptyOverheadState,
  encryptPrivatePayload,
  getInventoryWarning,
  validateOverheadState,
} from "./overhead-model.mjs";
import { activateTabs, element, parseTags, toast } from "./suite-ui.mjs";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
  requireCommandRecord,
  requireCommandString,
} from "./current-tool-ai-adapter.mjs?v=1";

const repository = createRepository("overhead");
const history = createUndoManager(150);
const unlockedPrivate = new Map();
const AUTO_LOCK_MS = 5 * 60 * 1000;
let autoLockTimer = null;
let state = emptyOverheadState();

const byId = (id) => document.getElementById(id);

async function start() {
  try {
    state = validateOverheadState((await repository.get("state")) ?? emptyOverheadState());
  } catch (error) {
    toast(`Saved Overhead data could not be opened: ${error.message}`, "error");
    state = emptyOverheadState();
  }
  activateTabs(document.querySelector(".suite-tabs"));
  bindEvents();
  resetAutoLock();
  render();
  installOverheadAiHost();
}

function installOverheadAiHost() {
  installCurrentToolAiHost({
    id: "overhead",
    title: "Overhead",
    description: "Captures and organizes non-private Overhead records while keeping encrypted sections outside AI context.",
    limitations: [
      "Encrypted section titles, envelopes, passwords, and decrypted content are never exposed or changed through AI commands.",
      "Browser and operating-system notification delivery remains user-controlled.",
    ],
    getSnapshot: () => state,
    getContext: (_options, snapshot) => ({
      counts: {
        brainDump: snapshot.inbox.length,
        forefront: snapshot.forefront.length,
        tasks: snapshot.tasks.length,
        trackers: snapshot.trackers.length,
        inventory: snapshot.inventory.length,
        encryptedSections: snapshot.privateSections.length,
      },
      forefrontLimit: FOREGROUND_LIMIT,
    }),
    async commitSnapshot(nextState) {
      state = validateOverheadState(nextState);
      state.updatedAt = new Date().toISOString();
      unlockedPrivate.clear();
      await repository.put("state", state);
      render();
    },
    commands: [
      {
        type: "overhead.summary",
        description: "Read record counts and due-state totals without returning record content.",
        permissions: ["read-summary"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "overhead.summary" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return {
            value: {
              counts: {
                brainDump: snapshot.inbox.length,
                forefront: snapshot.forefront.length,
                tasks: snapshot.tasks.length,
                trackers: snapshot.trackers.length,
                inventory: snapshot.inventory.length,
                encryptedSections: snapshot.privateSections.length,
              },
              overdueTasks: snapshot.tasks.filter((task) => (
                !task.completed && classifyDueDate(task.dueDate) === "overdue"
              )).length,
            },
          };
        },
      },
      {
        type: "brain-dump.list",
        description: "List non-archived brain-dump captures.",
        permissions: ["read-content"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "brain-dump.list" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return { value: snapshot.inbox.filter((item) => !item.archived) };
        },
      },
      {
        type: "brain-dump.add",
        description: "Add one non-private brain-dump capture.",
        permissions: ["create"],
        mutates: true,
        schema: {
          type: "object",
          required: ["text"],
          properties: { text: { type: "string", maxLength: 4000 }, tags: { type: "array" }, pinned: { type: "boolean" } },
          additionalProperties: false,
        },
        example: { type: "brain-dump.add", text: "Schedule annual inspection", tags: ["house"], pinned: true },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["text", "tags", "pinned"], commandIndex);
          const item = {
            id: createId("capture"),
            text: requireCommandString(command.text, "text", commandIndex, { maximumLength: 4000 }),
            tags: Array.isArray(command.tags) ? parseTags(command.tags.join(",")) : [],
            pinned: Boolean(command.pinned),
            archived: false,
            createdAt: new Date().toISOString(),
          };
          return {
            state: { ...snapshot, inbox: [item, ...snapshot.inbox] },
            createdIds: [item.id],
            value: item,
          };
        },
      },
      {
        type: "tasks.list",
        description: "List non-private todo records.",
        permissions: ["read-content"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "tasks.list" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return { value: snapshot.tasks };
        },
      },
      {
        type: "tasks.upsert",
        description: "Create or update one todo while preserving completion history when updating.",
        permissions: ["create", "update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["task"],
          properties: { task: { type: "object" } },
          additionalProperties: false,
        },
        example: { type: "tasks.upsert", task: { title: "Replace air filter", dueDate: "2026-08-01", recurrence: "monthly", priority: "high" } },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["task"], commandIndex);
          const input = requireCommandRecord(command.task, "task", commandIndex);
          const existing = input.id
            ? snapshot.tasks.find((task) => task.id === input.id)
            : null;
          const task = {
            id: existing?.id ?? createId("task"),
            title: requireCommandString(input.title ?? existing?.title, "task.title", commandIndex, { maximumLength: 500 }),
            listId: input.listId ?? existing?.listId ?? snapshot.lists[0]?.id,
            priority: input.priority ?? existing?.priority ?? "normal",
            dueDate: input.dueDate ?? existing?.dueDate ?? "",
            recurrence: input.recurrence ?? existing?.recurrence ?? "none",
            notes: String(input.notes ?? existing?.notes ?? "").slice(0, 8000),
            subtasks: Array.isArray(input.subtasks) ? input.subtasks : existing?.subtasks ?? [],
            completed: Boolean(input.completed ?? existing?.completed),
            completionHistory: existing?.completionHistory ?? [],
            order: existing?.order ?? snapshot.tasks.length,
            createdAt: existing?.createdAt ?? new Date().toISOString(),
          };
          const tasks = existing
            ? snapshot.tasks.map((candidate) => candidate.id === task.id ? task : candidate)
            : [...snapshot.tasks, task];
          return {
            state: { ...snapshot, tasks },
            ...(existing ? { updatedIds: [task.id] } : { createdIds: [task.id] }),
            value: task,
          };
        },
      },
      {
        type: "inventory.upsert",
        description: "Create or update one non-private inventory record.",
        permissions: ["create", "update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["item"],
          properties: { item: { type: "object" } },
          additionalProperties: false,
        },
        example: { type: "inventory.upsert", item: { name: "Air filters", quantity: 1, minimum: 2, location: "Garage" } },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["item"], commandIndex);
          const input = requireCommandRecord(command.item, "item", commandIndex);
          const existing = input.id
            ? snapshot.inventory.find((item) => item.id === input.id)
            : null;
          const item = {
            ...(existing ?? {}),
            ...input,
            id: existing?.id ?? createId("stock"),
            name: requireCommandString(input.name ?? existing?.name, "item.name", commandIndex, { maximumLength: 500 }),
            quantity: Math.max(0, Number(input.quantity ?? existing?.quantity ?? 0)),
            minimum: Math.max(0, Number(input.minimum ?? existing?.minimum ?? 0)),
            category: String(input.category ?? existing?.category ?? "").slice(0, 200),
            location: String(input.location ?? existing?.location ?? "").slice(0, 500),
            notes: String(input.notes ?? existing?.notes ?? "").slice(0, 8000),
          };
          const inventory = existing
            ? snapshot.inventory.map((candidate) => candidate.id === item.id ? item : candidate)
            : [...snapshot.inventory, item];
          return {
            state: { ...snapshot, inventory },
            ...(existing ? { updatedIds: [item.id] } : { createdIds: [item.id] }),
            value: item,
          };
        },
      },
    ],
  });
}

function bindEvents() {
  byId("brain-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    mutate("Capture thought", (draft) => draft.inbox.unshift({
      id: createId("capture"),
      text: String(values.get("text")).trim(),
      tags: parseTags(values.get("tags")),
      pinned: false,
      archived: false,
      createdAt: new Date().toISOString(),
    }));
    event.currentTarget.reset();
  });
  byId("brain-search").addEventListener("input", renderBrainDump);
  byId("brain-apply-bulk").addEventListener("click", applyBrainBulk);

  byId("forefront-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    mutate("Add foreground priority", (draft) => draft.forefront.push({
      id: createId("priority"),
      title: values.title.trim(),
      deadline: values.deadline,
      taskId: values.taskId,
      notes: values.notes.trim(),
      order: draft.forefront.length,
    }));
    event.currentTarget.reset();
  });

  byId("todo-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    mutate("Add task", (draft) => draft.tasks.push({
      id: createId("task"),
      title: values.title.trim(),
      listId: values.listId || draft.lists[0]?.id,
      priority: values.priority,
      dueDate: values.dueDate,
      recurrence: values.recurrence,
      notes: values.notes.trim(),
      subtasks: String(values.subtasks).split(",").map((title) => title.trim()).filter(Boolean)
        .map((title) => ({ id: createId("subtask"), title, completed: false })),
      completed: false,
      completionHistory: [],
      order: draft.tasks.length,
      createdAt: new Date().toISOString(),
    }));
    event.currentTarget.reset();
  });
  byId("todo-view").addEventListener("change", renderTodos);
  byId("todo-list-filter").addEventListener("change", renderTodos);
  byId("add-list").addEventListener("click", () => {
    const name = prompt("List name");
    if (!name?.trim()) return;
    mutate("Add list", (draft) => draft.lists.push({
      id: createId("list"),
      name: name.trim(),
      order: draft.lists.length,
    }));
  });

  byId("private-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      const envelope = await encryptPrivatePayload({ content: values.content }, values.password);
      mutate("Add encrypted section", (draft) => draft.privateSections.push({
        id: createId("private"),
        title: values.title.trim(),
        envelope,
        updatedAt: new Date().toISOString(),
      }));
      form.reset();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  byId("lock-private").addEventListener("click", lockPrivateSections);

  TRACKER_TEMPLATES.forEach(([id, name]) => {
    const option = element("option", "", name);
    option.value = id;
    byId("tracker-template").append(option);
  });
  byId("tracker-template").addEventListener("change", fillTrackerTemplate);
  byId("tracker-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    mutate("Add tracker", (draft) => draft.trackers.push({
      id: createId("tracker"),
      name: values.name.trim(),
      type: values.type,
      schedule: values.schedule,
      intervalDays: Math.max(1, Number(values.intervalDays) || 1),
      startedAt: localToday(),
      history: [],
    }));
    event.currentTarget.reset();
  });
  byId("enable-notifications").addEventListener("click", enableNotifications);

  byId("inventory-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    mutate("Add inventory item", (draft) => draft.inventory.push({
      id: createId("stock"),
      name: values.name.trim(),
      category: values.category.trim(),
      quantity: Number(values.quantity) || 0,
      minimum: Number(values.minimum) || 0,
      location: values.location.trim(),
      expirationDate: values.expirationDate,
      purchaseDate: values.purchaseDate,
      notes: values.notes.trim(),
      restock: false,
    }));
    event.currentTarget.reset();
  });
  byId("inventory-view").addEventListener("change", renderInventory);

  byId("overhead-undo").addEventListener("click", () => restoreHistory("undo"));
  byId("overhead-redo").addEventListener("click", () => restoreHistory("redo"));
  byId("overhead-export").addEventListener("click", () => {
    downloadJson(buildBackup("overhead", [state], {
      privateData: "Encrypted AES-GCM envelopes only; no plaintext passwords or decrypted content.",
    }), `overhead-backup-${localToday()}.json`);
  });
  byId("overhead-import").addEventListener("click", () => byId("overhead-import-input").click());
  byId("overhead-import-input").addEventListener("change", importBackup);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) lockPrivateSections();
  });
  ["pointerdown", "keydown"].forEach((type) => document.addEventListener(type, resetAutoLock, { passive: true }));
}

function mutate(label, operation) {
  const before = structuredClone(state);
  operation(state);
  state.updatedAt = new Date().toISOString();
  history.record(before, state, label);
  persistAndRender();
}

async function persistAndRender() {
  try {
    await repository.put("state", state);
  } catch (error) {
    toast(`Could not save: ${error.message}`, "error");
  }
  render();
}

function restoreHistory(direction) {
  const result = history[direction](state);
  if (!result.label) return;
  state = result.value;
  persistAndRender();
  toast(`${direction === "undo" ? "Undid" : "Redid"} ${result.label}.`);
}

function render() {
  renderSelects();
  renderBrainDump();
  renderForefront();
  renderTodos();
  renderPrivate();
  renderTrackers();
  renderInventory();
  byId("overhead-undo").disabled = !history.canUndo;
  byId("overhead-redo").disabled = !history.canRedo;
}

function renderSelects() {
  const listSelects = [byId("todo-list-select"), byId("todo-list-filter")];
  listSelects.forEach((select, index) => {
    const current = select.value;
    select.replaceChildren();
    if (index === 1) {
      const all = element("option", "", "All lists");
      all.value = "";
      select.append(all);
    }
    state.lists.sort((a, b) => a.order - b.order).forEach((list) => {
      const option = element("option", "", list.name);
      option.value = list.id;
      select.append(option);
    });
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  });

  const taskSelect = byId("forefront-task");
  const currentTask = taskSelect.value;
  taskSelect.replaceChildren(Object.assign(element("option", "", "None"), { value: "" }));
  state.tasks.filter((task) => !task.completed).forEach((task) => {
    taskSelect.append(Object.assign(element("option", "", task.title), { value: task.id }));
  });
  taskSelect.value = currentTask;
}

function renderBrainDump() {
  const query = byId("brain-search").value.trim().toLowerCase();
  const list = byId("brain-list");
  list.replaceChildren();
  state.inbox
    .filter((item) => !item.archived)
    .filter((item) => !query || `${item.text} ${item.tags.join(" ")}`.toLowerCase().includes(query))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))
    .forEach((item) => {
      const row = element("li", "suite-row");
      const checkbox = Object.assign(element("input"), { type: "checkbox" });
      checkbox.dataset.brainSelect = item.id;
      const main = element("div", "suite-row-main");
      main.append(element("strong", "", `${item.pinned ? "Pinned · " : ""}${item.text}`));
      main.append(element("span", "", `${item.tags.join(", ") || "No tags"} · ${new Date(item.createdAt).toLocaleString()}`));
      const actions = element("div", "suite-actions");
      ["task", "priority", "note", "tracker", "private"].forEach((target) => {
        const button = element("button", "button button-quiet", target);
        button.type = "button";
        button.addEventListener("click", () => convertCapture(item.id, target));
        actions.append(button);
      });
      row.append(checkbox, main, actions);
      list.append(row);
    });
  if (!list.children.length) list.append(element("li", "suite-empty", "Nothing waiting to be organized."));
}

function applyBrainBulk() {
  const action = byId("brain-bulk-action").value;
  const selected = [...document.querySelectorAll("[data-brain-select]:checked")].map((node) => node.dataset.brainSelect);
  if (!action || !selected.length) return;
  mutate(`${action} captures`, (draft) => {
    if (action === "delete") draft.inbox = draft.inbox.filter((item) => !selected.includes(item.id));
    else draft.inbox.forEach((item) => {
      if (!selected.includes(item.id)) return;
      if (action === "archive") item.archived = true;
      if (action === "pin") item.pinned = true;
    });
  });
}

async function convertCapture(id, target) {
  const capture = state.inbox.find((item) => item.id === id);
  if (!capture) return;
  if (target === "private") {
    const password = prompt("Password for this encrypted private record (at least 8 characters)");
    if (!password || password.length < 8) return;
    try {
      const envelope = await encryptPrivatePayload({ content: capture.text }, password);
      mutate("Convert capture", (draft) => {
        draft.privateSections.push({
          id: createId("private"),
          title: capture.text.slice(0, 60),
          envelope,
          updatedAt: new Date().toISOString(),
        });
        draft.inbox = draft.inbox.filter((item) => item.id !== id);
      });
    } catch (error) {
      toast(error.message, "error");
    }
    return;
  }

  mutate("Convert capture", (draft) => {
    if (target === "task") draft.tasks.push({
      id: createId("task"), title: capture.text, listId: draft.lists[0]?.id, priority: "normal",
      dueDate: "", recurrence: "none", notes: "", subtasks: [], completed: false, completionHistory: [],
      order: draft.tasks.length, createdAt: new Date().toISOString(),
    });
    if (target === "priority") draft.forefront.push({
      id: createId("priority"), title: capture.text, deadline: "", taskId: "", notes: "", order: draft.forefront.length,
    });
    if (target === "note") draft.notes.push({
      id: createId("note"), title: capture.text.slice(0, 60), content: capture.text, tags: capture.tags,
    });
    if (target === "tracker") draft.trackers.push({
      id: createId("tracker"), name: capture.text.slice(0, 80), type: "boolean", schedule: "daily",
      intervalDays: 1, startedAt: localToday(), history: [],
    });
    draft.inbox = draft.inbox.filter((item) => item.id !== id);
  });
}

function renderForefront() {
  const list = byId("forefront-list");
  list.replaceChildren();
  const ordered = [...state.forefront].sort((a, b) => a.order - b.order);
  byId("forefront-count").textContent = `${ordered.length} / ${FOREGROUND_LIMIT} recommended`;
  byId("forefront-warning").hidden = ordered.length <= FOREGROUND_LIMIT;
  ordered.forEach((item, index) => {
    const row = element("li", "suite-row");
    row.append(element("span", "suite-chip", String(index + 1)));
    const main = element("div", "suite-row-main");
    main.append(element("strong", "", item.title));
    const task = state.tasks.find((candidate) => candidate.id === item.taskId);
    main.append(element("span", "", [item.deadline && `Due ${item.deadline}`, task && `Task: ${task.title}`, item.notes].filter(Boolean).join(" · ") || "No deadline"));
    const actions = element("div", "suite-actions");
    actions.append(actionButton("↑", () => moveForefront(index, -1), "Move up"));
    actions.append(actionButton("↓", () => moveForefront(index, 1), "Move down"));
    actions.append(actionButton("Remove", () => mutate("Remove priority", (draft) => {
      draft.forefront = draft.forefront.filter((candidate) => candidate.id !== item.id);
    })));
    row.append(main, actions);
    list.append(row);
  });
  if (!ordered.length) list.append(element("li", "suite-empty", "Add only what truly needs to stay in mind."));
}

function moveForefront(index, offset) {
  const ordered = [...state.forefront].sort((a, b) => a.order - b.order);
  const target = index + offset;
  if (target < 0 || target >= ordered.length) return;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  mutate("Reorder priorities", (draft) => {
    ordered.forEach((item, order) => {
      draft.forefront.find((candidate) => candidate.id === item.id).order = order;
    });
  });
}

function renderTodos() {
  const view = byId("todo-view").value;
  const listId = byId("todo-list-filter").value;
  const list = byId("todo-list");
  list.replaceChildren();
  const tasks = state.tasks
    .filter((task) => !listId || task.listId === listId)
    .filter((task) => view === "completed" ? task.completed : !task.completed)
    .filter((task) => ["all", "completed"].includes(view) || classifyDueDate(task.dueDate) === view)
    .sort((a, b) => a.order - b.order);

  tasks.forEach((task, index) => {
    const row = element("li", "suite-row");
    row.draggable = true;
    row.dataset.taskId = task.id;
    row.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", task.id));
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => reorderTask(event, index, tasks));
    const complete = Object.assign(element("input"), { type: "checkbox", checked: task.completed });
    complete.addEventListener("change", () => mutate("Complete task", (draft) => {
      const found = draft.tasks.find((candidate) => candidate.id === task.id);
      Object.assign(found, completeTask(found));
    }));
    const main = element("div", "suite-row-main");
    main.append(element("strong", "", task.title));
    const listName = state.lists.find((candidate) => candidate.id === task.listId)?.name ?? "Unknown list";
    const status = classifyDueDate(task.dueDate);
    main.append(element("span", "", `${listName} · ${task.priority} · ${status}${task.recurrence !== "none" ? ` · ${task.recurrence}` : ""} · ${task.subtasks.filter((item) => item.completed).length}/${task.subtasks.length} subtasks · ${task.completionHistory.length} completions`));
    const actions = element("div", "suite-actions");
    task.subtasks.forEach((subtask) => {
      const button = actionButton(subtask.completed ? `✓ ${subtask.title}` : subtask.title, () => {
        mutate("Toggle subtask", (draft) => {
          const found = draft.tasks.find((candidate) => candidate.id === task.id)
            .subtasks.find((candidate) => candidate.id === subtask.id);
          found.completed = !found.completed;
        });
      });
      actions.append(button);
    });
    actions.append(actionButton("Delete", () => mutate("Delete task", (draft) => {
      draft.tasks = draft.tasks.filter((candidate) => candidate.id !== task.id);
    })));
    row.append(complete, main, actions);
    list.append(row);
  });
  if (!tasks.length) list.append(element("li", "suite-empty", "No tasks match this view."));
}

function reorderTask(event, targetIndex, visibleTasks) {
  const sourceId = event.dataTransfer.getData("text/plain");
  const sourceIndex = visibleTasks.findIndex((task) => task.id === sourceId);
  if (sourceIndex < 0 || sourceIndex === targetIndex) return;
  const ordered = [...visibleTasks];
  const [moved] = ordered.splice(sourceIndex, 1);
  ordered.splice(targetIndex, 0, moved);
  mutate("Reorder tasks", (draft) => {
    ordered.forEach((task, index) => { draft.tasks.find((candidate) => candidate.id === task.id).order = index; });
  });
}

function renderPrivate() {
  const list = byId("private-list");
  list.replaceChildren();
  state.privateSections.forEach((section) => {
    const row = element("li", "suite-row");
    row.append(element("span", "suite-chip", unlockedPrivate.has(section.id) ? "Open" : "Locked"));
    const main = element("div", "suite-row-main");
    main.append(element("strong", "", section.title));
    main.append(element("span", "", unlockedPrivate.get(section.id)?.content ?? "Encrypted content is not kept in memory while locked."));
    const actions = element("div", "suite-actions");
    actions.append(actionButton(unlockedPrivate.has(section.id) ? "Lock" : "Unlock", () => {
      if (unlockedPrivate.has(section.id)) {
        unlockedPrivate.delete(section.id);
        renderPrivate();
      } else {
        unlockSection(section);
      }
    }));
    actions.append(actionButton("Delete", () => mutate("Delete encrypted section", (draft) => {
      unlockedPrivate.delete(section.id);
      draft.privateSections = draft.privateSections.filter((candidate) => candidate.id !== section.id);
    })));
    row.append(main, actions);
    list.append(row);
  });
  if (!state.privateSections.length) list.append(element("li", "suite-empty", "No encrypted sections yet."));
}

async function unlockSection(section) {
  const password = prompt(`Password for “${section.title}”`);
  if (!password) return;
  try {
    unlockedPrivate.set(section.id, await decryptPrivatePayload(section.envelope, password));
    resetAutoLock();
    renderPrivate();
  } catch (error) {
    toast(error.message, "error");
  }
}

function lockPrivateSections() {
  unlockedPrivate.clear();
  renderPrivate();
  resetAutoLock();
}

function resetAutoLock() {
  clearTimeout(autoLockTimer);
  autoLockTimer = setTimeout(lockPrivateSections, AUTO_LOCK_MS);
}

function fillTrackerTemplate() {
  const template = TRACKER_TEMPLATES.find(([id]) => id === byId("tracker-template").value);
  if (!template) return;
  const form = byId("tracker-form");
  form.elements.name.value = template[1];
  form.elements.type.value = template[2];
  form.elements.schedule.value = template[3];
}

function renderTrackers() {
  const container = byId("tracker-list");
  container.replaceChildren();
  state.trackers.forEach((tracker) => {
    const summary = calculateTrackerSummary(tracker);
    const card = element("article", "suite-card");
    card.append(element("h3", "", tracker.name));
    card.append(element("p", "", `${tracker.type} · ${tracker.schedule} · streak ${summary.streak} · ${summary.missed} missed · ${Math.round(summary.progress * 100)}% recent`));
    const input = element("input", "suite-input");
    input.type = tracker.type === "boolean" ? "checkbox" : tracker.type === "free-text" ? "text" : "number";
    if (tracker.type === "duration") input.placeholder = "Minutes";
    const actions = element("div", "suite-actions");
    const log = actionButton(summary.dueToday ? "Log today" : "Log another entry", () => {
      const value = tracker.type === "boolean" ? input.checked : input.value;
      if (tracker.type !== "boolean" && value === "") return toast("Enter a value first.", "error");
      mutate("Log tracker", (draft) => draft.trackers.find((candidate) => candidate.id === tracker.id)
        .history.push({ id: createId("entry"), at: new Date().toISOString(), value }));
    });
    actions.append(input, log, actionButton("Delete", () => mutate("Delete tracker", (draft) => {
      draft.trackers = draft.trackers.filter((candidate) => candidate.id !== tracker.id);
    })));
    card.append(actions);
    container.append(card);
  });
  if (!state.trackers.length) container.append(element("div", "suite-empty", "Choose a template or make a custom tracker."));
}

async function enableNotifications() {
  if (!("Notification" in window)) return toast("This browser does not support notifications.", "error");
  const permission = await Notification.requestPermission();
  toast(permission === "granted" ? "Browser notifications enabled for this browser." : "Notification permission was not granted.");
}

function renderInventory() {
  const view = byId("inventory-view").value;
  const list = byId("inventory-list");
  list.replaceChildren();
  state.inventory
    .map((item) => ({ item, warning: getInventoryWarning(item) }))
    .filter(({ item, warning }) => view === "all"
      || (view === "low" && warning.lowStock)
      || (view === "expiring" && (warning.expiringSoon || warning.expired))
      || (view === "restock" && item.restock))
    .forEach(({ item, warning }) => {
      const row = element("li", "suite-row");
      row.append(element("span", "suite-chip", warning.needsAttention ? "Attention" : "Stocked"));
      const main = element("div", "suite-row-main");
      main.append(element("strong", "", item.name));
      main.append(element("span", "", `${item.quantity} on hand · minimum ${item.minimum} · ${item.location || "No location"}${warning.daysUntilExpiration !== null ? ` · expires in ${warning.daysUntilExpiration} days` : ""}`));
      const actions = element("div", "suite-actions");
      actions.append(actionButton(item.restock ? "Unmark restock" : "Restock", () => mutate("Toggle restock", (draft) => {
        const found = draft.inventory.find((candidate) => candidate.id === item.id);
        found.restock = !found.restock;
      })));
      if (warning.lowStock) actions.append(actionButton("Make todo", () => mutate("Create restock task", (draft) => {
        draft.tasks.push({
          id: createId("task"), title: `Restock ${item.name}`, listId: draft.lists[0]?.id, priority: "high",
          dueDate: "", recurrence: "none", notes: item.notes, subtasks: [], completed: false,
          completionHistory: [], order: draft.tasks.length, createdAt: new Date().toISOString(),
        });
      })));
      actions.append(actionButton("Delete", () => mutate("Delete inventory item", (draft) => {
        draft.inventory = draft.inventory.filter((candidate) => candidate.id !== item.id);
      })));
      row.append(main, actions);
      list.append(row);
    });
  if (!list.children.length) list.append(element("li", "suite-empty", "No inventory items match this view."));
}

async function importBackup(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  try {
    const backup = validateBackupEnvelope(await readJsonFile(file), "overhead");
    const incomingState = validateOverheadState(backup.records[0]);
    const before = structuredClone(state);
    const collectionKeys = ["inbox", "forefront", "lists", "tasks", "notes", "trackers", "inventory", "privateSections"];
    let conflictCount = 0;
    collectionKeys.forEach((key) => {
      const merged = mergeImportedRecords(state[key], incomingState[key]);
      state[key] = merged.records;
      conflictCount += merged.conflicts.length;
    });
    history.record(before, state, "Import backup");
    await persistAndRender();
    toast(`Imported backup${conflictCount ? ` with ${conflictCount} preserved conflicts` : ""}.`);
  } catch (error) {
    toast(error.message, "error");
  }
}

function actionButton(label, callback, ariaLabel = label) {
  const button = element("button", "button button-quiet", label);
  button.type = "button";
  button.setAttribute("aria-label", ariaLabel);
  button.addEventListener("click", callback);
  return button;
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

start();
