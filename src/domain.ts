import type { Match, Pick, PickStatus, Vote, VoteType } from "./types";

export function scorePick(pickId: string, votes: Vote[]) {
  return votes
    .filter((voteItem) => voteItem.pickId === pickId)
    .reduce((total, voteItem) => total + voteWeight(voteItem.type), 0);
}

function voteWeight(type: VoteType) {
  if (type === "trust") return 1;
  if (type === "strong") return 2;
  return -1;
}

export function calculateProfit(status: PickStatus, stake: number, odds: number) {
  if (status === "won") return roundUnits(stake * (odds - 1));
  if (status === "lost") return -stake;
  if (status === "void" || status === "pending") return 0;
  if (status === "half_won") return roundUnits((stake * (odds - 1)) / 2);
  return roundUnits(-stake / 2);
}

export function selectSlipPicks(picks: Pick[], votes: Vote[], limit: number) {
  return [...picks]
    .filter((pick) => pick.status === "pending")
    .sort((left, right) => {
      const scoreDelta = scorePick(right.id, votes) - scorePick(left.id, votes);
      if (scoreDelta !== 0) return scoreDelta;
      return right.odds - left.odds;
    })
    .slice(0, limit);
}

export function calculateBankroll(initial: number, picks: Pick[], slipPickIds: string[]) {
  const slipPicks = picks.filter((pick) => slipPickIds.includes(pick.id));
  const settledPicks = slipPicks.filter((pick) => pick.status !== "pending");
  const pendingPicks = slipPicks.filter((pick) => pick.status === "pending");
  const settledProfit = roundUnits(settledPicks.reduce((total, pick) => total + pick.profit, 0));
  const exposure = roundUnits(pendingPicks.reduce((total, pick) => total + pick.stake, 0));
  const settledStake = settledPicks.reduce((total, pick) => total + pick.stake, 0);

  return {
    initial,
    current: roundUnits(initial + settledProfit),
    exposure,
    settledProfit,
    roi: settledStake > 0 ? roundUnits((settledProfit / settledStake) * 100) : 0
  };
}

export function roundUnits(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildMatchSlate(apiMatches: Match[], demoMatches: Match[], targetCount: number) {
  const seen = new Set<string>();
  const merged: Match[] = [];

  for (const match of [...apiMatches, ...demoMatches]) {
    const key = `${match.homeTeam.toLowerCase()}-${match.awayTeam.toLowerCase()}-${match.startsAt.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(match);
    if (merged.length >= targetCount) break;
  }

  return merged;
}

export function filterMatchesForDay(matches: Match[], day: string) {
  return matches.filter((match) => match.startsAt.slice(0, 10) === day);
}
