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

export function buildMatchSlate(primaryMatches: Match[], secondaryMatches: Match[]) {
  const seen = new Set<string>();
  const merged: Match[] = [];

  for (const match of [...primaryMatches, ...secondaryMatches]) {
    const key = `${match.homeTeam.toLowerCase()}-${match.awayTeam.toLowerCase()}-${match.startsAt.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(match);
  }

  return merged;
}

export function filterMatchesForDay(matches: Match[], day: string) {
  return matches.filter((match) => match.startsAt.slice(0, 10) === day);
}

export function calculateDailyStats(picks: Pick[], slipPickIds: string[], day: string) {
  const dayPicks = picks.filter((pick) => pick.createdAt.slice(0, 10) === day);
  const selectedDayPicks = dayPicks.filter((pick) => slipPickIds.includes(pick.id));
  const userIds = [...new Set(dayPicks.map((pick) => pick.userId))];

  return {
    total: summarizeDailyPicks(dayPicks, selectedDayPicks),
    byViewer: userIds
      .map((userId) => {
        const submittedByUser = dayPicks.filter((pick) => pick.userId === userId);
        const selectedByUser = selectedDayPicks.filter((pick) => pick.userId === userId);
        return {
          userId,
          ...summarizeDailyPicks(submittedByUser, selectedByUser)
        };
      })
      .sort((left, right) => right.profit - left.profit || right.selected - left.selected || right.submitted - left.submitted)
  };
}

export function buildProfitTimeline(picks: Pick[], slipPickIds: string[]) {
  let cumulative = 0;

  return picks
    .filter((pick) => slipPickIds.includes(pick.id) && pick.status !== "pending")
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .map((pick) => {
      cumulative = roundUnits(cumulative + pick.profit);
      return {
        label: new Date(pick.createdAt).toLocaleTimeString("pt-PT", {
          hour: "2-digit",
          minute: "2-digit"
        }),
        profit: pick.profit,
        cumulative
      };
    });
}

function summarizeDailyPicks(submittedPicks: Pick[], selectedPicks: Pick[]) {
  const settledSelected = selectedPicks.filter((pick) => pick.status !== "pending");
  const pendingSelected = selectedPicks.length - settledSelected.length;
  const profit = roundUnits(settledSelected.reduce((total, pick) => total + pick.profit, 0));
  const staked = roundUnits(settledSelected.reduce((total, pick) => total + pick.stake, 0));

  return {
    submitted: submittedPicks.length,
    selected: selectedPicks.length,
    settled: settledSelected.length,
    pendingSelected,
    staked,
    profit,
    roi: staked > 0 ? roundUnits((profit / staked) * 100) : 0
  };
}
