/**
 * Produces crisp, pannable SVG tournament diagrams without editor state.
 */

export function renderBracketSvg(tournament, options = {}) {
  const participants = new Map(tournament.participants.map((participant) => [participant.id, participant]));
  const groups = groupRounds(tournament.matches);
  const boxWidth = 190;
  const boxHeight = 72;
  const columnGap = 78;
  const bandGap = 90;
  const padding = 36;
  let yOffset = padding + 34;
  let maximumWidth = 0;
  const markup = [];

  groups.forEach((group) => {
    const rounds = [...group.rounds.entries()].sort((a, b) => a[0] - b[0]);
    const maximumMatches = Math.max(...rounds.map(([, matches]) => matches.length), 1);
    const rowGap = 24;
    const bandHeight = maximumMatches * (boxHeight + rowGap);
    markup.push(`<text x="${padding}" y="${yOffset - 12}" class="band-title">${escapeXml(group.label)}</text>`);
    const positions = new Map();
    rounds.forEach(([round, matches], roundIndex) => {
      const columnX = padding + roundIndex * (boxWidth + columnGap);
      maximumWidth = Math.max(maximumWidth, columnX + boxWidth + padding);
      const spacing = bandHeight / Math.max(1, matches.length);
      matches.forEach((match, index) => {
        const y = yOffset + spacing * index + (spacing - boxHeight) / 2;
        positions.set(match.id, { x: columnX, y, roundIndex });
      });
    });
    rounds.forEach(([, matches]) => {
      matches.forEach((match) => {
        const position = positions.get(match.id);
        [match.sourceA, match.sourceB].forEach((source) => {
          const sourcePosition = source?.matchId ? positions.get(source.matchId) : null;
          if (!sourcePosition || sourcePosition.roundIndex >= position.roundIndex) return;
          const startX = sourcePosition.x + boxWidth;
          const startY = sourcePosition.y + boxHeight / 2;
          const endX = position.x;
          const endY = position.y + boxHeight / 2;
          const middle = (startX + endX) / 2;
          markup.push(`<path d="M${startX} ${startY} H${middle} V${endY} H${endX}" class="connector"/>`);
        });
      });
    });
    rounds.forEach(([round, matches], roundIndex) => {
      const x = padding + roundIndex * (boxWidth + columnGap);
      markup.push(`<text x="${x}" y="${yOffset + 2}" class="round-label">Round ${round}</text>`);
      matches.forEach((match) => markup.push(renderMatch(match, positions.get(match.id), participants, boxWidth, boxHeight)));
    });
    yOffset += bandHeight + bandGap;
  });

  const width = Math.max(680, maximumWidth);
  const height = Math.max(420, yOffset - bandGap + padding);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="bracket-title bracket-desc">`
    + `<title id="bracket-title">${escapeXml(tournament.name)}</title><desc id="bracket-desc">${escapeXml(`${tournament.type} tournament bracket with ${tournament.participants.length} participants.`)}</desc>`
    + `<style>text{font-family:ui-sans-serif,system-ui,sans-serif;fill:#2b2924}.title{font:700 24px Georgia,serif}.band-title{font:700 17px Georgia,serif}.round-label{font-size:10px;font-weight:800;text-transform:uppercase}.match{fill:#fffdf8;stroke:#9d9689}.match.complete{stroke:#2d5d4d;stroke-width:2}.match.waiting{fill:#efebe2}.participant{font-size:11px;font-weight:700}.score{font-size:13px;font-weight:800}.meta{font-size:9px;fill:#736e65}.winner{fill:#7b211a}.connector{fill:none;stroke:#aaa397;stroke-width:1.3}</style>`
    + `<rect width="${width}" height="${height}" fill="${escapeXml(options.background || "#F4F1E8")}"/>`
    + `<text x="${padding}" y="30" class="title">${escapeXml(tournament.name)}</text>`
    + markup.join("")
    + "</svg>";
}

function renderMatch(match, position, participants, width, height) {
  const left = participants.get(match.participantAId);
  const right = participants.get(match.participantBId);
  const winnerA = match.winnerId && match.winnerId === match.participantAId;
  const winnerB = match.winnerId && match.winnerId === match.participantBId;
  const labelA = left?.name ?? sourceLabel(match.sourceA);
  const labelB = right?.name ?? sourceLabel(match.sourceB);
  const scoreA = match.scoreA === null || match.scoreA === undefined ? "—" : match.scoreA;
  const scoreB = match.scoreB === null || match.scoreB === undefined ? "—" : match.scoreB;
  return `<g data-match-id="${escapeXml(match.id)}">`
    + `<rect class="match ${escapeXml(match.status)}" x="${position.x}" y="${position.y}" width="${width}" height="${height}" rx="4"/>`
    + `<line x1="${position.x}" y1="${position.y + height / 2}" x2="${position.x + width}" y2="${position.y + height / 2}" stroke="#d5cec1"/>`
    + `<text class="participant ${winnerA ? "winner" : ""}" x="${position.x + 10}" y="${position.y + 23}">${escapeXml(shortLabel(labelA))}</text>`
    + `<text class="score ${winnerA ? "winner" : ""}" x="${position.x + width - 12}" y="${position.y + 23}" text-anchor="end">${escapeXml(scoreA)}</text>`
    + `<text class="participant ${winnerB ? "winner" : ""}" x="${position.x + 10}" y="${position.y + 58}">${escapeXml(shortLabel(labelB))}</text>`
    + `<text class="score ${winnerB ? "winner" : ""}" x="${position.x + width - 12}" y="${position.y + 58}" text-anchor="end">${escapeXml(scoreB)}</text>`
    + `<title>${escapeXml(`${match.id} · ${match.status}`)}</title></g>`;
}

function groupRounds(matches) {
  const order = ["winners", "losers", "final", "placement", "round-robin"];
  const labels = {
    winners: "Winners bracket",
    losers: "Losers bracket",
    final: "Grand final",
    placement: "Placement",
    "round-robin": "Round robin schedule",
  };
  return order
    .map((bracket) => {
      const selected = matches.filter((match) => match.bracket === bracket);
      const rounds = new Map();
      selected.forEach((match) => {
        if (!rounds.has(match.round)) rounds.set(match.round, []);
        rounds.get(match.round).push(match);
      });
      rounds.forEach((roundMatches) => roundMatches.sort((a, b) => a.index - b.index));
      return { bracket, label: labels[bracket], rounds };
    })
    .filter((group) => group.rounds.size);
}

function sourceLabel(source) {
  if (!source) return "Bye";
  if (source.type === "participant") return source.participantId ? "Participant" : "Bye";
  if (source.type === "winner") return `Winner ${source.matchId}`;
  if (source.type === "loser") return `Loser ${source.matchId}`;
  if (source.type === "grand-final-reset") return "If reset required";
  return "Waiting";
}

function shortLabel(value) {
  const text = String(value ?? "");
  return text.length > 23 ? `${text.slice(0, 21)}…` : text;
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  })[character]);
}
