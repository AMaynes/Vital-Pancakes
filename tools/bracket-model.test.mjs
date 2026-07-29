import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateStandings,
  clearMatchResult,
  createRoundRobinPlayoff,
  createTournament,
  setMatchResult,
  validateTournament,
} from "./bracket-model.mjs";

const names = (count) => Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}`, rank: index + 1 }));

function play(tournament, matchId, scoreA = 1, scoreB = 0) {
  return setMatchResult(tournament, matchId, { scoreA, scoreB }).tournament;
}

test("single elimination seeds byes and automatically advances them", () => {
  const tournament = createTournament({ name: "Six", type: "single", participants: names(6), seeding: "ranked" });
  const firstRound = tournament.matches.filter((match) => match.bracket === "winners" && match.round === 1);
  assert.equal(firstRound.length, 4);
  assert.equal(firstRound.filter((match) => match.automatic && match.winnerId).length, 2);
});

test("advancement and earlier result changes invalidate dependent matches", () => {
  let tournament = createTournament({ name: "Four", type: "single", participants: names(4) });
  tournament = play(tournament, "wb-r1-m1");
  tournament = play(tournament, "wb-r1-m2");
  tournament = play(tournament, "wb-r2-m1");
  const changed = setMatchResult(tournament, "wb-r1-m1", { scoreA: 0, scoreB: 1 });
  assert.ok(changed.invalidatedMatchIds.includes("wb-r2-m1"));
  assert.equal(changed.tournament.matches.find((match) => match.id === "wb-r2-m1").status, "pending");
});

test("clearing an incorrect result rolls advancement back", () => {
  let tournament = createTournament({ name: "Four", type: "single", participants: names(4) });
  tournament = play(tournament, "wb-r1-m1");
  tournament = clearMatchResult(tournament, "wb-r1-m1");
  assert.equal(tournament.matches.find((match) => match.id === "wb-r2-m1").participantAId, null);
});

test("double elimination routes losers and activates a final reset when needed", () => {
  let tournament = createTournament({ name: "Four", type: "double", participants: names(4) });
  tournament = play(tournament, "wb-r1-m1");
  tournament = play(tournament, "wb-r1-m2");
  tournament = play(tournament, "lb-r1-m1");
  tournament = play(tournament, "wb-r2-m1");
  tournament = play(tournament, "lb-r2-m1");
  const grandFinal = tournament.matches.find((match) => match.id === "grand-final");
  assert.ok(grandFinal.participantAId && grandFinal.participantBId);
  tournament = setMatchResult(tournament, "grand-final", { scoreA: 0, scoreB: 1 }).tournament;
  const reset = tournament.matches.find((match) => match.id === "grand-final-reset");
  assert.ok(reset.participantAId && reset.participantBId);
  assert.equal(tournament.championId, null);
  tournament = play(tournament, "grand-final-reset");
  assert.ok(tournament.championId);
});

test("round robin standings use deterministic tiebreaks and can seed a playoff", () => {
  let tournament = createTournament({ name: "League", type: "round-robin", participants: names(4) });
  for (const match of tournament.matches) tournament = play(tournament, match.id, 1, 1);
  const standings = calculateStandings(tournament);
  assert.deepEqual(standings.map((row) => row.participantId), ["p1", "p2", "p3", "p4"]);
  const playoff = createRoundRobinPlayoff(tournament, 4);
  assert.equal(playoff.type, "single");
  assert.equal(playoff.participants.length, 4);
});

test("project validation rejects duplicate IDs and impossible round states", () => {
  const tournament = createTournament({ name: "Four", type: "single", participants: names(4) });
  assert.equal(validateTournament(tournament).version, 1);
  const corrupted = structuredClone(tournament);
  corrupted.participants[1].id = corrupted.participants[0].id;
  assert.throws(() => validateTournament(corrupted), /Duplicate participant/);
  const impossible = structuredClone(tournament);
  impossible.matches[0].participantAId = "p1";
  impossible.matches[0].participantBId = "p2";
  impossible.matches[1].participantAId = "p1";
  assert.throws(() => validateTournament(impossible), /appears twice/);
});
