import {
  BRACKET_FORMAT,
  BRACKET_VERSION,
  calculateStandings,
  clearMatchResult,
  createRoundRobinPlayoff,
  createTournament,
  setMatchResult,
  updateMatchDetails,
  validateTournament,
} from "./bracket-model.mjs";
import { renderBracketSvg } from "./bracket-renderer.mjs";
import { createId, createRepository, downloadBlob, downloadJson, readJsonFile } from "./local-toolkit.mjs";
import { activateTabs, element, escapeCsv, toast, trapDialog } from "./suite-ui.mjs";
import {
  installCurrentToolAiHost,
  rejectUnknownCommandFields,
  requireCommandRecord,
  requireCommandString,
} from "./current-tool-ai-adapter.mjs?v=1";

const repository = createRepository("bracket-tournaments");
let tournament = createTournament({ name: "New Tournament", type: "single", participants: ["Ada", "Grace", "Edsger", "Donald"] });
let saved = [];
let history = [];
let currentSvg = "";
let pan = null;

const byId = (id) => document.getElementById(id);

async function start() {
  saved = await repository.list();
  if (saved.length) {
    try { tournament = validateTournament(saved.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]); } catch { /* keep starter */ }
  }
  activateTabs(document.querySelector(".suite-tabs"), render);
  bindEvents();
  trapDialog(byId("bracket-match-dialog"));
  render();
  installBracketAiHost();
}

function installBracketAiHost() {
  installCurrentToolAiHost({
    id: "bracket-generator",
    title: "Bracket Generator",
    description: "Creates tournaments and records validated match results through the pure bracket model.",
    limitations: [
      "Randomized seeding uses the tournament model at command execution time and is not reproducible unless participants are supplied in the desired order.",
      "Exports and print dialogs remain explicit user actions.",
    ],
    getSnapshot: () => tournament,
    getContext: (_options, snapshot) => ({
      id: snapshot.id,
      name: snapshot.name,
      type: snapshot.type,
      participants: snapshot.participants.length,
      matches: snapshot.matches.length,
      completedMatches: snapshot.matches.filter((match) => match.status === "complete").length,
      championId: snapshot.championId,
    }),
    async commitSnapshot(nextTournament) {
      tournament = validateTournament(nextTournament);
      history = [];
      await persist();
    },
    commands: [
      {
        type: "tournament.describe",
        description: "Read tournament progress and participant counts without names or match notes.",
        permissions: ["read-summary"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "tournament.describe" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return {
            value: {
              id: snapshot.id,
              name: snapshot.name,
              type: snapshot.type,
              participants: snapshot.participants.length,
              matches: snapshot.matches.length,
              completedMatches: snapshot.matches.filter((match) => match.status === "complete").length,
              championId: snapshot.championId,
            },
          };
        },
      },
      {
        type: "tournament.get",
        description: "Read the complete current tournament project.",
        permissions: ["read-content"],
        schema: { type: "object", additionalProperties: false },
        example: { type: "tournament.get" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, [], commandIndex);
          return { value: snapshot };
        },
      },
      {
        type: "tournament.create",
        description: "Create a single-elimination, double-elimination, or round-robin tournament.",
        permissions: ["create"],
        mutates: true,
        schema: {
          type: "object",
          required: ["name", "tournamentType", "participants"],
          properties: {
            name: { type: "string" },
            tournamentType: { type: "string", enum: ["single", "double", "round-robin"] },
            participants: { type: "array" },
            seeding: { type: "string", enum: ["manual", "ranked", "random"] },
            thirdPlace: { type: "boolean" },
          },
          additionalProperties: false,
        },
        example: { type: "tournament.create", name: "Office Cup", tournamentType: "single", participants: ["Ada", "Grace", "Edsger"], seeding: "ranked" },
        execute(_snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["name", "tournamentType", "participants", "seeding", "thirdPlace"], commandIndex);
          const name = requireCommandString(command.name, "name", commandIndex, { maximumLength: 220 });
          if (!Array.isArray(command.participants)) throw new Error("participants must be a list.");
          const next = createTournament({
            id: createId("tournament"),
            name,
            type: command.tournamentType,
            participants: command.participants,
            seeding: command.seeding ?? "manual",
            thirdPlace: Boolean(command.thirdPlace),
          });
          return {
            state: next,
            createdIds: [next.id, ...next.participants.map((participant) => participant.id)],
            value: { id: next.id, matches: next.matches.length },
          };
        },
      },
      {
        type: "match.result.set",
        description: "Record a result and deterministically invalidate incompatible downstream results.",
        permissions: ["update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["matchId", "result"],
          properties: { matchId: { type: "string" }, result: { type: "object" } },
          additionalProperties: false,
        },
        example: { type: "match.result.set", matchId: "w-r1-m1", result: { scoreA: 2, scoreB: 1 } },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["matchId", "result"], commandIndex);
          const matchId = requireCommandString(command.matchId, "matchId", commandIndex, { maximumLength: 160 });
          const result = requireCommandRecord(command.result, "result", commandIndex);
          const update = setMatchResult(snapshot, matchId, result);
          return {
            state: update.tournament,
            updatedIds: [matchId, ...update.invalidatedMatchIds],
            warnings: update.invalidatedMatchIds.length
              ? [`Cleared ${update.invalidatedMatchIds.length} downstream result(s) because competitors changed.`]
              : [],
            value: { invalidatedMatchIds: update.invalidatedMatchIds },
          };
        },
      },
      {
        type: "match.result.clear",
        description: "Clear one result and any downstream results that no longer have valid competitors.",
        permissions: ["update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["matchId"],
          properties: { matchId: { type: "string" } },
          additionalProperties: false,
        },
        example: { type: "match.result.clear", matchId: "w-r1-m1" },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["matchId"], commandIndex);
          const matchId = requireCommandString(command.matchId, "matchId", commandIndex, { maximumLength: 160 });
          return {
            state: clearMatchResult(snapshot, matchId),
            updatedIds: [matchId],
          };
        },
      },
      {
        type: "match.update",
        description: "Update a match schedule, notes, or non-complete status.",
        permissions: ["update"],
        mutates: true,
        schema: {
          type: "object",
          required: ["matchId", "changes"],
          properties: { matchId: { type: "string" }, changes: { type: "object" } },
          additionalProperties: false,
        },
        example: { type: "match.update", matchId: "w-r1-m1", changes: { scheduledAt: "2026-08-02T18:00", notes: "Court 2" } },
        execute(snapshot, command, { commandIndex }) {
          rejectUnknownCommandFields(command, ["matchId", "changes"], commandIndex);
          const matchId = requireCommandString(command.matchId, "matchId", commandIndex, { maximumLength: 160 });
          const changes = requireCommandRecord(command.changes, "changes", commandIndex);
          return {
            state: updateMatchDetails(snapshot, matchId, changes),
            updatedIds: [matchId],
          };
        },
      },
    ],
  });
}

function bindEvents() {
  byId("bracket-setup-form").addEventListener("submit", createFromForm);
  byId("bracket-match-filter").addEventListener("change", renderMatches);
  byId("bracket-match-form").addEventListener("submit", saveMatch);
  byId("bracket-close-match").addEventListener("click", () => byId("bracket-match-dialog").close());
  byId("bracket-clear-result").addEventListener("click", clearCurrentMatch);
  byId("bracket-undo").addEventListener("click", undo);
  byId("bracket-duplicate").addEventListener("click", duplicateTournament);
  byId("bracket-open").addEventListener("click", () => byId("bracket-open-input").click());
  byId("bracket-open-input").addEventListener("change", openProject);
  byId("bracket-save-project").addEventListener("click", () => downloadJson(tournament, `${slug(tournament.name)}.vpbracket.json`));
  byId("bracket-create-playoff").addEventListener("click", createPlayoff);
  byId("bracket-print").addEventListener("click", () => window.print());
  byId("bracket-svg").addEventListener("click", () => downloadBlob(new Blob([currentSvg], { type: "image/svg+xml" }), `${slug(tournament.name)}.svg`));
  byId("bracket-png").addEventListener("click", exportPng);
  byId("bracket-csv").addEventListener("click", exportCsv);
  byId("bracket-static").addEventListener("click", exportStatic);
  const canvas = byId("bracket-canvas");
  canvas.addEventListener("pointerdown", startPan);
  canvas.addEventListener("pointermove", movePan);
  canvas.addEventListener("pointerup", endPan);
  canvas.addEventListener("pointercancel", endPan);
}

function createFromForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const participants = String(values.participants).split(/\r?\n/).map((line) => {
    const [name, rank] = line.split(",");
    return { id: createId("participant"), name: name.trim(), rank: Number(rank) || undefined };
  }).filter((participant) => participant.name);
  try {
    remember();
    tournament = createTournament({
      name: values.name,
      type: values.type,
      seeding: values.seeding,
      thirdPlace: form.elements.thirdPlace.checked,
      participants,
    });
    persist();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function persist() {
  await repository.put(tournament.id, tournament);
  saved = await repository.list();
  render();
}

function remember() {
  history.push(structuredClone(tournament));
  if (history.length > 80) history.shift();
  byId("bracket-undo").disabled = false;
}

function undo() {
  const previous = history.pop();
  if (!previous) return;
  tournament = previous;
  persist();
  byId("bracket-undo").disabled = history.length === 0;
}

function render() {
  currentSvg = renderBracketSvg(tournament);
  byId("bracket-canvas").innerHTML = currentSvg;
  byId("bracket-title").textContent = tournament.name;
  const champion = tournament.participants.find((participant) => participant.id === tournament.championId);
  byId("bracket-champion").textContent = champion ? `Champion: ${champion.name}` : "Tournament in progress";
  byId("bracket-status").textContent = `${labelType(tournament.type)} · ${tournament.participants.length} participants`;
  renderMatches();
  renderMobileList();
  renderStandings();
  renderSaved();
}

function renderMatches() {
  const filter = byId("bracket-match-filter").value;
  const list = byId("bracket-match-list");
  list.replaceChildren();
  tournament.matches
    .filter((match) => !filter || match.bracket === filter)
    .sort((a, b) => bracketOrder(a.bracket) - bracketOrder(b.bracket) || a.round - b.round || a.index - b.index)
    .forEach((match) => list.append(matchRow(match)));
}

function renderMobileList() {
  const list = byId("bracket-mobile-list");
  list.replaceChildren();
  tournament.matches.filter((match) => match.participantAId || match.participantBId).forEach((match) => list.append(matchRow(match)));
}

function matchRow(match) {
  const row = element("li", "suite-row");
  row.append(element("span", "suite-chip", `${match.bracket} R${match.round}`));
  const main = element("div", "suite-row-main");
  const left = participantName(match.participantAId) || sourceName(match.sourceA);
  const right = participantName(match.participantBId) || sourceName(match.sourceB);
  main.append(element("strong", "", `${left} ${displayScore(match.scoreA)} · ${displayScore(match.scoreB)} ${right}`));
  main.append(element("span", "", `${match.status}${match.scheduledAt ? ` · ${new Date(match.scheduledAt).toLocaleString()}` : ""}${match.notes ? ` · ${match.notes}` : ""}`));
  const button = element("button", "button button-quiet", "Edit");
  button.type = "button";
  button.disabled = !match.participantAId || !match.participantBId;
  button.addEventListener("click", () => openMatch(match));
  row.append(main, button);
  return row;
}

function openMatch(match) {
  const form = byId("bracket-match-form");
  form.elements.matchId.value = match.id;
  form.elements.scoreA.value = match.scoreA ?? "";
  form.elements.scoreB.value = match.scoreB ?? "";
  form.elements.scheduledAt.value = match.scheduledAt ? match.scheduledAt.slice(0, 16) : "";
  form.elements.notes.value = match.notes ?? "";
  form.elements.status.value = ["pending", "scheduled", "in-progress"].includes(match.status) ? match.status : "pending";
  const winner = byId("bracket-match-winner");
  winner.replaceChildren(Object.assign(element("option", "", "From score"), { value: "" }));
  [match.participantAId, match.participantBId].forEach((id) => winner.append(Object.assign(element("option", "", participantName(id)), { value: id })));
  winner.value = match.winnerId ?? "";
  byId("bracket-match-title").textContent = `${match.bracket} · Round ${match.round}`;
  byId("bracket-match-competitors").textContent = `${participantName(match.participantAId)} vs ${participantName(match.participantBId)}`;
  byId("bracket-match-dialog").showModal();
}

function saveMatch(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  try {
    remember();
    if (values.scoreA === "" || values.scoreB === "") {
      tournament = updateMatchDetails(tournament, values.matchId, values);
    } else {
      const result = setMatchResult(tournament, values.matchId, values);
      tournament = result.tournament;
      if (result.invalidatedMatchIds.length) {
        toast(`${result.invalidatedMatchIds.length} later result${result.invalidatedMatchIds.length === 1 ? " was" : "s were"} cleared because the competitors changed.`);
      }
    }
    byId("bracket-match-dialog").close();
    persist();
  } catch (error) {
    history.pop();
    toast(error.message, "error");
  }
}

function clearCurrentMatch() {
  const matchId = byId("bracket-match-form").elements.matchId.value;
  remember();
  try {
    tournament = clearMatchResult(tournament, matchId);
    byId("bracket-match-dialog").close();
    persist();
  } catch (error) {
    history.pop();
    toast(error.message, "error");
  }
}

function renderStandings() {
  byId("bracket-standings-rules").textContent = tournament.standingsRules;
  byId("bracket-create-playoff").disabled = tournament.type !== "round-robin";
  const body = byId("bracket-standings-body");
  body.replaceChildren();
  calculateStandings(tournament).forEach((row, index) => {
    const tr = element("tr");
    [index + 1, row.name, row.played, row.wins, row.draws, row.losses, row.scoreFor, row.scoreAgainst, row.difference, row.points]
      .forEach((value) => tr.append(element("td", "", String(value))));
    body.append(tr);
  });
}

function createPlayoff() {
  if (tournament.type !== "round-robin") return;
  remember();
  tournament = createRoundRobinPlayoff(tournament, 4);
  persist();
}

function duplicateTournament(source = tournament) {
  const copy = structuredClone(source);
  copy.id = createId("tournament");
  copy.name = `Copy of ${source.name}`;
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = copy.createdAt;
  tournament = copy;
  history = [];
  persist();
}

async function openProject(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  try {
    const imported = validateTournament(await readJsonFile(file));
    if (saved.some((candidate) => candidate.id === imported.id)) imported.id = createId("tournament");
    remember();
    tournament = imported;
    await persist();
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderSaved() {
  const list = byId("bracket-saved-list");
  list.replaceChildren();
  saved.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).forEach((candidate) => {
    const row = element("li", "suite-row");
    row.append(element("span", "suite-chip", labelType(candidate.type)));
    const main = element("div", "suite-row-main");
    main.append(element("strong", "", candidate.name), element("span", "", `${candidate.participants.length} participants · ${new Date(candidate.updatedAt).toLocaleString()}`));
    const actions = element("div", "suite-actions");
    actions.append(actionButton("Open", () => { remember(); tournament = validateTournament(candidate); render(); }));
    actions.append(actionButton("Duplicate", () => duplicateTournament(candidate)));
    actions.append(actionButton("Delete", async () => {
      if (!confirm(`Delete “${candidate.name}”?`)) return;
      await repository.delete(candidate.id);
      saved = await repository.list();
      renderSaved();
    }));
    row.append(main, actions);
    list.append(row);
  });
}

function exportCsv() {
  const rows = ["match_id,bracket,round,participant_a,score_a,score_b,participant_b,winner,status,scheduled_at,notes"];
  tournament.matches.forEach((match) => rows.push([
    match.id, match.bracket, match.round, participantName(match.participantAId), match.scoreA ?? "",
    match.scoreB ?? "", participantName(match.participantBId), participantName(match.winnerId),
    match.status, match.scheduledAt, match.notes,
  ].map(escapeCsv).join(",")));
  downloadBlob(new Blob([`${rows.join("\r\n")}\r\n`], { type: "text/csv" }), `${slug(tournament.name)}-results.csv`);
}

function exportStatic() {
  const champion = participantName(tournament.championId) || "Not yet decided";
  const rows = tournament.matches.filter((match) => match.status === "complete" && !match.automatic).map((match) => `<tr><td>${escapeHtml(match.bracket)} R${match.round}</td><td>${escapeHtml(participantName(match.participantAId))}</td><td>${escapeHtml(displayScore(match.scoreA))}–${escapeHtml(displayScore(match.scoreB))}</td><td>${escapeHtml(participantName(match.participantBId))}</td></tr>`).join("");
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(tournament.name)}</title><style>body{max-width:900px;margin:40px auto;padding:20px;font:16px/1.5 system-ui;color:#1b1a17;background:#f4f1e8}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #aaa;text-align:left}</style></head><body><h1>${escapeHtml(tournament.name)}</h1><p>${escapeHtml(labelType(tournament.type))} · Champion: <strong>${escapeHtml(champion)}</strong></p><table><thead><tr><th>Round</th><th>Participant</th><th>Score</th><th>Participant</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  downloadBlob(new Blob([html], { type: "text/html" }), `${slug(tournament.name)}-results.html`);
}

function exportPng() {
  const url = URL.createObjectURL(new Blob([currentSvg], { type: "image/svg+xml" }));
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    canvas.toBlob((blob) => {
      URL.revokeObjectURL(url);
      if (blob) downloadBlob(blob, `${slug(tournament.name)}.png`);
    });
  };
  image.src = url;
}

function startPan(event) {
  const canvas = byId("bracket-canvas");
  pan = { x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("is-panning");
}

function movePan(event) {
  if (!pan) return;
  const canvas = byId("bracket-canvas");
  canvas.scrollLeft = pan.left - (event.clientX - pan.x);
  canvas.scrollTop = pan.top - (event.clientY - pan.y);
}

function endPan() {
  pan = null;
  byId("bracket-canvas").classList.remove("is-panning");
}

function participantName(id) {
  return tournament.participants.find((participant) => participant.id === id)?.name ?? "";
}

function sourceName(source) {
  if (!source) return "Bye";
  if (source.type === "winner") return `Winner ${source.matchId}`;
  if (source.type === "loser") return `Loser ${source.matchId}`;
  if (source.type === "grand-final-reset") return "If reset required";
  return source.participantId ? "Participant" : "Bye";
}

function displayScore(value) {
  return value === null || value === undefined ? "—" : String(value);
}

function bracketOrder(value) {
  return ["winners", "losers", "final", "placement", "round-robin"].indexOf(value);
}

function labelType(value) {
  return ({"single":"Single elimination","double":"Double elimination","round-robin":"Round robin"}[value] ?? value);
}

function actionButton(label, callback) {
  const button = element("button", "button button-quiet", label);
  button.type = "button";
  button.addEventListener("click", callback);
  return button;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tournament";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[<>&"']/g, (character) => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[character]));
}

start();
