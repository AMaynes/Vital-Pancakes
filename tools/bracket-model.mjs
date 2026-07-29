/**
 * Pure tournament generation, routing, advancement, standings, validation,
 * and migration for Bracket Generator.
 */

export const BRACKET_FORMAT = "vital-pancakes-bracket";
export const BRACKET_VERSION = 1;
export const TOURNAMENT_TYPES = new Set(["single", "double", "round-robin"]);

export function createParticipants(entries) {
  if (!Array.isArray(entries) || entries.length < 2) throw new TypeError("Add at least two participants.");
  return entries.map((entry, index) => {
    const source = typeof entry === "string" ? { name: entry } : entry;
    const name = String(source.name ?? "").trim();
    if (!name) throw new TypeError(`Participant ${index + 1} needs a name.`);
    return {
      id: String(source.id || `participant-${index + 1}`),
      name,
      rank: Number.isFinite(Number(source.rank)) ? Number(source.rank) : index + 1,
      seed: index + 1,
      notes: String(source.notes ?? ""),
    };
  });
}

export function createTournament(options) {
  const type = options.type ?? "single";
  if (!TOURNAMENT_TYPES.has(type)) throw new TypeError(`Unsupported tournament type: ${type}.`);
  let participants = createParticipants(options.participants);
  participants = seedParticipants(participants, options.seeding ?? "manual", options.random);
  const base = {
    format: BRACKET_FORMAT,
    version: BRACKET_VERSION,
    id: String(options.id || `tournament-${Date.now()}`),
    name: String(options.name || "Untitled tournament"),
    type,
    participants,
    matches: [],
    thirdPlace: Boolean(options.thirdPlace),
    standingsRules: "Points, head-to-head points among tied teams, score difference, score for, wins, seed, stable participant ID.",
    championId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (type === "round-robin") base.matches = createRoundRobinMatches(participants);
  else base.matches = createEliminationMatches(participants, type, base.thirdPlace);
  return recomputeTournament(base).tournament;
}

export function setMatchResult(inputTournament, matchId, result) {
  const tournament = structuredCloneSafe(inputTournament);
  const match = tournament.matches.find((candidate) => candidate.id === matchId);
  if (!match) throw new TypeError("Match not found.");
  const beforeCompleted = new Map(tournament.matches.filter((candidate) => candidate.status === "complete").map((candidate) => [candidate.id, candidate.winnerId]));
  const initial = recomputeTournament(tournament).tournament;
  const current = initial.matches.find((candidate) => candidate.id === matchId);
  if (!current.participantAId || !current.participantBId) throw new TypeError("Both competitors must be known before recording a result.");
  const scoreA = Number(result.scoreA);
  const scoreB = Number(result.scoreB);
  if (!Number.isFinite(scoreA) || !Number.isFinite(scoreB)) throw new TypeError("Scores must be finite numbers.");
  if (initial.type !== "round-robin" && scoreA === scoreB && !result.winnerId) {
    throw new TypeError("Elimination matches cannot end tied.");
  }
  let winnerId = result.winnerId ?? null;
  if (!winnerId && scoreA !== scoreB) winnerId = scoreA > scoreB ? current.participantAId : current.participantBId;
  if (winnerId && ![current.participantAId, current.participantBId].includes(winnerId)) {
    throw new TypeError("Winner must be one of the match competitors.");
  }
  Object.assign(current, {
    scoreA,
    scoreB,
    winnerId,
    status: "complete",
    notes: String(result.notes ?? current.notes ?? ""),
    scheduledAt: result.scheduledAt ?? current.scheduledAt ?? "",
    completedAt: result.completedAt ?? new Date().toISOString(),
    automatic: false,
  });
  const recomputed = recomputeTournament(initial);
  const invalidatedMatchIds = recomputed.tournament.matches
    .filter((candidate) => beforeCompleted.has(candidate.id) && candidate.status !== "complete")
    .map((candidate) => candidate.id);
  return { tournament: recomputed.tournament, invalidatedMatchIds };
}

export function updateMatchDetails(inputTournament, matchId, details) {
  const tournament = structuredCloneSafe(inputTournament);
  const match = tournament.matches.find((candidate) => candidate.id === matchId);
  if (!match) throw new TypeError("Match not found.");
  match.notes = String(details.notes ?? match.notes ?? "");
  match.scheduledAt = String(details.scheduledAt ?? match.scheduledAt ?? "");
  if (details.status && ["pending", "scheduled", "in-progress"].includes(details.status) && match.status !== "complete") {
    match.status = details.status;
  }
  tournament.updatedAt = new Date().toISOString();
  return tournament;
}

export function clearMatchResult(inputTournament, matchId) {
  const tournament = structuredCloneSafe(inputTournament);
  const match = tournament.matches.find((candidate) => candidate.id === matchId);
  if (!match) throw new TypeError("Match not found.");
  clearResult(match);
  return recomputeTournament(tournament).tournament;
}

export function recomputeTournament(inputTournament) {
  const tournament = structuredCloneSafe(inputTournament);
  if (tournament.type === "round-robin") {
    tournament.championId = calculateStandings(tournament)[0]?.participantId ?? null;
    tournament.updatedAt = new Date().toISOString();
    return { tournament, invalidatedMatchIds: [] };
  }
  const byId = new Map(tournament.matches.map((match) => [match.id, match]));
  const invalidated = [];
  for (let pass = 0; pass < tournament.matches.length + 2; pass += 1) {
    let changed = false;
    tournament.matches.forEach((match) => {
      const left = resolveSource(match.sourceA, byId);
      const right = resolveSource(match.sourceB, byId);
      const nextA = left.resolved ? left.participantId : null;
      const nextB = right.resolved ? right.participantId : null;
      const competitorsChanged = match.participantAId !== nextA || match.participantBId !== nextB;
      if (competitorsChanged) {
        match.participantAId = nextA;
        match.participantBId = nextB;
        if (match.status === "complete" && !match.automatic) {
          invalidated.push(match.id);
          clearResult(match);
        }
        changed = true;
      }
      if (!left.resolved || !right.resolved) {
        if (match.status === "complete" && match.automatic) clearResult(match);
        if (match.status !== "complete") match.status = "waiting";
        return;
      }
      const participants = [nextA, nextB].filter(Boolean);
      if (participants.length <= 1) {
        const winnerId = participants[0] ?? null;
        if (match.status !== "complete" || match.winnerId !== winnerId || !match.automatic) changed = true;
        Object.assign(match, {
          scoreA: null,
          scoreB: null,
          winnerId,
          status: "complete",
          automatic: true,
          completedAt: null,
        });
      } else if (match.automatic) {
        clearResult(match);
        match.status = "pending";
        changed = true;
      } else if (match.status === "waiting") {
        match.status = "pending";
        changed = true;
      }
    });
    if (!changed) break;
  }
  tournament.championId = determineChampion(tournament);
  tournament.updatedAt = new Date().toISOString();
  return { tournament, invalidatedMatchIds: [...new Set(invalidated)] };
}

export function calculateStandings(tournament) {
  if (tournament.type !== "round-robin") return [];
  const rows = new Map(tournament.participants.map((participant) => [participant.id, {
    participantId: participant.id,
    name: participant.name,
    seed: participant.seed,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    scoreFor: 0,
    scoreAgainst: 0,
    difference: 0,
    points: 0,
    headToHead: 0,
  }]));
  const completed = tournament.matches.filter((match) => match.status === "complete" && match.participantAId && match.participantBId);
  completed.forEach((match) => {
    const left = rows.get(match.participantAId);
    const right = rows.get(match.participantBId);
    left.played += 1;
    right.played += 1;
    left.scoreFor += match.scoreA;
    left.scoreAgainst += match.scoreB;
    right.scoreFor += match.scoreB;
    right.scoreAgainst += match.scoreA;
    if (match.scoreA > match.scoreB) {
      left.wins += 1; left.points += 3; right.losses += 1;
    } else if (match.scoreB > match.scoreA) {
      right.wins += 1; right.points += 3; left.losses += 1;
    } else {
      left.draws += 1; right.draws += 1; left.points += 1; right.points += 1;
    }
  });
  rows.forEach((row) => { row.difference = row.scoreFor - row.scoreAgainst; });
  const pointGroups = new Map();
  rows.forEach((row) => {
    if (!pointGroups.has(row.points)) pointGroups.set(row.points, []);
    pointGroups.get(row.points).push(row.participantId);
  });
  pointGroups.forEach((ids) => {
    if (ids.length < 2) return;
    const idSet = new Set(ids);
    completed.filter((match) => idSet.has(match.participantAId) && idSet.has(match.participantBId)).forEach((match) => {
      const left = rows.get(match.participantAId);
      const right = rows.get(match.participantBId);
      if (match.scoreA > match.scoreB) left.headToHead += 3;
      else if (match.scoreB > match.scoreA) right.headToHead += 3;
      else { left.headToHead += 1; right.headToHead += 1; }
    });
  });
  return [...rows.values()].sort((a, b) => (
    b.points - a.points
    || b.headToHead - a.headToHead
    || b.difference - a.difference
    || b.scoreFor - a.scoreFor
    || b.wins - a.wins
    || a.seed - b.seed
    || a.participantId.localeCompare(b.participantId)
  ));
}

export function createRoundRobinPlayoff(tournament, participantCount = 4) {
  const standings = calculateStandings(tournament);
  const count = Math.max(2, Math.min(standings.length, previousPowerOfTwo(participantCount)));
  const participantIds = standings.slice(0, count).map((row) => row.participantId);
  const participants = participantIds.map((id) => tournament.participants.find((participant) => participant.id === id));
  return createTournament({
    name: `${tournament.name} Playoff`,
    type: "single",
    participants,
    seeding: "manual",
    thirdPlace: tournament.thirdPlace,
  });
}

export function validateTournament(value) {
  if (!value || value.format !== BRACKET_FORMAT) throw new TypeError("This is not a Bracket Generator project.");
  if (!Number.isInteger(value.version) || value.version < 1 || value.version > BRACKET_VERSION) {
    throw new TypeError(`Unsupported bracket version: ${value.version}.`);
  }
  if (!TOURNAMENT_TYPES.has(value.type)) throw new TypeError(`Unsupported tournament type: ${value.type}.`);
  if (!Array.isArray(value.participants) || value.participants.length < 2 || !Array.isArray(value.matches)) {
    throw new TypeError("Tournament participants or matches are missing.");
  }
  const participantIds = uniqueIds(value.participants, "participant");
  const matchIds = uniqueIds(value.matches, "match");
  value.matches.forEach((match) => {
    [match.participantAId, match.participantBId, match.winnerId].filter(Boolean).forEach((id) => {
      if (!participantIds.has(id)) throw new TypeError(`Match ${match.id} references an unknown participant.`);
    });
    [match.sourceA, match.sourceB].forEach((source) => {
      if (["winner", "loser", "grand-final-reset"].includes(source?.type) && source.matchId && !matchIds.has(source.matchId)) {
        throw new TypeError(`Match ${match.id} references an unknown source match.`);
      }
    });
  });
  const rounds = new Map();
  value.matches.filter((match) => match.status !== "complete" || match.participantAId || match.participantBId).forEach((match) => {
    const key = `${match.bracket}:${match.round}`;
    if (!rounds.has(key)) rounds.set(key, new Set());
    [match.participantAId, match.participantBId].filter(Boolean).forEach((id) => {
      if (rounds.get(key).has(id)) throw new TypeError(`Participant ${id} appears twice in ${key}.`);
      rounds.get(key).add(id);
    });
  });
  return recomputeTournament({ ...structuredCloneSafe(value), version: BRACKET_VERSION }).tournament;
}

function createEliminationMatches(participants, type, thirdPlace) {
  const size = nextPowerOfTwo(participants.length);
  const rounds = Math.log2(size);
  const order = seedOrder(size);
  const slots = order.map((seed) => participants.find((participant) => participant.seed === seed)?.id ?? null);
  const matches = [];
  const winnersRounds = [];
  for (let round = 1; round <= rounds; round += 1) {
    const count = size / 2 ** round;
    const roundMatches = [];
    for (let index = 0; index < count; index += 1) {
      const id = `wb-r${round}-m${index + 1}`;
      const sourceA = round === 1
        ? { type: "participant", participantId: slots[index * 2] }
        : { type: "winner", matchId: winnersRounds[round - 2][index * 2].id };
      const sourceB = round === 1
        ? { type: "participant", participantId: slots[index * 2 + 1] }
        : { type: "winner", matchId: winnersRounds[round - 2][index * 2 + 1].id };
      const match = createMatch(id, "winners", round, index, sourceA, sourceB);
      matches.push(match);
      roundMatches.push(match);
    }
    winnersRounds.push(roundMatches);
  }
  if (thirdPlace && rounds >= 2) {
    const semifinals = winnersRounds[rounds - 2];
    matches.push(createMatch("third-place", "placement", 1, 0,
      { type: "loser", matchId: semifinals[0].id },
      { type: "loser", matchId: semifinals[1].id }));
  }
  if (type === "single") return matches;

  const losersRounds = [];
  const firstLosers = [];
  for (let index = 0; index < winnersRounds[0].length / 2; index += 1) {
    const match = createMatch(`lb-r1-m${index + 1}`, "losers", 1, index,
      { type: "loser", matchId: winnersRounds[0][index * 2].id },
      { type: "loser", matchId: winnersRounds[0][index * 2 + 1].id });
    matches.push(match);
    firstLosers.push(match);
  }
  losersRounds.push(firstLosers);

  for (let winnersRound = 2; winnersRound <= rounds; winnersRound += 1) {
    const previous = losersRounds.at(-1);
    const dropRoundNumber = 2 * winnersRound - 2;
    const dropMatches = [];
    winnersRounds[winnersRound - 1].forEach((winnersMatch, index) => {
      const match = createMatch(`lb-r${dropRoundNumber}-m${index + 1}`, "losers", dropRoundNumber, index,
        { type: "winner", matchId: previous[index].id },
        { type: "loser", matchId: winnersMatch.id });
      matches.push(match);
      dropMatches.push(match);
    });
    losersRounds.push(dropMatches);
    if (winnersRound < rounds) {
      const consolidationRoundNumber = dropRoundNumber + 1;
      const consolidationMatches = [];
      for (let index = 0; index < dropMatches.length / 2; index += 1) {
        const match = createMatch(`lb-r${consolidationRoundNumber}-m${index + 1}`, "losers", consolidationRoundNumber, index,
          { type: "winner", matchId: dropMatches[index * 2].id },
          { type: "winner", matchId: dropMatches[index * 2 + 1].id });
        matches.push(match);
        consolidationMatches.push(match);
      }
      losersRounds.push(consolidationMatches);
    }
  }
  const winnersFinal = winnersRounds.at(-1)[0];
  const losersFinal = losersRounds.at(-1)[0];
  matches.push(createMatch("grand-final", "final", 1, 0,
    { type: "winner", matchId: winnersFinal.id },
    { type: "winner", matchId: losersFinal.id }));
  matches.push(createMatch("grand-final-reset", "final", 2, 0,
    { type: "grand-final-reset", matchId: "grand-final", side: "a" },
    { type: "grand-final-reset", matchId: "grand-final", side: "b" }));
  return matches;
}

function createRoundRobinMatches(participants) {
  const rotating = [...participants.map((participant) => participant.id)];
  if (rotating.length % 2) rotating.push(null);
  const rounds = rotating.length - 1;
  const matches = [];
  for (let round = 0; round < rounds; round += 1) {
    for (let index = 0; index < rotating.length / 2; index += 1) {
      const left = rotating[index];
      const right = rotating[rotating.length - 1 - index];
      if (left && right) {
        matches.push(createMatch(`rr-r${round + 1}-m${index + 1}`, "round-robin", round + 1, index,
          { type: "participant", participantId: round % 2 && index === 0 ? right : left },
          { type: "participant", participantId: round % 2 && index === 0 ? left : right }));
      }
    }
    rotating.splice(1, 0, rotating.pop());
  }
  return matches.map((match) => ({
    ...match,
    participantAId: match.sourceA.participantId,
    participantBId: match.sourceB.participantId,
    status: "pending",
  }));
}

function createMatch(id, bracket, round, index, sourceA, sourceB) {
  return {
    id,
    bracket,
    round,
    index,
    sourceA,
    sourceB,
    participantAId: null,
    participantBId: null,
    scoreA: null,
    scoreB: null,
    winnerId: null,
    status: "waiting",
    scheduledAt: "",
    notes: "",
    automatic: false,
    completedAt: null,
  };
}

function resolveSource(source, byId) {
  if (!source) return { resolved: true, participantId: null };
  if (source.type === "participant") return { resolved: true, participantId: source.participantId ?? null };
  const sourceMatch = byId.get(source.matchId);
  if (!sourceMatch || sourceMatch.status !== "complete") return { resolved: false, participantId: null };
  if (source.type === "winner") return { resolved: true, participantId: sourceMatch.winnerId };
  if (source.type === "loser") {
    if (!sourceMatch.participantAId || !sourceMatch.participantBId) return { resolved: true, participantId: null };
    return {
      resolved: true,
      participantId: sourceMatch.winnerId === sourceMatch.participantAId ? sourceMatch.participantBId : sourceMatch.participantAId,
    };
  }
  if (source.type === "grand-final-reset") {
    if (!sourceMatch.participantAId || !sourceMatch.participantBId || sourceMatch.winnerId !== sourceMatch.participantBId) {
      return { resolved: false, participantId: null };
    }
    return {
      resolved: true,
      participantId: source.side === "a" ? sourceMatch.participantAId : sourceMatch.participantBId,
    };
  }
  return { resolved: false, participantId: null };
}

function determineChampion(tournament) {
  if (tournament.type === "single") return tournament.matches.find((match) => match.bracket === "winners" && match.round === Math.max(...tournament.matches.filter((candidate) => candidate.bracket === "winners").map((candidate) => candidate.round)))?.winnerId ?? null;
  const grandFinal = tournament.matches.find((match) => match.id === "grand-final");
  const reset = tournament.matches.find((match) => match.id === "grand-final-reset");
  if (!grandFinal || grandFinal.status !== "complete") return null;
  if (grandFinal.winnerId === grandFinal.participantAId) return grandFinal.winnerId;
  return reset?.status === "complete" ? reset.winnerId : null;
}

function seedParticipants(participants, method, random = Math.random) {
  let ordered = [...participants];
  if (method === "ranked") ordered.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  if (method === "random") {
    for (let index = ordered.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [ordered[index], ordered[swap]] = [ordered[swap], ordered[index]];
    }
  }
  return ordered.map((participant, index) => ({ ...participant, seed: index + 1 }));
}

function seedOrder(size) {
  let order = [1, 2];
  for (let current = 4; current <= size; current *= 2) order = order.flatMap((seed) => [seed, current + 1 - seed]);
  return size === 1 ? [1] : order;
}

function clearResult(match) {
  match.scoreA = null;
  match.scoreB = null;
  match.winnerId = null;
  match.status = "pending";
  match.automatic = false;
  match.completedAt = null;
}

function uniqueIds(records, label) {
  const ids = new Set();
  records.forEach((record) => {
    if (!record?.id || typeof record.id !== "string") throw new TypeError(`Every ${label} needs an id.`);
    if (ids.has(record.id)) throw new TypeError(`Duplicate ${label} id: ${record.id}.`);
    ids.add(record.id);
  });
  return ids;
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(Math.max(2, value)));
}

function previousPowerOfTwo(value) {
  return 2 ** Math.floor(Math.log2(Math.max(2, value)));
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
