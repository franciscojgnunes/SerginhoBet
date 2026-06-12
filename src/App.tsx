import {
  Activity,
  Camera,
  CalendarDays,
  CheckCircle2,
  Flame,
  Gauge,
  LineChart,
  LogIn,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  UserRound,
  Vote
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { users } from "./data";
import {
  buildMatchSlate,
  calculateBankroll,
  calculateDailyStats,
  calculateProfit,
  cleanCompetitionName,
  filterUpcomingScheduledMatches,
  getLocalDateKey,
  roundUnits,
  scorePick,
  selectSlipPicks
} from "./domain";
import { fetchMatchesForDates } from "./sportsApi";
import { fetchTodayOdds } from "./oddsApi";
import { getSiteUrl, isSupabaseConfigured, supabase } from "./supabaseClient";
import { deletePick, ensureLeagueMember, loadRemoteState, saveMatches, saveOdds, savePick, saveProfile, saveSettlement, saveSlip, saveVote, updatePickOdds, updatePickSettlement, updatePickStake, updateProfileAvatar } from "./supabaseData";
import type { DailySlip, League, MarketType, Match, MatchOdd, Pick, PickStatus, SlipHistoryItem, User, Vote as VoteRecord, VoteType } from "./types";

const currentDate = new Date();
const tipDay = getLocalDateKey(currentDate);
const tomorrowDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000);
const tomorrowDay = getLocalDateKey(tomorrowDate);
const communityInitialBankroll = 10;
const fixedViewerStake = 1;
const communityRetentionDays = 3;
const statsResetAt = "2026-06-11T15:45:00.000Z";
const hasApiFootballKey = Boolean(import.meta.env.VITE_API_FOOTBALL_KEY);
const matchDates = [tipDay, tomorrowDay];
const communityDayKeys = Array.from({ length: communityRetentionDays + 1 }, (_, index) => {
  const date = new Date(currentDate.getTime() + (1 - index) * 24 * 60 * 60 * 1000);
  return getLocalDateKey(date);
});
const statsDayKeys = buildDateKeysBetween(new Date(statsResetAt), tomorrowDate);
const cacheNamespace = "serginhobet:clean-20260611";
const matchesCacheKey = `${cacheNamespace}:matches:${tipDay}:${tomorrowDay}:${hasApiFootballKey ? "api-football-only-v9-worldcup" : "api-football-server-v9-worldcup"}`;
const picksCacheKey = `${cacheNamespace}:picks:${tipDay}`;
const votesCacheKey = `${cacheNamespace}:votes:${tipDay}`;
const oddsCacheKey = `${cacheNamespace}:odds:${tipDay}:${tomorrowDay}:average-markets-v5-filtered-espn-worldcup`;
const slipCacheKey = `${cacheNamespace}:slip:${tipDay}`;
const slipHistoryCacheKey = `${cacheNamespace}:slip-history:${tipDay}`;
const defaultLeagueCode = "SERGINHO";
const fallbackUser: User = { id: "unknown-user", displayName: "Utilizador", role: "viewer", avatarColor: "#16d782" };
const manualSelectionValue = "__manual_selection__";
const manualOverrideBookmaker = "Manual Override";

const marketOptions: MarketType[] = [
  "1X2",
  "Dupla chance",
  "Over/Under",
  "Ambas marcam",
  "Handicap",
  "Intervalo",
  "Golos ao intervalo",
  "Resultado correto",
  "Intervalo/Final",
  "Marcador",
  "Cartoes",
  "Cantos",
  "Outro"
];

const marketPlaceholders: Record<MarketType, string> = {
  "1X2": "Casa vence / Empate / Fora vence",
  "Dupla chance": "Casa ou empate",
  "Over/Under": "Mais de 2.5 golos",
  "Ambas marcam": "Ambas marcam: Sim",
  Handicap: "Casa -1.0",
  Intervalo: "Casa vence / Empate / Fora vence",
  "Golos ao intervalo": "Mais de 0.5 golos ao intervalo",
  "Resultado correto": "2-1",
  "Intervalo/Final": "Empate / Casa",
  Marcador: "Jogador marca a qualquer momento",
  Cartoes: "Mais de 4.5 cartoes",
  Cantos: "Mais de 8.5 cantos",
  Outro: "Escreve o mercado"
};

const defaultSelectionsByMarket: Partial<Record<MarketType, string[]>> = {
  "1X2": ["Casa vence", "Empate", "Fora vence"],
  "Dupla chance": ["Casa ou empate", "Casa ou fora", "Empate ou fora"],
  "Over/Under": ["Mais de 0.5 golos", "Mais de 1.5 golos", "Mais de 2.5 golos", "Mais de 3.5 golos", "Menos de 0.5 golos", "Menos de 1.5 golos", "Menos de 2.5 golos", "Menos de 3.5 golos"],
  "Ambas marcam": ["Ambas marcam: Sim", "Ambas marcam: Não"],
  Handicap: ["Casa -1.0", "Casa +1.0", "Fora -1.0", "Fora +1.0"],
  Intervalo: ["Casa vence", "Empate", "Fora vence"],
  "Golos ao intervalo": ["Mais de 0.5 golos ao intervalo", "Mais de 1.5 golos ao intervalo", "Mais de 2.5 golos ao intervalo", "Menos de 0.5 golos ao intervalo", "Menos de 1.5 golos ao intervalo", "Menos de 2.5 golos ao intervalo"],
  "Resultado correto": ["1-0", "2-0", "2-1", "0-0", "1-1", "0-1", "0-2", "1-2"],
  "Intervalo/Final": ["Casa/Casa", "Empate/Casa", "Empate/Empate", "Empate/Fora", "Fora/Fora"],
  Cartoes: ["Mais de 3.5 cartões", "Mais de 4.5 cartões", "Mais de 5.5 cartões", "Menos de 4.5 cartões", "Menos de 5.5 cartões"],
  Cantos: ["Mais de 8.5 cantos", "Mais de 9.5 cantos", "Mais de 10.5 cantos", "Menos de 9.5 cantos", "Menos de 10.5 cantos"]
};

const strictOddsSelectionsByMarket: Partial<Record<MarketType, Set<string>>> = {
  "1X2": new Set(["Casa vence", "Empate", "Fora vence"]),
  "Dupla chance": new Set(["Casa ou empate", "Casa ou fora", "Empate ou fora"]),
  "Ambas marcam": new Set(["Ambas marcam: Sim", "Ambas marcam: Nao", "Ambas marcam: N\u00e3o"]),
  Intervalo: new Set(["Casa vence", "Empate", "Fora vence"])
};

const oddsSelectionOrderByMarket: Partial<Record<MarketType, string[]>> = {
  "1X2": ["Casa vence", "Empate", "Fora vence"],
  "Dupla chance": ["Casa ou empate", "Casa ou fora", "Empate ou fora"],
  "Ambas marcam": ["Ambas marcam: Sim", "Ambas marcam: Nao", "Ambas marcam: N\u00e3o"],
  Intervalo: ["Casa vence", "Empate", "Fora vence"]
};

function isOddsSelectionAllowed(marketType: MarketType, selection: string) {
  const strictSelections = strictOddsSelectionsByMarket[marketType];
  if (strictSelections) return strictSelections.has(selection);
  if (marketType === "Handicap") return /^(Casa|Fora) [+-]\d+(?:\.\d+)?$/.test(selection);
  if (marketType === "Over/Under") return /^(Mais|Menos) de \d+(?:\.\d+)? golos$/.test(selection);
  if (marketType === "Golos ao intervalo") return /^(Mais|Menos) de \d+(?:\.\d+)? golos ao intervalo$/.test(selection);
  if (marketType === "Resultado correto") return /^\d+-\d+$/.test(selection);
  if (marketType === "Intervalo/Final") return /^(Casa|Empate|Fora)\/(Casa|Empate|Fora)$/.test(selection);
  return true;
}

function compareOddsSelection(marketType: MarketType, left: MatchOdd, right: MatchOdd) {
  const order = oddsSelectionOrderByMarket[marketType];
  if (order) {
    const leftIndex = order.indexOf(left.selection);
    const rightIndex = order.indexOf(right.selection);
    if (leftIndex !== rightIndex) return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
  }
  return left.selection.localeCompare(right.selection, "pt");
}

function getAvailableOddsForMarket(matchOdds: MatchOdd[] | undefined, marketType: MarketType) {
  const uniqueOdds = new Map<string, MatchOdd>();
  for (const odd of matchOdds ?? []) {
    if (odd.marketType !== marketType) continue;
    if (!isOddsSelectionAllowed(marketType, odd.selection)) continue;
    const existing = uniqueOdds.get(odd.selection);
    if (!existing || odd.odds > existing.odds) uniqueOdds.set(odd.selection, odd);
  }
  return Array.from(uniqueOdds.values()).sort((left, right) => compareOddsSelection(marketType, left, right));
}

function findAvailableOdd(matchOdds: MatchOdd[] | undefined, marketType: MarketType, selection: string) {
  return getAvailableOddsForMarket(matchOdds, marketType).find((odd) => odd.selection === selection);
}

type Page = "games" | "community" | "viewer" | "resolve" | "history" | "stats" | "profile" | "admin";
type StatsScope = ReturnType<typeof buildStatsScope>;
type SyncStatus = "idle" | "loading" | "ready" | "saving" | "error";
type PickGroupSortMode = "recent" | "score";
type ChartPoint = {
  label: string;
  profit: number;
  stake: number;
  cumulative: number;
  cumulativeStake: number;
  roi: number;
};
type PickGroup = {
  key: string;
  picks: Pick[];
  representative: Pick;
  score: number;
  authors: User[];
};

function pickGroupKey(pick: Pick) {
  return [
    pick.matchId,
    pick.marketType,
    pick.selection.trim().toLowerCase(),
    pick.odds.toFixed(2)
  ].join("|");
}

function sortPickGroups(groups: PickGroup[], mode: PickGroupSortMode) {
  return [...groups].sort((left, right) => {
    if (mode === "score") {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      const countDelta = right.picks.length - left.picks.length;
      if (countDelta !== 0) return countDelta;
    }
    return new Date(right.representative.createdAt).getTime() - new Date(left.representative.createdAt).getTime();
  });
}

function buildPickGroups(picks: Pick[], votes: VoteRecord[], sortMode: PickGroupSortMode = "score") {
  const grouped = new Map<string, Pick[]>();
  for (const pick of picks) {
    const key = pickGroupKey(pick);
    grouped.set(key, [...(grouped.get(key) ?? []), pick]);
  }

  const groups = Array.from(grouped.entries()).map(([key, groupPicks]) => {
    const orderedPicks = [...groupPicks].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
    return {
      key,
      picks: orderedPicks,
      representative: orderedPicks[0],
      score: orderedPicks.reduce((total, pick) => total + scorePick(pick.id, votes), 0),
      authors: Array.from(new Set(orderedPicks.map((pick) => pick.userId))).map(userById)
    };
  });
  return sortPickGroups(groups, sortMode);
}

let runtimeUsers: User[] = [...users];

function setRuntimeUsers(nextUsers: User[]) {
  runtimeUsers = nextUsers.length > 0 ? nextUsers : [...users];
}

function createDefaultDailySlip(): DailySlip {
  return {
    status: "draft",
    mode: "combined",
    combinedStake: 1,
    multiplesStake: 1,
    settlementStatus: "pending",
    profit: 0,
    pickIds: [],
    generatedAt: currentDate.toISOString()
  };
}

function readStoredValue<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored);
    if (typeof fallback !== "object" || fallback === null) return parsed;
    return Array.isArray(fallback) ? parsed : { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function writeStoredValue<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local cache is a convenience; the app keeps working if storage is blocked.
  }
}

function isAfterStatsReset(value?: string) {
  if (!value) return false;
  return new Date(value).getTime() >= new Date(statsResetAt).getTime();
}

function clearLegacyStatsCache() {
  try {
    const clearMarker = `${cacheNamespace}:legacy-cleared`;
    if (localStorage.getItem(clearMarker)) return;
    const legacyPrefixes = [
      "pickroom:picks:",
      "pickroom:votes:",
      "pickroom:slip:",
      "pickroom:slip-history:",
      "pickroom:published-popup:",
      "pickroom:kickoff-popup:"
    ];
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && legacyPrefixes.some((prefix) => key.startsWith(prefix))) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(clearMarker, "true");
  } catch {
    // Old browser cache should never block the app.
  }
}

function readStoredCollections<T>(prefix: string): T[] {
  try {
    const items: T[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (Array.isArray(parsed)) items.push(...parsed);
    }
    return items;
  } catch {
    return [];
  }
}

function mergeById<T extends { id: string }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function isApiFootballMatch(match: Match) {
  return match.id.startsWith("api-football-");
}

function keepApiFootballMatches(matches: Match[]) {
  const normalizedMatches = matches.filter(isApiFootballMatch).map((match) => ({
    ...match,
    competition: cleanCompetitionName(match.competition)
  }));
  return buildMatchSlate(normalizedMatches, []);
}

function mergeStableScheduledMatches(...matchGroups: Match[][]) {
  return filterUpcomingScheduledMatches(keepApiFootballMatches(mergeById(matchGroups.flat()))).sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
  );
}

function mergeMatchesForState(...matchGroups: Match[][]) {
  return keepApiFootballMatches(mergeById(matchGroups.flat())).sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
  );
}

function hasExpandedOdds(odds: MatchOdd[]) {
  return odds.some((odd) => odd.marketType !== "1X2");
}

function hasWorldCupEspnOdds(matches: Match[], odds: MatchOdd[]) {
  const worldCupEspnMatchIds = matches
    .filter((match) => match.id.startsWith("api-football-espn-world-") && competitionFilterKey(match) === "World|World Cup")
    .map((match) => match.id);
  if (worldCupEspnMatchIds.length === 0) return true;
  return worldCupEspnMatchIds.every((matchId) => odds.some((odd) => odd.matchId === matchId && odd.marketType === "1X2"));
}

function hasMatchCoverage(matches: Match[], days: string[]) {
  const scheduled = filterUpcomingScheduledMatches(keepApiFootballMatches(matches));
  const matchesByDay = new Map<string, number>();
  const worldCupMatchesByDay = new Map<string, number>();
  for (const match of scheduled) {
    const day = getLocalDateKey(new Date(match.startsAt));
    matchesByDay.set(day, (matchesByDay.get(day) ?? 0) + 1);
    if (competitionFilterKey(match) === "World|World Cup") {
      worldCupMatchesByDay.set(day, (worldCupMatchesByDay.get(day) ?? 0) + 1);
    }
  }
  const hasEnoughPerDay = days.every((day) => (matchesByDay.get(day) ?? 0) >= 20);
  const hasFeaturedTomorrow = scheduled.some((match) => {
    const key = competitionFilterKey(match);
    const day = getLocalDateKey(new Date(match.startsAt));
    return day === tomorrowDay && competitionRank(key) < 999;
  });
  const hasWorldCupCoverage = days.every((day) => (worldCupMatchesByDay.get(day) ?? 0) >= 2);
  return hasEnoughPerDay && hasFeaturedTomorrow && hasWorldCupCoverage;
}

function competitionFilterKey(match: Match) {
  return `${match.country ?? "Global"}|${match.competition}`;
}

function formatCompetitionFilterLabel(key: string) {
  if (key === "all") return "Todas";
  const [country, competition] = key.split("|");
  return `${country} - ${competition}`;
}

function formatMatchCompetition(match: Match) {
  return formatCompetitionFilterLabel(competitionFilterKey(match));
}

function formatCommunityDayLabel(day: string) {
  if (day === tipDay) return "Hoje";
  if (day === tomorrowDay) return "Amanhã";
  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(`${day}T12:00:00Z`));
}

function buildDateKeysBetween(start: Date, end: Date) {
  const keys: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(12, 0, 0, 0);
  const last = new Date(end);
  last.setHours(12, 0, 0, 0);
  while (cursor.getTime() <= last.getTime()) {
    keys.push(getLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return Array.from(new Set(keys));
}

function normalizeFilterText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getAuthProfileRole(displayName: string): User["role"] {
  return normalizeFilterText(displayName) === "francisconunes1" ? "mod" : "viewer";
}

function competitionRank(key: string) {
  const featured = [
    "England|Premier League",
    "Germany|Bundesliga",
    "Spain|La Liga",
    "Italy|Serie A",
    "France|Ligue 1",
    "Portugal|Primeira Liga",
    "Portugal|Liga Portugal",
    "World|World Cup",
    "World|UEFA Champions League",
    "World|UEFA Europa League",
    "World|Copa Libertadores",
    "World|Copa Sudamericana"
  ];
  const index = featured.findIndex((item) => key.includes(item));
  return index === -1 ? 999 : index;
}

function formatKickoff(value: string) {
  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatSlipDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusLabel(status: PickStatus) {
  const labels: Record<PickStatus, string> = {
    pending: "Pendente",
    won: "Ganha",
    lost: "Perdida",
    void: "Void",
    half_won: "Meia ganha",
    half_lost: "Meia perdida"
  };
  return labels[status];
}

function matchStatusLabel(match: Match) {
  if (match.status === "live") return "Ao vivo";
  if (match.status === "finished") return "Terminado";
  return "Agendado";
}

function userById(userId: string) {
  return runtimeUsers.find((user) => user.id === userId) ?? users.find((user) => user.id === userId) ?? fallbackUser;
}

function buildStatsScope(label: string, picks: Pick[], slips: SlipHistoryItem[], filter: (value: string) => boolean) {
  const scopePicks = picks.filter((pick) => filter(pick.createdAt));
  const scopeSlips = slips.filter((slip) => filter(slip.publishedAt));
  const selectedIds = new Set(scopeSlips.flatMap((slip) => slip.pickIds));
  const settledSlips = scopeSlips.filter((slip) => slip.settlementStatus !== "pending");
  const settledStandalonePicks = scopePicks.filter((pick) => pick.status !== "pending" && !selectedIds.has(pick.id));
  const slipStake = settledSlips.reduce((total, slip) => total + (slip.mode === "combined" ? slip.combinedStake : slip.multiplesStake * slip.pickIds.length), 0);
  const standaloneStake = settledStandalonePicks.reduce((total, pick) => total + pick.stake, 0);
  const staked = roundUnits(slipStake + standaloneStake);
  const profit = roundUnits(settledSlips.reduce((total, slip) => total + slip.profit, 0) + settledStandalonePicks.reduce((total, pick) => total + pick.profit, 0));

  return {
    label,
    total: {
      submitted: scopePicks.length,
      selected: selectedIds.size,
      settled: settledSlips.length + settledStandalonePicks.length,
      pendingSelected: scopeSlips.filter((slip) => slip.settlementStatus === "pending").reduce((total, slip) => total + slip.pickIds.length, 0),
      staked,
      profit,
      roi: staked > 0 ? roundUnits((profit / staked) * 100) : 0
    },
    byViewer: runtimeUsers.map((user) => {
      const submitted = scopePicks.filter((pick) => pick.userId === user.id).length;
      const selected = scopePicks.filter((pick) => selectedIds.has(pick.id) && pick.userId === user.id).length;
      let settled = 0;
      let viewerStake = 0;
      let viewerProfit = 0;
      const settledStandaloneByUser = scopePicks.filter((pick) => pick.userId === user.id && pick.status !== "pending" && !selectedIds.has(pick.id));

      for (const slip of settledSlips) {
        const slipPicks = slip.pickIds.map((pickId) => picks.find((pick) => pick.id === pickId)).filter((pick): pick is Pick => Boolean(pick));
        const viewerPickCount = slipPicks.filter((pick) => pick.userId === user.id).length;
        if (viewerPickCount === 0 || slipPicks.length === 0) continue;
        const slipStake = slip.mode === "combined" ? slip.combinedStake : slip.multiplesStake * slip.pickIds.length;
        settled += viewerPickCount;
        viewerStake += (slipStake / slipPicks.length) * viewerPickCount;
        viewerProfit += (slip.profit / slipPicks.length) * viewerPickCount;
      }

      settled += settledStandaloneByUser.length;
      viewerStake += settledStandaloneByUser.reduce((total, pick) => total + pick.stake, 0);
      viewerProfit += settledStandaloneByUser.reduce((total, pick) => total + pick.profit, 0);

      const roundedStake = roundUnits(viewerStake);
      const roundedProfit = roundUnits(viewerProfit);
      return {
        userId: user.id,
        submitted,
        selected,
        settled,
        pendingSelected: scopePicks.filter((pick) => selectedIds.has(pick.id) && pick.userId === user.id && pick.status === "pending").length,
        staked: roundedStake,
        profit: roundedProfit,
        roi: roundedStake > 0 ? roundUnits((roundedProfit / roundedStake) * 100) : 0
      };
    }).sort((left, right) =>
      Number(right.settled > 0) - Number(left.settled > 0)
      || right.roi - left.roi
      || right.profit - left.profit
      || right.selected - left.selected
      || right.submitted - left.submitted
    )
  };
}

function buildSlipTimeline(slips: SlipHistoryItem[], filter: (value: string) => boolean): ChartPoint[] {
  let cumulative = 0;
  let cumulativeStake = 0;
  return slips
    .filter((slip) => slip.settlementStatus !== "pending" && filter(slip.publishedAt))
    .sort((left, right) => new Date(left.publishedAt).getTime() - new Date(right.publishedAt).getTime())
    .map((slip) => {
      const stake = slip.mode === "combined" ? slip.combinedStake : slip.multiplesStake * slip.pickIds.length;
      cumulative = roundUnits(cumulative + slip.profit);
      cumulativeStake = roundUnits(cumulativeStake + stake);
      return {
        label: new Date(slip.publishedAt).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" }),
        profit: slip.profit,
        stake,
        cumulative,
        cumulativeStake,
        roi: cumulativeStake > 0 ? roundUnits((cumulative / cumulativeStake) * 100) : 0
      };
    });
}

function buildResultTimeline(picks: Pick[], slips: SlipHistoryItem[], filter: (value: string) => boolean): ChartPoint[] {
  const selectedIds = new Set(slips.flatMap((slip) => slip.pickIds));
  const slipEvents = slips
    .filter((slip) => slip.settlementStatus !== "pending" && filter(slip.publishedAt))
    .map((slip) => ({
      date: slip.publishedAt,
      profit: slip.profit,
      stake: slip.mode === "combined" ? slip.combinedStake : slip.multiplesStake * slip.pickIds.length
    }));
  const standaloneEvents = picks
    .filter((pick) => pick.status !== "pending" && !selectedIds.has(pick.id) && filter(pick.createdAt))
    .map((pick) => ({ date: pick.createdAt, profit: pick.profit, stake: pick.stake }));
  let cumulative = 0;
  let cumulativeStake = 0;
  return [...slipEvents, ...standaloneEvents]
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
    .map((event) => {
      cumulative = roundUnits(cumulative + event.profit);
      cumulativeStake = roundUnits(cumulativeStake + event.stake);
      return {
        label: new Date(event.date).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" }),
        profit: event.profit,
        stake: event.stake,
        cumulative,
        cumulativeStake,
        roi: cumulativeStake > 0 ? roundUnits((cumulative / cumulativeStake) * 100) : 0
      };
    });
}

function buildLeaderboard(scope: StatsScope) {
  return runtimeUsers
    .map((user) => {
      const row = scope.byViewer.find((viewerRow) => viewerRow.userId === user.id);
      return {
        user,
        picks: row?.settled ?? 0,
        profit: row?.profit ?? 0,
        roi: row?.roi ?? 0,
        winrate: row && row.selected > 0 ? roundUnits((row.settled / row.selected) * 100) : 0
      };
    })
    .sort((a, b) =>
      Number(b.picks > 0) - Number(a.picks > 0)
      || b.roi - a.roi
      || b.profit - a.profit
      || b.winrate - a.winrate
    );
}

function formatNameList(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function Avatar({ user }: { user: User }) {
  if (user.avatarUrl) {
    return <img className="avatar image-avatar" src={user.avatarUrl} alt={`Avatar ${user.displayName}`} loading="lazy" />;
  }
  return (
    <span className="avatar" style={{ background: user.avatarColor }}>
      {user.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}

function TeamLogo({ src, name }: { src?: string; name: string }) {
  if (src) return <img className="team-logo" src={src} alt={`Emblema ${name}`} loading="lazy" />;
  return <span className="team-logo fallback">{name.slice(0, 2).toUpperCase()}</span>;
}

function MatchMiniCard({ match }: { match?: Match }) {
  if (!match) return <span className="match-mini unavailable">Jogo indisponivel</span>;
  return (
    <div className="match-mini">
      <div>
        <TeamLogo src={match.homeLogoUrl} name={match.homeTeam} />
        <strong>{match.homeTeam}</strong>
      </div>
      <span>vs</span>
      <div>
        <TeamLogo src={match.awayLogoUrl} name={match.awayTeam} />
        <strong>{match.awayTeam}</strong>
      </div>
    </div>
  );
}

function normalizePickStake(pick: Pick): Pick {
  return pick.stake === fixedViewerStake ? pick : { ...pick, stake: fixedViewerStake };
}

function isEquivalentSlipPick(left: Pick, right: Pick) {
  return left.matchId === right.matchId
    && left.marketType === right.marketType
    && normalizeFilterText(left.selection) === normalizeFilterText(right.selection);
}

function getSlipPicks(slip: SlipHistoryItem, sourcePicks: Pick[]) {
  return slip.pickIds
    .map((pickId) => sourcePicks.find((pick) => pick.id === pickId))
    .filter((pick): pick is Pick => Boolean(pick));
}

function recalculateSlip(slip: SlipHistoryItem, sourcePicks: Pick[], votes: VoteRecord[]) {
  const slipPicks = getSlipPicks(slip, sourcePicks);
  if (slip.mode === "combined") {
    const odds = buildPickGroups(slipPicks, votes).reduce((total, group) => total * group.representative.odds, 1);
    const profit = slip.settlementStatus === "pending" ? 0 : calculateProfit(slip.settlementStatus, slip.combinedStake, odds);
    return { slip: { ...slip, profit }, picks: slipPicks };
  }

  const recalculatedPicks = slipPicks.map((pick) => ({
    ...pick,
    stake: fixedViewerStake,
    profit: calculateProfit(pick.status, slip.multiplesStake, pick.odds)
  }));
  const profit = roundUnits(recalculatedPicks.reduce((total, pick) => total + pick.profit, 0));
  const settlementStatus: PickStatus = recalculatedPicks.some((pick) => pick.status === "pending")
    ? "pending"
    : profit > 0 ? "won" : profit < 0 ? "lost" : "void";
  return { slip: { ...slip, settlementStatus, profit }, picks: recalculatedPicks };
}

export function App() {
  clearLegacyStatsCache();
  const [isOverlayRoute] = useState(() => window.location.pathname === "/overlay" || window.location.hash === "#overlay");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeUserId, setActiveUserId] = useState("u-serginho");
  const [authProfile, setAuthProfile] = useState<User | null>(null);
  const [remoteProfiles, setRemoteProfiles] = useState<User[]>([]);
  const [activeLeague, setActiveLeague] = useState<League | null>(null);
  const [twitchAvatarUrl, setTwitchAvatarUrl] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<SyncStatus>("loading");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [matches, setMatches] = useState<Match[]>(() => readStoredValue<Match[]>(matchesCacheKey, []));
  const matchesRef = useRef(matches);
  const automaticMatchRefreshRef = useRef(false);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [matchSync, setMatchSync] = useState<"loading" | "live" | "empty">(() => (
    readStoredValue<Match[]>(matchesCacheKey, []).length > 0 ? "live" : "loading"
  ));
  const [picks, setPicks] = useState<Pick[]>(() => readStoredValue<Pick[]>(picksCacheKey, []).map(normalizePickStake));
  const [localPickOverrides, setLocalPickOverrides] = useState<Record<string, Partial<Pick> | null>>({});
  const localPickOverridesRef = useRef(localPickOverrides);
  const [votes, setVotes] = useState<VoteRecord[]>(() => readStoredValue<VoteRecord[]>(votesCacheKey, []));
  const [matchOdds, setMatchOdds] = useState<MatchOdd[]>(() => readStoredValue<MatchOdd[]>(oddsCacheKey, []));
  const [dailySlip, setDailySlip] = useState<DailySlip>(() => readStoredValue<DailySlip>(slipCacheKey, createDefaultDailySlip()));
  const [slipHistory, setSlipHistory] = useState<SlipHistoryItem[]>(() => readStoredValue<SlipHistoryItem[]>(slipHistoryCacheKey, []));
  const [localSlipOverrides, setLocalSlipOverrides] = useState<Record<string, Partial<SlipHistoryItem>>>({});
  const localSlipOverridesRef = useRef(localSlipOverrides);
  const [popup, setPopup] = useState<{ title: string; body: string } | null>(null);
  const [pendingSettlement, setPendingSettlement] = useState<
    | { kind: "combined"; slipId: string; status: PickStatus }
    | { kind: "pick"; slipId: string; pickId: string; status: PickStatus }
    | null
  >(null);
  const [tipModalMatchId, setTipModalMatchId] = useState<string | null>(null);
  const [kickoffCheckAt, setKickoffCheckAt] = useState(() => Date.now());
  const [selectedResolveSlipId, setSelectedResolveSlipId] = useState("");
  const [activePage, setActivePage] = useState<Page>("games");
  const [competitionFilter, setCompetitionFilter] = useState("all");
  const [matchSearch, setMatchSearch] = useState("");
  const [communityMatchFilter, setCommunityMatchFilter] = useState("all");
  const [communityMatchSearch, setCommunityMatchSearch] = useState("");
  const [communitySortMode, setCommunitySortMode] = useState<PickGroupSortMode>("recent");
  const [formState, setFormState] = useState({
    marketType: "1X2" as MarketType,
    selection: "",
    odds: "2.00",
    stake: "1",
    bookmaker: "Manual",
    reason: ""
  });

  useEffect(() => {
    if (matches.length > 0) {
      const apiMatches = mergeStableScheduledMatches(matches);
      if (apiMatches.length !== matches.length) setMatches(apiMatches);
      setSelectedMatchId(apiMatches[0]?.id ?? "");
      requestAutomaticMatchRefresh(apiMatches);
      return;
    }
    void syncTodayMatches();
  }, []);

  useEffect(() => writeStoredValue(matchesCacheKey, matches), [matches]);
  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);
  useEffect(() => writeStoredValue(picksCacheKey, picks), [picks]);
  useEffect(() => {
    localPickOverridesRef.current = localPickOverrides;
  }, [localPickOverrides]);
  useEffect(() => {
    localSlipOverridesRef.current = localSlipOverrides;
  }, [localSlipOverrides]);
  useEffect(() => writeStoredValue(votesCacheKey, votes), [votes]);
  useEffect(() => writeStoredValue(oddsCacheKey, matchOdds), [matchOdds]);
  useEffect(() => writeStoredValue(slipCacheKey, dailySlip), [dailySlip]);
  useEffect(() => writeStoredValue(slipHistoryCacheKey, slipHistory), [slipHistory]);

  useEffect(() => {
    if (!supabase) {
      setAuthStatus("error");
      return;
    }

    let mounted = true;

    async function hydrateAuth() {
      setAuthStatus("loading");
      const { data, error } = await supabase!.auth.getSession();
      if (!mounted) return;
      if (error || !data.session?.user) {
        setIsLoggedIn(false);
        setAuthProfile(null);
        setTwitchAvatarUrl(null);
        setAuthStatus("idle");
        return;
      }

      const metadata = data.session.user.user_metadata;
      const displayName = metadata.preferred_username ?? metadata.user_name ?? metadata.name ?? "Viewer Twitch";
      const twitchId = metadata.provider_id ?? data.session.user.identities?.[0]?.id ?? null;
      const avatarUrl = metadata.avatar_url ?? metadata.picture ?? null;
      const profile: User = {
        id: data.session.user.id,
        displayName,
        role: getAuthProfileRole(displayName),
        avatarColor: "#16d782",
        avatarUrl: avatarUrl ?? undefined
      };

      try {
        await saveProfile(profile, twitchId, avatarUrl);
      } catch (profileError) {
        console.error("Failed to sync Twitch profile", profileError);
      }

      if (!mounted) return;
      setAuthProfile(profile);
      setTwitchAvatarUrl(avatarUrl);
      setActiveUserId(profile.id);
      setIsLoggedIn(true);
      setAuthStatus("ready");
    }

    void hydrateAuth();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (!session?.user) {
        setIsLoggedIn(false);
        setAuthProfile(null);
        setTwitchAvatarUrl(null);
        setRemoteProfiles([]);
        setAuthStatus("idle");
        return;
      }
      void hydrateAuth();
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const mergedUsers = mergeById([...users, ...remoteProfiles, ...(authProfile ? [authProfile] : [])]);
    setRuntimeUsers(mergedUsers);
  }, [authProfile, remoteProfiles]);

  useEffect(() => {
    if ((!isLoggedIn && !isOverlayRoute) || !isSupabaseConfigured) return;

    let mounted = true;
    let inFlight = false;
    async function loadSharedState(showLoading = false) {
      if (inFlight) return;
      inFlight = true;
      if (showLoading) setSyncStatus("loading");
      try {
        const remote = await loadRemoteState(tipDay, defaultLeagueCode, matchDates, statsDayKeys);
        if (!mounted) return;
        setRemoteProfiles(remote.profiles);
        setActiveLeague(remote.league ?? null);
        if (remote.league && authProfile) {
          void ensureLeagueMember(remote.league.id, authProfile.id, authProfile.role === "streamer" ? "streamer" : authProfile.role === "mod" ? "mod" : "member");
        }
        const remoteApiMatches = keepApiFootballMatches(remote.matches);
        if (remoteApiMatches.length > 0) {
          const mergedRemoteMatches = mergeMatchesForState(matchesRef.current, remoteApiMatches);
          setMatches((current) => mergeMatchesForState(current, remoteApiMatches));
          requestAutomaticMatchRefresh(filterUpcomingScheduledMatches(mergedRemoteMatches));
          setMatchSync("live");
        }
        const pickOverrides = localPickOverridesRef.current;
        const slipOverrides = localSlipOverridesRef.current;
        const resetPicks = remote.picks
          .filter((pick) => isAfterStatsReset(pick.createdAt))
          .map((pick) => {
            const override = pickOverrides[pick.id];
            return override ? { ...pick, ...override } : pick;
          })
          .filter((pick) => pickOverrides[pick.id] !== null);
        const oldStakePicks = resetPicks.filter((pick) => pick.stake !== fixedViewerStake);
        const normalizedRemotePicks = resetPicks.map(normalizePickStake);
        setPicks(normalizedRemotePicks);
        if (oldStakePicks.length > 0) {
          void Promise.all(oldStakePicks.map((pick) => updatePickStake(pick.id, fixedViewerStake))).catch((error) => {
            console.error("Failed to normalize old pick stakes", error);
          });
        }
        setVotes(remote.votes);
        if (remote.odds.length > 0) setMatchOdds(remote.odds);
        if (remote.dailySlip && isAfterStatsReset(remote.dailySlip.generatedAt)) {
          setDailySlip((current) => {
            const hasLocalDraft = current.status === "draft" && current.pickIds.length > 0 && current.generatedAt !== remote.dailySlip?.generatedAt;
            return hasLocalDraft ? current : remote.dailySlip!;
          });
        }
        const normalizedSlipHistory = remote.slipHistory
          .filter((slip) => isAfterStatsReset(slip.publishedAt))
          .map((slip) => {
            const recalculated = slip.settlementStatus === "pending" ? slip : recalculateSlip(slip, normalizedRemotePicks, remote.votes).slip;
            const override = slipOverrides[slip.id];
            return override ? { ...recalculated, ...override } : recalculated;
          });
        setSlipHistory(normalizedSlipHistory);
        setSyncStatus("ready");
      } catch (error) {
        console.error("Failed to load Supabase state", error);
        if (mounted) setSyncStatus("error");
      } finally {
        inFlight = false;
      }
    }

    void loadSharedState(true);
    const refreshTimer = window.setInterval(() => {
      void loadSharedState(false);
    }, 8_000);

    return () => {
      mounted = false;
      window.clearInterval(refreshTimer);
    };
  }, [authProfile, isLoggedIn, isOverlayRoute]);

  useEffect(() => {
    document.body.classList.toggle("overlay-body", isOverlayRoute);
    return () => document.body.classList.remove("overlay-body");
  }, [isOverlayRoute]);

  useEffect(() => {
    const pendingSlips = slipHistory.filter((slip) => slip.settlementStatus === "pending");
    if (pendingSlips.length === 0) {
      setSelectedResolveSlipId("");
      return;
    }
    if (!pendingSlips.some((slip) => slip.id === selectedResolveSlipId)) {
      setSelectedResolveSlipId(pendingSlips[0].id);
    }
  }, [selectedResolveSlipId, slipHistory]);

  async function syncTodayMatches(forceRefresh = false) {
    setMatchSync("loading");
    const cachedMatches = mergeStableScheduledMatches(readStoredValue<Match[]>(matchesCacheKey, []));
    if (!forceRefresh && cachedMatches.length > 0 && hasMatchCoverage(cachedMatches, matchDates)) {
      const nextMatches = mergeMatchesForState(matchesRef.current, cachedMatches);
      setMatches(nextMatches);
      setSelectedMatchId(cachedMatches[0]?.id ?? "");
      setMatchSync("live");
      return;
    }

    try {
      const todayMatches = await fetchMatchesForDates([currentDate, tomorrowDate], { forceRefresh });
      const mergedMatches = mergeStableScheduledMatches(matchesRef.current, cachedMatches, todayMatches);
      if (mergedMatches.length > 0) {
        setMatches((current) => mergeMatchesForState(current, mergedMatches));
        setSelectedMatchId((current) => mergedMatches.some((match) => match.id === current) ? current : mergedMatches[0]?.id ?? "");
        setMatchSync("live");
        void saveMatches(mergedMatches).catch((error) => console.error("Failed to cache matches", error));
        return;
      }
      if (cachedMatches.length > 0) {
        setMatches((current) => mergeMatchesForState(current, cachedMatches));
        setSelectedMatchId((current) => cachedMatches.some((match) => match.id === current) ? current : cachedMatches[0]?.id ?? "");
        setMatchSync("live");
        return;
      }
      setMatches((current) => mergeMatchesForState(current));
      setSelectedMatchId("");
      setMatchSync("empty");
    } catch {
      if (cachedMatches.length > 0) {
        setMatches((current) => mergeMatchesForState(current, cachedMatches));
        setSelectedMatchId((current) => cachedMatches.some((match) => match.id === current) ? current : cachedMatches[0]?.id ?? "");
        setMatchSync("live");
      } else {
        setMatches([]);
        setSelectedMatchId("");
        setMatchSync("empty");
      }
    }
  }

  function requestAutomaticMatchRefresh(candidateMatches: Match[]) {
    if (automaticMatchRefreshRef.current || hasMatchCoverage(candidateMatches, matchDates)) return;
    automaticMatchRefreshRef.current = true;
    void syncTodayMatches(true);
  }

  const remoteActiveProfile = remoteProfiles.find((profile) => profile.id === activeUserId);
  const activeUser = remoteActiveProfile ?? authProfile ?? userById(activeUserId);
  const isStreamer = activeUser.role === "streamer";
  const isPlatformAdmin = normalizeFilterText(activeUser.displayName) === "francisconunes1";
  const scheduledMatches = useMemo(() => filterUpcomingScheduledMatches(keepApiFootballMatches(matches)), [matches]);
  const competitionOptions = useMemo(
    () => [
      "all",
      ...Array.from(new Set(scheduledMatches.map(competitionFilterKey))).sort((a, b) => {
        const rankDelta = competitionRank(a) - competitionRank(b);
        return rankDelta !== 0 ? rankDelta : formatCompetitionFilterLabel(a).localeCompare(formatCompetitionFilterLabel(b));
      })
    ],
    [scheduledMatches]
  );

  useEffect(() => {
    if (competitionFilter !== "all" && !competitionOptions.includes(competitionFilter)) {
      setCompetitionFilter("all");
    }
  }, [competitionFilter, competitionOptions]);

  const visibleMatches = useMemo(
    () => {
      const normalizedQuery = normalizeFilterText(matchSearch);
      return scheduledMatches
        .filter((match) => {
          const competitionLabel = formatCompetitionFilterLabel(competitionFilterKey(match));
          const matchesCompetition = competitionFilter === "all" || competitionFilterKey(match) === competitionFilter;
          const teamSearchText = normalizeFilterText(`${match.homeTeam} ${match.awayTeam} ${match.country ?? ""}`);
          const competitionSearchText = normalizeFilterText(`${match.competition} ${competitionLabel}`);
          const matchesSearch = normalizedQuery.length === 0
            || teamSearchText.includes(normalizedQuery)
            || (normalizedQuery.length >= 3 && competitionSearchText.includes(normalizedQuery));
          return matchesCompetition && matchesSearch;
        })
        .sort((left, right) => {
          const rankDelta = competitionRank(competitionFilterKey(left)) - competitionRank(competitionFilterKey(right));
          if (rankDelta !== 0) return rankDelta;
          return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
        });
    },
    [competitionFilter, matchSearch, scheduledMatches]
  );

  useEffect(() => {
    if (visibleMatches.length === 0) {
      setSelectedMatchId("");
      return;
    }
    if (!visibleMatches.some((match) => match.id === selectedMatchId)) {
      setSelectedMatchId(visibleMatches[0].id);
    }
  }, [selectedMatchId, visibleMatches]);

  const selectedMatch = visibleMatches.find((match) => match.id === selectedMatchId) ?? visibleMatches[0];
  const tipModalMatch = tipModalMatchId ? visibleMatches.find((match) => match.id === tipModalMatchId) ?? matches.find((match) => match.id === tipModalMatchId) : undefined;
  const tipModalOdds = tipModalMatch ? matchOdds.filter((odd) => odd.matchId === tipModalMatch.id) : [];
  const isPickBeforeKickoff = (pick: Pick) => {
    const match = matches.find((item) => item.id === pick.matchId);
    return Boolean(match) && match?.status === "scheduled" && new Date(match.startsAt).getTime() > kickoffCheckAt;
  };
  const eligibleSlipPicks = useMemo(() => picks.filter(isPickBeforeKickoff), [kickoffCheckAt, matches, picks]);
  const selectedMatchPicks = selectedMatch ? picks.filter((pick) => pick.matchId === selectedMatch.id && isPickBeforeKickoff(pick)) : [];
  const selectedMatchPickGroups = useMemo(() => buildPickGroups(selectedMatchPicks, votes), [selectedMatchPicks, votes]);
  const communityStartDay = communityDayKeys[communityDayKeys.length - 1];
  const communityPicks = [...picks]
    .filter(isPickBeforeKickoff)
    .filter((pick) => {
      const match = matches.find((item) => item.id === pick.matchId);
      const day = match ? getLocalDateKey(new Date(match.startsAt)) : pick.createdAt.slice(0, 10);
      return day >= communityStartDay;
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const communityMatchOptions = useMemo(() => {
    const byId = new Map<string, Match>();
    for (const pick of communityPicks) {
      const match = matches.find((item) => item.id === pick.matchId);
      if (match) byId.set(match.id, match);
    }
    return Array.from(byId.values()).sort((left, right) => {
      const dateDelta = new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
      if (dateDelta !== 0) return dateDelta;
      return `${left.homeTeam} ${left.awayTeam}`.localeCompare(`${right.homeTeam} ${right.awayTeam}`);
    });
  }, [communityPicks, matches]);
  useEffect(() => {
    if (communityMatchFilter !== "all" && !communityMatchOptions.some((match) => match.id === communityMatchFilter)) {
      setCommunityMatchFilter("all");
    }
  }, [communityMatchFilter, communityMatchOptions]);
  const filteredCommunityPicks = useMemo(() => {
    const normalizedQuery = normalizeFilterText(communityMatchSearch);
    return communityPicks.filter((pick) => {
      const match = matches.find((item) => item.id === pick.matchId);
      const matchesDropdown = communityMatchFilter === "all" || pick.matchId === communityMatchFilter;
      const searchText = normalizeFilterText(match ? `${match.homeTeam} ${match.awayTeam} ${match.competition} ${match.country ?? ""}` : pick.selection);
      const matchesSearch = normalizedQuery.length === 0 || searchText.includes(normalizedQuery);
      return matchesDropdown && matchesSearch;
    });
  }, [communityMatchFilter, communityMatchSearch, communityPicks, matches]);
  const communityPickGroups = useMemo(() => buildPickGroups(filteredCommunityPicks, votes, communitySortMode), [communitySortMode, filteredCommunityPicks, votes]);
  const communitySections = useMemo(() => {
    const sections = new Map<string, PickGroup[]>();
    for (const group of communityPickGroups) {
      const match = matches.find((item) => item.id === group.representative.matchId);
      const day = match ? getLocalDateKey(new Date(match.startsAt)) : group.representative.createdAt.slice(0, 10);
      sections.set(day, [...(sections.get(day) ?? []), group]);
    }
    return Array.from(sections.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([day, groups]) => ({ day, groups }));
  }, [communityPickGroups, matches]);
  const topSlipPicks = dailySlip.pickIds
    .map((pickId) => picks.find((pick) => pick.id === pickId))
    .filter((pick): pick is Pick => {
      if (!pick) return false;
      return dailySlip.status === "published" || isPickBeforeKickoff(pick);
    });
  const topSlipPickGroups = useMemo(() => buildPickGroups(topSlipPicks, votes), [topSlipPicks, votes]);
  const visibleTopSlipPicks = topSlipPicks.filter(isPickBeforeKickoff);
  const visibleTopSlipPickGroups = useMemo(() => buildPickGroups(visibleTopSlipPicks, votes), [visibleTopSlipPicks, votes]);
  const showCommunitySlipPanel = topSlipPicks.length === 0 || visibleTopSlipPicks.length > 0;
  const resolvableSlipHistory = slipHistory.filter((slip) => slip.settlementStatus === "pending");
  const selectedResolveSlip = resolvableSlipHistory.find((slip) => slip.id === selectedResolveSlipId) ?? resolvableSlipHistory[0];
  const selectedResolvePicks = selectedResolveSlip
    ? selectedResolveSlip.pickIds.map((pickId) => picks.find((pick) => pick.id === pickId)).filter((pick): pick is Pick => Boolean(pick))
    : [];
  const selectedResolvePickGroups = useMemo(() => buildPickGroups(selectedResolvePicks, votes), [selectedResolvePicks, votes]);

  const combinedOdds = topSlipPickGroups.reduce((total, group) => total * group.representative.odds, 1);
  const visibleCombinedOdds = visibleTopSlipPickGroups.reduce((total, group) => total * group.representative.odds, 1);
  const selectedResolveCombinedOdds = selectedResolvePickGroups.reduce((total, group) => total * group.representative.odds, 1);
  const multiplesStake = topSlipPickGroups.length * dailySlip.multiplesStake;
  const visibleMultiplesStake = visibleTopSlipPickGroups.length * dailySlip.multiplesStake;
  const isPublishedSlip = dailySlip.status === "published" && topSlipPicks.length > 0;
  const slipSettled = dailySlip.settlementStatus !== "pending";
  const allStoredPicks = useMemo(
    () => mergeById([...readStoredCollections<Pick>(`${cacheNamespace}:picks:`), ...picks]).map(normalizePickStake),
    [picks]
  );
  const allStoredSlips = useMemo(() => mergeById([...readStoredCollections<SlipHistoryItem>(`${cacheNamespace}:slip-history:`), ...slipHistory]), [slipHistory]);
  const monthKey = tipDay.slice(0, 7);
  const monthName = new Intl.DateTimeFormat("pt-PT", { month: "long" }).format(currentDate).replace(/^./, (letter) => letter.toUpperCase());
  const dayScope = useMemo(
    () => buildStatsScope("Hoje", allStoredPicks, allStoredSlips, (value) => value.slice(0, 10) === tipDay),
    [allStoredPicks, allStoredSlips]
  );
  const monthScope = useMemo(
    () => buildStatsScope(monthName, allStoredPicks, allStoredSlips, (value) => value.slice(0, 7) === monthKey),
    [allStoredPicks, allStoredSlips, monthName, monthKey]
  );
  const allTimeScope = useMemo(
    () => buildStatsScope("Geral", allStoredPicks, allStoredSlips, () => true),
    [allStoredPicks, allStoredSlips]
  );
  const settledCommunitySlips = allStoredSlips.filter((slip) => slip.settlementStatus !== "pending");
  const communitySlipProfit = roundUnits(settledCommunitySlips.reduce((total, slip) => total + slip.profit, 0));
  const communitySlipStake = roundUnits(settledCommunitySlips.reduce((total, slip) => {
    const stake = slip.mode === "combined" ? slip.combinedStake : slip.multiplesStake * slip.pickIds.length;
    return total + stake;
  }, 0));
  const settledBankroll = roundUnits(communityInitialBankroll + communitySlipProfit);
  const slipExposure = isPublishedSlip && !slipSettled ? settledBankroll : 0;
  const communityBankroll = {
    initial: communityInitialBankroll,
    current: settledBankroll,
    exposure: slipExposure,
    settledProfit: communitySlipProfit,
    roi: communitySlipStake > 0 ? roundUnits((communitySlipProfit / communitySlipStake) * 100) : 0
  };
  const allInStakePreview = Math.max(0, settledBankroll);
  const allInMultiplesUnitStake = visibleTopSlipPickGroups.length > 0 ? roundUnits(allInStakePreview / visibleTopSlipPickGroups.length) : allInStakePreview;
  const dayProfitTimeline = useMemo(
    () => buildResultTimeline(allStoredPicks, allStoredSlips, (value) => value.slice(0, 10) === tipDay),
    [allStoredPicks, allStoredSlips]
  );
  const monthProfitTimeline = useMemo(
    () => buildResultTimeline(allStoredPicks, allStoredSlips, (value) => value.slice(0, 7) === monthKey),
    [allStoredPicks, allStoredSlips, monthKey]
  );
  const allTimeProfitTimeline = useMemo(
    () => buildResultTimeline(allStoredPicks, allStoredSlips, () => true),
    [allStoredPicks, allStoredSlips]
  );
  const displayedProfitTimeline = dayProfitTimeline;
  const displayedDayScope = dayScope;

  useEffect(() => {
    if (!isLoggedIn || isStreamer || dailySlip.status !== "published" || topSlipPicks.length === 0) return;
    const finalGamesStillOpen = topSlipPicks.every((pick) => {
      const match = matches.find((item) => item.id === pick.matchId);
      return match && match.status === "scheduled" && new Date(match.startsAt).getTime() > Date.now();
    });
    if (!finalGamesStillOpen) return;

    const seenKey = `pickroom:published-popup:${tipDay}:${activeUserId}:${dailySlip.generatedAt}`;
    if (readStoredValue(seenKey, false)) return;
    writeStoredValue(seenKey, true);
    setPopup({
      title: "Boletim publicado",
      body: `O SerginhoEsteves publicou a aposta da comunidade com ${topSlipPicks.length} picks finais. Ainda vais a tempo de ver antes dos jogos comecarem.`
    });
  }, [activeUserId, dailySlip.generatedAt, dailySlip.status, isLoggedIn, isStreamer, matches, topSlipPicks]);

  useEffect(() => {
    const timer = window.setInterval(() => setKickoffCheckAt(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isLoggedIn || (hasExpandedOdds(matchOdds) && hasWorldCupEspnOdds(matches, matchOdds))) return;
    let cancelled = false;
    async function loadOddsOnce() {
      const cachedOdds = readStoredValue<MatchOdd[]>(oddsCacheKey, []);
      if (cachedOdds.length > 0 && hasExpandedOdds(cachedOdds) && hasWorldCupEspnOdds(matches, cachedOdds)) {
        setMatchOdds(cachedOdds);
        return;
      }
      const fetchedByDay = await Promise.all(matchDates.map(async (day) => ({ day, odds: await fetchTodayOdds(day) })));
      const fetchedOdds = fetchedByDay.flatMap((item) => item.odds);
      if (cancelled || fetchedOdds.length === 0) return;
      setMatchOdds(fetchedOdds);
      if (isSupabaseConfigured) {
        try {
          await Promise.all(fetchedByDay.map((item) => saveOdds(item.day, item.odds)));
        } catch (error) {
          console.error("Failed to cache odds", error);
        }
      }
    }
    void loadOddsOnce();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, matchOdds.length, matches]);

  useEffect(() => {
    if (!isLoggedIn || popup) return;

    const now = kickoffCheckAt;
    const kickoffWindowMs = 15 * 60 * 1000;
    const activeSlips = slipHistory.filter((slip) => slip.settlementStatus === "pending");

    for (const slip of activeSlips) {
      const slipPicks = slip.pickIds
        .map((pickId) => picks.find((pick) => pick.id === pickId))
        .filter((pick): pick is Pick => Boolean(pick));
      const matchIds = Array.from(new Set(slipPicks.map((pick) => pick.matchId)));

      for (const matchId of matchIds) {
        const match = matches.find((item) => item.id === matchId);
        if (!match) continue;

        const startsAt = new Date(match.startsAt).getTime();
        if (startsAt > now || now - startsAt > kickoffWindowMs) continue;

        const seenKey = `pickroom:kickoff-popup:${tipDay}:${activeUserId}:${slip.id}:${match.id}`;
        if (readStoredValue(seenKey, false)) continue;

        const authors = Array.from(new Set(
          slipPicks
            .filter((pick) => pick.matchId === match.id)
            .map((pick) => userById(pick.userId).displayName)
        ));
        const verb = authors.length === 1 ? "apostou" : "apostaram";
        writeStoredValue(seenKey, true);
        setPopup({
          title: "Jogo da aposta a comecar",
          body: `O jogo ${match.homeTeam} vs ${match.awayTeam}, em que ${formatNameList(authors)} ${verb}, vai comecar agora!`
        });
        return;
      }
    }
  }, [activeUserId, isLoggedIn, kickoffCheckAt, matches, picks, popup, slipHistory]);

  const leaderboard = useMemo(() => buildLeaderboard(monthScope), [monthScope]);
  const generalLeaderboard = useMemo(() => buildLeaderboard(allTimeScope), [allTimeScope]);

  useEffect(() => {
    if (dailySlip.status !== "draft" || dailySlip.pickIds.length === 0) return;
    const openPickIds = new Set(eligibleSlipPicks.map((pick) => pick.id));
    if (dailySlip.pickIds.every((pickId) => openPickIds.has(pickId))) return;
    setDailySlip((slip) => ({
      ...slip,
      pickIds: slip.pickIds.filter((pickId) => openPickIds.has(pickId)),
      generatedAt: new Date().toISOString()
    }));
  }, [dailySlip.pickIds, dailySlip.status, eligibleSlipPicks]);

  function submitPick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stake = fixedViewerStake;
    const manualOdds = Number(formState.odds);
    const targetMatch = tipModalMatch ?? selectedMatch;
    const matchSpecificOdds = targetMatch ? matchOdds.filter((odd) => odd.matchId === targetMatch.id) : [];
    const apiOdd = findAvailableOdd(matchSpecificOdds, formState.marketType, formState.selection);
    const finalOdds = apiOdd?.odds ?? manualOdds;
    const bookmaker = apiOdd?.bookmaker ?? (formState.bookmaker === manualOverrideBookmaker ? "Manual" : formState.bookmaker.trim() || "Manual");
    if (!targetMatch || !formState.selection.trim() || finalOdds <= 1) return;

    const nextPick: Pick = {
      id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      matchId: targetMatch.id,
      userId: activeUserId,
      marketType: formState.marketType,
      selection: formState.selection.trim(),
      odds: finalOdds,
      stake,
      bookmaker,
      reason: formState.reason.trim() || "Sem justificação.",
      status: "pending",
      profit: 0,
      createdAt: new Date().toISOString()
    };

    setPicks((current) => [nextPick, ...current]);
    if (isSupabaseConfigured) {
      setSyncStatus("saving");
      void savePick(tipDay, nextPick, activeLeague?.id, targetMatch)
        .then(() => setSyncStatus("ready"))
        .catch((error) => {
          console.error("Failed to save pick", error);
          setSyncStatus("error");
        });
    }
    setPopup({
      title: "Pick registada",
      body: `${nextPick.selection} ficou guardada no teu historico e ja aparece na comunidade para votacao.`
    });
    setFormState({ marketType: "1X2", selection: "", odds: "2.00", stake: String(fixedViewerStake), bookmaker: "Manual", reason: "" });
    setTipModalMatchId(null);
  }

  function castVote(pickId: string, type: VoteType) {
    const pick = picks.find((item) => item.id === pickId);
    if (!pick || pick.userId === activeUserId) return;
    const nextVote = { pickId, userId: activeUserId, type };

    setVotes((current) => [
      ...current.filter((voteItem) => !(voteItem.pickId === pickId && voteItem.userId === activeUserId)),
      nextVote
    ]);
    if (isSupabaseConfigured) {
      setSyncStatus("saving");
      void saveVote(nextVote)
        .then(() => setSyncStatus("ready"))
        .catch((error) => {
          console.error("Failed to save vote", error);
          setSyncStatus("error");
        });
    }
  }

  function castGroupVote(group: PickGroup, type: VoteType) {
    const nextVotes = group.picks
      .filter((pick) => pick.userId !== activeUserId)
      .map((pick) => ({ pickId: pick.id, userId: activeUserId, type }));
    if (nextVotes.length === 0) return;

    setVotes((current) => [
      ...current.filter((voteItem) => !nextVotes.some((nextVote) => nextVote.pickId === voteItem.pickId && voteItem.userId === activeUserId)),
      ...nextVotes
    ]);
    if (isSupabaseConfigured) {
      setSyncStatus("saving");
      void Promise.all(nextVotes.map(saveVote))
        .then(() => setSyncStatus("ready"))
        .catch((error) => {
          console.error("Failed to save grouped votes", error);
          setSyncStatus("error");
        });
    }
  }

  function generateSlip() {
    const groupedPickIds = sortPickGroups(communityPickGroups, "score").slice(0, 4).flatMap((group) => group.picks.map((pick) => pick.id));
    setDailySlip((slip) => ({
      ...slip,
      status: "draft",
      settlementStatus: "pending",
      profit: 0,
      pickIds: groupedPickIds.length > 0 ? groupedPickIds : selectSlipPicks(eligibleSlipPicks, votes, 4).map((pick) => pick.id),
      generatedAt: new Date().toISOString()
    }));
  }

  function publishSlip() {
    const publishedAt = new Date().toISOString();
    const historyId = `slip-${Date.now()}`;
    const groupedPickIds = sortPickGroups(communityPickGroups, "score").slice(0, 4).flatMap((group) => group.picks.map((pick) => pick.id));
    const openPickIds = new Set(eligibleSlipPicks.map((pick) => pick.id));
    const draftPickIds = dailySlip.pickIds.filter((pickId) => openPickIds.has(pickId));
    const pickIds = draftPickIds.length > 0 ? draftPickIds : groupedPickIds.length > 0 ? groupedPickIds : selectSlipPicks(eligibleSlipPicks, votes, 4).map((pick) => pick.id);
    if (pickIds.length === 0) {
      setPopup({
        title: "Sem picks validas",
        body: "Nao podes publicar picks de jogos que ja comecaram ou terminaram. Escolhe jogos ainda agendados."
      });
      return;
    }
    const allInStake = Math.max(0, settledBankroll);
    const nextSlip: DailySlip = {
      ...dailySlip,
      status: "published",
      settlementStatus: "pending",
      profit: 0,
      combinedStake: dailySlip.mode === "combined" ? allInStake : dailySlip.combinedStake,
      multiplesStake: dailySlip.mode === "multiples" && pickIds.length > 0 ? roundUnits(allInStake / pickIds.length) : dailySlip.multiplesStake,
      pickIds,
      generatedAt: publishedAt
    };
    const historySlip = { ...nextSlip, id: historyId, publishedAt };
    setDailySlip(nextSlip);
    setSlipHistory((current) => [
      historySlip,
      ...current
    ]);
    if (isSupabaseConfigured) {
      setSyncStatus("saving");
      void saveSlip(tipDay, historySlip, activeLeague?.id)
        .then(() => setSyncStatus("ready"))
        .catch((error) => {
          console.error("Failed to save slip", error);
          setSyncStatus("error");
        });
    }
    setSelectedResolveSlipId(historyId);
  }

  function toggleFinalPick(pickId: string) {
    const pick = picks.find((item) => item.id === pickId);
    if (!pick || !isPickBeforeKickoff(pick)) return;
    setDailySlip((slip) => {
      const exists = slip.pickIds.includes(pickId);
      return {
        ...slip,
        status: "draft",
        settlementStatus: "pending",
        profit: 0,
        generatedAt: new Date().toISOString(),
        pickIds: exists ? slip.pickIds.filter((id) => id !== pickId) : [...slip.pickIds, pickId]
      };
    });
  }

  function toggleFinalPickGroup(group: PickGroup) {
    const groupIds = group.picks.filter(isPickBeforeKickoff).map((pick) => pick.id);
    if (groupIds.length === 0) return;
    setDailySlip((slip) => {
      const allSelected = groupIds.every((id) => slip.pickIds.includes(id));
      const nextIds = allSelected
        ? slip.pickIds.filter((id) => !groupIds.includes(id))
        : [...slip.pickIds.filter((id) => !groupIds.includes(id)), ...groupIds];
      return {
        ...slip,
        status: "draft",
        settlementStatus: "pending",
        profit: 0,
        generatedAt: new Date().toISOString(),
        pickIds: nextIds
      };
    });
  }

  function setSlipMode(mode: DailySlip["mode"]) {
    setDailySlip((slip) => ({ ...slip, status: "draft", settlementStatus: "pending", profit: 0, mode, generatedAt: new Date().toISOString() }));
  }

  function setCombinedStake(value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    setDailySlip((slip) => ({ ...slip, status: "draft", settlementStatus: "pending", profit: 0, combinedStake: value, generatedAt: new Date().toISOString() }));
  }

  function setMultiplesStake(value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    setDailySlip((slip) => ({ ...slip, status: "draft", settlementStatus: "pending", profit: 0, multiplesStake: value, generatedAt: new Date().toISOString() }));
  }

  function updateSlipPickOdds(slipId: string, pickId: string, value: number) {
    if (!Number.isFinite(value) || value <= 1) return;
    const slip = slipHistory.find((item) => item.id === slipId);
    const basePick = picks.find((pick) => pick.id === pickId);
    if (!slip || !basePick) return;

    const affectedIds = new Set(
      slip.pickIds.filter((id) => {
        const pick = picks.find((item) => item.id === id);
        return pick ? isEquivalentSlipPick(pick, basePick) : false;
      })
    );
    if (affectedIds.size === 0) return;

    let recalculatedSlip: SlipHistoryItem | null = null;
    let recalculatedSlipPicks: Pick[] = [];
    const nextPicks = picks.map((pick) =>
      affectedIds.has(pick.id)
        ? { ...pick, odds: value, bookmaker: "Ajustado pelo streamer" }
        : pick
    );
    const recalculated = recalculateSlip(slip, nextPicks, votes);
    recalculatedSlip = recalculated.slip;
    recalculatedSlipPicks = recalculated.picks;
    const recalculatedPickMap = new Map(recalculatedSlipPicks.map((pick) => [pick.id, pick]));
    const nextPicksWithProfit = nextPicks.map((pick) => recalculatedPickMap.get(pick.id) ?? pick);
    const nextPickOverrides: Record<string, Partial<Pick>> = {};
    for (const pick of nextPicksWithProfit) {
      if (!affectedIds.has(pick.id)) continue;
      nextPickOverrides[pick.id] = {
        odds: pick.odds,
        profit: pick.profit,
        bookmaker: pick.bookmaker
      };
    }

    setPicks(nextPicksWithProfit);
    setLocalPickOverrides((current) => ({ ...current, ...nextPickOverrides }));
    setSlipHistory((current) => current.map((item) => (item.id === slipId && recalculatedSlip ? recalculatedSlip : item)));
    if (recalculatedSlip) {
      setLocalSlipOverrides((current) => ({
        ...current,
        [slipId]: { settlementStatus: recalculatedSlip!.settlementStatus, profit: recalculatedSlip!.profit }
      }));
    }
    if (slip.generatedAt === dailySlip.generatedAt && recalculatedSlip) {
      setDailySlip((current) => ({ ...current, settlementStatus: recalculatedSlip!.settlementStatus, profit: recalculatedSlip!.profit }));
    }
    if (isSupabaseConfigured) {
      setSyncStatus("saving");
      void Promise.all(Array.from(affectedIds).map((id) => updatePickOdds(id, value)))
        .then(() => recalculatedSlip ? saveSettlement(recalculatedSlip, recalculatedSlipPicks) : Promise.resolve())
        .then(() => setSyncStatus("ready"))
        .catch((error) => {
          console.error("Failed to update slip odds", error);
          setSyncStatus("error");
        });
    }
  }

  function settlePick(slipId: string, pickId: string, status: PickStatus) {
    const slip = slipHistory.find((item) => item.id === slipId);
    if (!slip) return;
    const nextPicks = picks.map((pick) => {
      if (pick.id !== pickId) return pick;
      const finalStake = slip.mode === "multiples" && slip.pickIds.includes(pickId) ? slip.multiplesStake : fixedViewerStake;
      return { ...pick, stake: fixedViewerStake, status, profit: calculateProfit(status, finalStake, pick.odds) };
    });
    const { slip: nextSlip, picks: slipPicks } = recalculateSlip(slip, nextPicks, votes);
    const recalculatedPickMap = new Map(slipPicks.map((pick) => [pick.id, pick]));
    const nextPicksWithProfit = nextPicks.map((pick) => recalculatedPickMap.get(pick.id) ?? pick);

    setPicks(nextPicksWithProfit);
    setSlipHistory((current) =>
      current.map((item) => (item.id === slipId ? nextSlip : item))
    );
    setLocalSlipOverrides((current) => ({ ...current, [slipId]: { settlementStatus: nextSlip.settlementStatus, profit: nextSlip.profit } }));
    if (slip.generatedAt === dailySlip.generatedAt) {
      setDailySlip((current) => ({ ...current, settlementStatus: nextSlip.settlementStatus, profit: nextSlip.profit }));
    }
    if (isSupabaseConfigured) {
      setSyncStatus("saving");
      void saveSettlement(nextSlip, slipPicks)
        .then(() => setSyncStatus("ready"))
        .catch((error) => {
          console.error("Failed to save settlement", error);
          setSyncStatus("error");
        });
    }
  }

  function settleCombinedSlip(slipId: string, status: PickStatus) {
    const slip = slipHistory.find((item) => item.id === slipId);
    if (!slip) return;
    const slipWithStatus = { ...slip, settlementStatus: status };
    const { slip: nextSlip, picks: slipPicks } = recalculateSlip(slipWithStatus, picks, votes);
    setSlipHistory((current) =>
      current.map((item) => (item.id === slipId ? nextSlip : item))
    );
    setLocalSlipOverrides((current) => ({ ...current, [slipId]: { settlementStatus: nextSlip.settlementStatus, profit: nextSlip.profit } }));
    if (slip.generatedAt === dailySlip.generatedAt) {
      setDailySlip((current) => ({ ...current, settlementStatus: nextSlip.settlementStatus, profit: nextSlip.profit }));
    }
    if (isSupabaseConfigured) {
      setSyncStatus("saving");
      void saveSettlement(nextSlip, slipPicks)
        .then(() => setSyncStatus("ready"))
        .catch((error) => {
          console.error("Failed to save combined settlement", error);
          setSyncStatus("error");
        });
    }
  }

  function settleStandalonePick(pickId: string, status: PickStatus) {
    if (!isPlatformAdmin) return;
    const targetPick = picks.find((pick) => pick.id === pickId);
    if (!targetPick) return;
    const profit = calculateProfit(status, fixedViewerStake, targetPick.odds);
    const nextPick = { ...targetPick, stake: fixedViewerStake, status, profit };
    setPicks((current) => current.map((pick) => pick.id === pickId ? nextPick : pick));
    setLocalPickOverrides((current) => ({ ...current, [pickId]: { stake: fixedViewerStake, status, profit } }));
    if (isSupabaseConfigured) {
      setSyncStatus("saving");
      void Promise.all([
        updatePickSettlement(pickId, status, profit),
        targetPick.stake !== fixedViewerStake ? updatePickStake(pickId, fixedViewerStake) : Promise.resolve()
      ])
        .then(() => setSyncStatus("ready"))
        .catch((error) => {
          console.error("Failed to classify pick", error);
          setSyncStatus("error");
        });
    }
  }

  function updateCommunityGroupOdds(group: PickGroup, value: number) {
    if (!isPlatformAdmin || !Number.isFinite(value) || value <= 1) return;
    const groupIds = new Set(group.picks.map((pick) => pick.id));
    const nextOverrides: Record<string, Partial<Pick>> = {};
    const nextPicks = picks.map((pick) => {
      if (!groupIds.has(pick.id)) return pick;
      const profit = pick.status === "pending" ? pick.profit : calculateProfit(pick.status, fixedViewerStake, value);
      nextOverrides[pick.id] = { odds: value, profit, bookmaker: "Ajustado pelo admin" };
      return { ...pick, odds: value, profit, bookmaker: "Ajustado pelo admin" };
    });
    setPicks(nextPicks);
    setLocalPickOverrides((current) => ({ ...current, ...nextOverrides }));
    if (isSupabaseConfigured) {
      setSyncStatus("saving");
      void Promise.all(group.picks.flatMap((pick) => {
        const nextProfit = pick.status === "pending" ? pick.profit : calculateProfit(pick.status, fixedViewerStake, value);
        return [
          updatePickOdds(pick.id, value),
          pick.status !== "pending" ? updatePickSettlement(pick.id, pick.status, nextProfit) : Promise.resolve()
        ];
      }))
        .then(() => setSyncStatus("ready"))
        .catch((error) => {
          console.error("Failed to update community odds", error);
          setSyncStatus("error");
        });
    }
  }

  function deleteCommunityPickGroup(group: PickGroup) {
    if (!isPlatformAdmin) return;
    const groupIds = new Set(group.picks.map((pick) => pick.id));
    setPicks((current) => current.filter((pick) => !groupIds.has(pick.id)));
    setVotes((current) => current.filter((voteItem) => !groupIds.has(voteItem.pickId)));
    setDailySlip((current) => ({ ...current, pickIds: current.pickIds.filter((pickId) => !groupIds.has(pickId)) }));
    setSlipHistory((current) => current.map((slip) => ({ ...slip, pickIds: slip.pickIds.filter((pickId) => !groupIds.has(pickId)) })));
    setLocalPickOverrides((current) => {
      const next = { ...current };
      groupIds.forEach((id) => {
        next[id] = null;
      });
      return next;
    });
    if (isSupabaseConfigured) {
      setSyncStatus("saving");
      void Promise.all(group.picks.map((pick) => deletePick(pick.id)))
        .then(() => setSyncStatus("ready"))
        .catch((error) => {
          console.error("Failed to delete community picks", error);
          setSyncStatus("error");
        });
    }
  }

  function confirmPendingSettlement() {
    if (!pendingSettlement) return;
    if (pendingSettlement.kind === "combined") {
      settleCombinedSlip(pendingSettlement.slipId, pendingSettlement.status);
    } else {
      settlePick(pendingSettlement.slipId, pendingSettlement.pickId, pendingSettlement.status);
    }
    setPendingSettlement(null);
    setPopup({
      title: "Aposta resolvida",
      body: "O resultado ficou guardado no historico. A aposta saiu da lista de pendentes."
    });
  }

  async function loginWithTwitch() {
    if (!supabase) return;
    setAuthStatus("loading");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "twitch",
      options: {
        redirectTo: getSiteUrl()
      }
    });
    if (error) {
      console.error("Twitch login failed", error);
      setAuthStatus("error");
    }
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    setIsLoggedIn(false);
    setAuthProfile(null);
    setTwitchAvatarUrl(null);
    setRemoteProfiles([]);
    setActiveUserId("u-serginho");
  }

  async function saveAvatarPreference(avatarUrl: string | null) {
    if (!authProfile) return;
    const cleanUrl = avatarUrl?.trim() || null;
    const nextProfile = { ...authProfile, avatarUrl: cleanUrl ?? undefined };
    const nextRemoteProfiles = remoteProfiles.map((profile) => profile.id === authProfile.id ? { ...profile, avatarUrl: cleanUrl ?? undefined } : profile);
    setAuthProfile(nextProfile);
    setRemoteProfiles(nextRemoteProfiles);
    if (isSupabaseConfigured) {
      setSyncStatus("saving");
      try {
        await updateProfileAvatar(authProfile.id, cleanUrl);
        setSyncStatus("ready");
      } catch (error) {
        console.error("Failed to update avatar", error);
        setSyncStatus("error");
      }
    }
  }

  function renderPickGroupCard(group: PickGroup) {
    const pick = group.representative;
    const match = matches.find((item) => item.id === pick.matchId);
    const selected = group.picks.every((groupPick) => dailySlip.pickIds.includes(groupPick.id));
    const canVote = group.picks.some((groupPick) => groupPick.userId !== activeUserId);
    const activeVoteTypes = new Set(
      votes
        .filter((voteItem) => voteItem.userId === activeUserId && group.picks.some((groupPick) => groupPick.id === voteItem.pickId))
        .map((voteItem) => voteItem.type)
    );
    const uniqueReasons = group.picks
      .filter((groupPick) => groupPick.reason.trim() && !normalizeFilterText(groupPick.reason).startsWith("sem justificacao"))
      .map((groupPick) => ({ pick: groupPick, author: userById(groupPick.userId) }));

    return (
      <article className={`pick-card ${selected ? "final" : ""}`} key={group.key}>
        <div className="pick-header">
          <div className="author">
            <Avatar user={group.authors[0]} />
            <div>
              <strong>{pick.selection}</strong>
              <span>{pick.marketType} · {group.picks.length} tips · {group.authors.length} pessoas</span>
            </div>
          </div>
          {match ? (
            <div className="pick-match-card" aria-label={`${match.homeTeam} contra ${match.awayTeam}`}>
              <div>
                <TeamLogo src={match.homeLogoUrl} name={match.homeTeam} />
                <strong>{match.homeTeam}</strong>
              </div>
              <span>vs</span>
              <div>
                <TeamLogo src={match.awayLogoUrl} name={match.awayTeam} />
                <strong>{match.awayTeam}</strong>
              </div>
            </div>
          ) : null}
          <div className="pick-header-actions">
            <div className="score-badge" aria-label={`Score ${group.score}`}>
              <span>Score</span>
              <strong>{group.score}</strong>
            </div>
            <div className={`status ${pick.status}`}>{selected ? "Final" : statusLabel(pick.status)}</div>
          </div>
        </div>
        <div className="pick-body">
          <div className="group-authors">
            {group.authors.map((author) => (
              <span key={author.id}>
                <Avatar user={author} />
                {author.displayName}
              </span>
            ))}
          </div>
          {uniqueReasons.length > 0 ? (
            <div className="group-reasons">
              {uniqueReasons.map(({ pick: reasonPick, author }) => (
                <blockquote key={reasonPick.id}>
                  <strong>{author.displayName}</strong>
                  <span>{reasonPick.reason}</span>
                </blockquote>
              ))}
            </div>
          ) : (
            <p>Sem justificação.</p>
          )}
        </div>
        <div className="pick-meta">
          <span>@{pick.odds.toFixed(2)}</span>
          <span>{roundUnits(group.picks.reduce((total, groupPick) => total + groupPick.stake, 0))}u sugeridas</span>
        </div>
        {isPlatformAdmin ? (
          <div className="community-admin-actions">
            <label className="settlement-odd-field">
              Odd
              <input
                type="number"
                step="0.01"
                min="1.01"
                value={pick.odds}
                onChange={(event) => updateCommunityGroupOdds(group, Number(event.target.value))}
              />
            </label>
            <button className="danger-action" onClick={() => deleteCommunityPickGroup(group)}>Eliminar</button>
          </div>
        ) : null}
        <div className="vote-row">
          <button className={activeVoteTypes.has("trust") ? "selected" : ""} onClick={() => castGroupVote(group, "trust")} disabled={!canVote}>
            <ThumbsUp size={16} />
            Confio
          </button>
          <button className={activeVoteTypes.has("doubt") ? "selected" : ""} onClick={() => castGroupVote(group, "doubt")} disabled={!canVote}>
            <ThumbsDown size={16} />
            Não confio
          </button>
          <button className={activeVoteTypes.has("strong") ? "selected" : ""} onClick={() => castGroupVote(group, "strong")} disabled={!canVote}>
            <Flame size={16} />
            Forte
          </button>
          {isStreamer ? (
            <button className="streamer-action" onClick={() => toggleFinalPickGroup(group)}>
              <ShieldCheck size={16} />
              {selected ? "Remover final" : "Escolher final"}
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  if (isOverlayRoute) {
    return (
      <OverlayPage
        slip={dailySlip}
        picks={topSlipPickGroups.map((group) => group.representative)}
        matches={matches}
        combinedOdds={combinedOdds}
        multiplesStake={multiplesStake}
        syncStatus={syncStatus}
      />
    );
  }

  if (!isLoggedIn) {
    return (
      <main className="login-screen">
        <section className="login-hero">
          <div className="brand-mark app-icon large">
            <img src="/serginhobet-icon.svg" alt="" />
          </div>
          <h1>SerginhoBet</h1>
          <span className="login-league-badge">Liga {activeLeague?.code ?? defaultLeagueCode}</span>
          <p>Entra obrigatoriamente com Twitch para sugerir, votar e acompanhar a aposta da comunidade.</p>
          <div className="login-choice-grid">
            <button onClick={loginWithTwitch} disabled={!isSupabaseConfigured || authStatus === "loading"}>
              <LogIn size={22} />
              Entrar com Twitch
            </button>
          </div>
          {!isSupabaseConfigured ? (
            <p className="login-warning">Configura NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY no Vercel para ativar o login Twitch.</p>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark app-icon">
            <img src="/serginhobet-icon.svg" alt="" />
          </div>
          <div>
            <h1>SerginhoBet</h1>
            <p>Tips de futebol por dia, comunidade Twitch e banca fictícia coletiva</p>
          </div>
        </div>

        <div className="login-panel">
          <div className="page-tabs">
            <button className={activePage === "games" ? "active" : ""} onClick={() => setActivePage("games")}>Jogos</button>
            <button className={activePage === "community" ? "active" : ""} onClick={() => setActivePage("community")}>Comunidade</button>
            {!isStreamer ? <button className={activePage === "viewer" ? "active" : ""} onClick={() => setActivePage("viewer")}>Minhas apostas</button> : null}
            {isStreamer ? <button className={activePage === "resolve" ? "active" : ""} onClick={() => setActivePage("resolve")}>Resolver</button> : null}
            {isPlatformAdmin ? <button className={activePage === "admin" ? "active" : ""} onClick={() => setActivePage("admin")}>Admin</button> : null}
            <button className={activePage === "history" ? "active" : ""} onClick={() => setActivePage("history")}>Histórico</button>
            <button className={activePage === "stats" ? "active" : ""} onClick={() => setActivePage("stats")}>Estatísticas</button>
          </div>
          <button className="topbar-account" onClick={() => setActivePage("profile")} aria-label="Abrir perfil">
            <Avatar user={activeUser} />
            <span>{activeUser.displayName}</span>
          </button>
          <span className="league-pill">{activeLeague?.code ?? defaultLeagueCode}</span>
          <button className="logout-button" onClick={logout}>Sair</button>
        </div>
      </header>

      {activePage === "games" ? (
        <section className="games-page">
          <section className="panel games-center">
            <div className="section-title spread games-toolbar">
              <div><CalendarDays size={18} /><h3>Jogos de hoje e amanhã</h3></div>
              <div className="games-actions">
                <label className="match-search-field">
                  <span>Pesquisar</span>
                  <input
                    value={matchSearch}
                    onChange={(event) => setMatchSearch(event.target.value)}
                    placeholder="Equipa ou campeonato"
                    aria-label="Pesquisar equipa ou campeonato"
                  />
                </label>
                <select value={competitionFilter} onChange={(event) => setCompetitionFilter(event.target.value)} aria-label="Filtrar competição">
                  {competitionOptions.map((competition) => (
                    <option key={competition} value={competition}>
                      {competition === "all" ? "Todas as competições" : formatCompetitionFilterLabel(competition)}
                    </option>
                  ))}
                </select>
                <span className={`sync-chip ${matchSync}`}>
                  <RefreshCw size={15} />
                  {matchSync === "loading" ? "A sincronizar" : null}
                  {matchSync === "live" ? `${visibleMatches.length}/${scheduledMatches.length} jogos` : null}
                  {matchSync === "empty" ? "Sem jogos reais hoje" : null}
                </span>
                {isStreamer ? (
                  <button className="secondary" onClick={publishSlip}>
                    <CheckCircle2 size={16} />
                    Publicar finais
                  </button>
                ) : null}
                <button className="ghost" onClick={() => syncTodayMatches(true)}>
                  <RefreshCw size={16} />
                  Atualizar
                </button>
              </div>
            </div>
            <div className="games-grid">
              {visibleMatches.map((match) => (
                <article
                  className={`game-card ${match.id === selectedMatch?.id ? "selected" : ""}`}
                  key={match.id}
                  onClick={() => setSelectedMatchId(match.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelectedMatchId(match.id);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="game-competition">{formatMatchCompetition(match)}</span>
                  <div className="teams-line">
                    <div className="team-side"><TeamLogo src={match.homeLogoUrl} name={match.homeTeam} /><strong>{match.homeTeam}</strong></div>
                    <span className="versus">vs</span>
                    <div className="team-side away"><TeamLogo src={match.awayLogoUrl} name={match.awayTeam} /><strong>{match.awayTeam}</strong></div>
                  </div>
                  <small>
                    {formatKickoff(match.startsAt)} · {matchStatusLabel(match)}
                  </small>
                  <button
                    className="game-tip-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedMatchId(match.id);
                      setTipModalMatchId(match.id);
                    }}
                  >
                    Criar tip
                  </button>
                </article>
              ))}
            </div>
            {visibleMatches.length === 0 ? (
              <p className="empty-copy">Não há jogos agendados que ainda não tenham começado neste filtro. Muda a competição ou atualiza a lista.</p>
            ) : null}
          </section>

          <section className="panel match-detail">
            {selectedMatch ? (
              <>
                <div className="detail-scoreboard">
                  <div><TeamLogo src={selectedMatch.homeLogoUrl} name={selectedMatch.homeTeam} /><strong>{selectedMatch.homeTeam}</strong></div>
                  <span>vs</span>
                  <div><TeamLogo src={selectedMatch.awayLogoUrl} name={selectedMatch.awayTeam} /><strong>{selectedMatch.awayTeam}</strong></div>
                </div>
                <div className="detail-facts">
                  <span>Competição <b>{formatMatchCompetition(selectedMatch)}</b></span>
                  <span>Hora <b>{formatKickoff(selectedMatch.startsAt)}</b></span>
                  <span>Local <b>{selectedMatch.venue ?? "Sem estádio na API"}</b></span>
                  <span>Forma casa <b>{selectedMatch.homeRecord ?? "Sem histórico"}</b></span>
                  <span>Forma fora <b>{selectedMatch.awayRecord ?? "Sem histórico"}</b></span>
                  <span>Tips neste jogo <b>{selectedMatchPicks.length}</b></span>
                </div>
                <button className="detail-tip-button" onClick={() => setTipModalMatchId(selectedMatch.id)}>
                  <Vote size={16} />
                  Criar tip neste jogo
                </button>
                <div className="mini-picks">
                  {selectedMatchPickGroups.slice(0, 3).map(renderPickGroupCard)}
                  {selectedMatchPicks.length === 0 ? <p className="empty-copy">Abre este jogo e lança a primeira tip da comunidade.</p> : null}
                </div>
              </>
            ) : (
              <p className="empty-copy">Seleciona um jogo de hoje para abrir os detalhes e criar uma tip.</p>
            )}
          </section>
        </section>
      ) : null}

      {activePage === "community" ? (
        <section className="community-page">
          <section className="panel community-feed">
            <div className="section-title spread">
              <div><Vote size={18} /><h3>Tips da comunidade</h3></div>
              <span>{communityPickGroups.length} grupos · {filteredCommunityPicks.length}/{communityPicks.length} tips</span>
            </div>
            <div className="community-filters">
              <label className="match-search-field">
                <span>Jogo</span>
                <input
                  value={communityMatchSearch}
                  onChange={(event) => setCommunityMatchSearch(event.target.value)}
                  placeholder="Pesquisar equipa ou competição"
                  aria-label="Pesquisar jogo na comunidade"
                />
              </label>
              <select value={communityMatchFilter} onChange={(event) => setCommunityMatchFilter(event.target.value)} aria-label="Filtrar tips por jogo">
                <option value="all">Todos os jogos</option>
                {communityMatchOptions.map((match) => (
                  <option value={match.id} key={match.id}>
                    {match.homeTeam} vs {match.awayTeam}
                  </option>
                ))}
              </select>
              <div className="community-sort-toggle" aria-label="Ordenar tips da comunidade">
                <button className={communitySortMode === "recent" ? "active" : ""} onClick={() => setCommunitySortMode("recent")}>Recentes</button>
                <button className={communitySortMode === "score" ? "active" : ""} onClick={() => setCommunitySortMode("score")}>Score</button>
              </div>
            </div>
            <div className="pick-stack">
              {communitySections.map((section) => (
                <section className="community-day-section" key={section.day}>
                  <div className="community-day-heading">
                    <h4>{formatCommunityDayLabel(section.day)}</h4>
                    <span>{section.groups.length} grupos</span>
                  </div>
                  {section.groups.map(renderPickGroupCard)}
                </section>
              ))}
              {communityPicks.length === 0 ? <p className="empty-copy">Ainda não existem tips. Vai à aba Jogos, abre um jogo e cria a primeira.</p> : null}
              {communityPicks.length > 0 && filteredCommunityPicks.length === 0 ? <p className="empty-copy">Não há tips para esse filtro de jogo.</p> : null}
            </div>
          </section>

          <aside className="side-column">
            {isStreamer ? (
              <section className="panel streamer-control">
                <div className="section-title spread">
                  <div><Sparkles size={18} /><h3>Painel streamer</h3></div>
                  <span>{dailySlip.pickIds.length} finais</span>
                </div>
                <div className="control-actions">
                  <button onClick={generateSlip}><Sparkles size={16} />Preencher por votos</button>
                  <button className="secondary" onClick={publishSlip}><CheckCircle2 size={16} />Publicar finais</button>
                </div>
                <div className="slip-mode-toggle" aria-label="Tipo de boletim">
                  <button className={dailySlip.mode === "combined" ? "active" : ""} onClick={() => setSlipMode("combined")}>
                    Combinada
                  </button>
                  <button className={dailySlip.mode === "multiples" ? "active" : ""} onClick={() => setSlipMode("multiples")}>
                    Múltiplas
                  </button>
                </div>
                {dailySlip.mode === "combined" ? (
                  <label className="combined-stake-field">
                    Stake da combinada (all-in)
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={allInStakePreview}
                      readOnly
                    />
                  </label>
                ) : (
                  <label className="combined-stake-field">
                    Stake por múltipla
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={allInMultiplesUnitStake}
                      readOnly
                    />
                  </label>
                )}
                <div className="candidate-list final-only-list">
                  {visibleTopSlipPickGroups.map((group) => {
                    const pick = group.representative;
                    const match = matches.find((item) => item.id === pick.matchId);
                    return (
                      <div className="candidate-row selected" key={group.key}>
                        <div>
                          <strong>{pick.selection}</strong>
                          <small>{group.authors.map((author) => author.displayName).join(", ")} · {match?.homeTeam} vs {match?.awayTeam} · Score {group.score}</small>
                        </div>
                        <button onClick={() => toggleFinalPickGroup(group)}>Remover</button>
                      </div>
                    );
                  })}
                  {visibleTopSlipPicks.length === 0 ? (
                    <p className="empty-copy">Ainda nÃ£o existem picks finais. Usa "Preencher por votos" ou escolhe uma tip na lista da comunidade.</p>
                  ) : null}
                </div>
              </section>
            ) : null}
            {showCommunitySlipPanel ? (
              <SlipPanel
                picks={visibleTopSlipPickGroups.map((group) => group.representative)}
                matches={matches}
                combinedOdds={visibleCombinedOdds}
                combinedStake={isPublishedSlip ? dailySlip.combinedStake : allInStakePreview}
                multiplesUnitStake={isPublishedSlip ? dailySlip.multiplesStake : allInMultiplesUnitStake}
                multiplesStake={isPublishedSlip ? visibleMultiplesStake : allInStakePreview}
                mode={dailySlip.mode}
                status={dailySlip.status}
              />
            ) : null}
            <BankPanel bankroll={communityBankroll} />
          </aside>
        </section>
      ) : null}

      {activePage === "viewer" && !isStreamer ? (
        <ViewerBetsPage
          user={activeUser}
          picks={picks.filter((pick) => pick.userId === activeUserId)}
          allPicks={picks}
          finalPicks={topSlipPicks}
          matches={matches}
          dailySlip={dailySlip}
          slipHistory={slipHistory}
          combinedOdds={combinedOdds}
          multiplesStake={multiplesStake}
          votes={votes}
        />
      ) : null}

      {activePage === "resolve" && isStreamer ? (
        <ResolvePage
          selectedSlip={selectedResolveSlip}
          slipHistory={resolvableSlipHistory}
          picks={selectedResolvePicks}
          matches={matches}
          combinedOdds={selectedResolveCombinedOdds}
          selectedSlipId={selectedResolveSlipId}
          onSelectSlip={setSelectedResolveSlipId}
          onUpdateOdd={updateSlipPickOdds}
          onSettlePick={(slipId, pickId, status) => setPendingSettlement({ kind: "pick", slipId, pickId, status })}
          onSettleCombined={(slipId, status) => setPendingSettlement({ kind: "combined", slipId, status })}
        />
      ) : null}

      {activePage === "history" ? (
        <HistoryPage
          user={activeUser}
          isStreamer={isStreamer}
          canEditOdds={isStreamer || isPlatformAdmin}
          allPicks={picks}
          matches={matches}
          slipHistory={slipHistory}
          votes={votes}
          onUpdateOdd={isStreamer || isPlatformAdmin ? updateSlipPickOdds : undefined}
        />
      ) : null}

      {activePage === "admin" && isPlatformAdmin ? (
        <AdminClassifyPage
          picks={picks}
          matches={matches}
          slipHistory={slipHistory}
          votes={votes}
          onSettlePick={settleStandalonePick}
        />
      ) : null}

      {activePage === "stats" ? (
        <StatsDashboard
          dayScope={displayedDayScope}
          monthScope={monthScope}
          allTimeScope={allTimeScope}
          dayTimeline={displayedProfitTimeline}
          monthTimeline={monthProfitTimeline}
          allTimeTimeline={allTimeProfitTimeline}
          monthlyLeaderboard={leaderboard}
          generalLeaderboard={generalLeaderboard}
          bankroll={communityBankroll}
          monthName={monthName}
        />
      ) : null}

      {activePage === "profile" ? (
        <ProfilePage
          user={activeUser}
          twitchAvatarUrl={twitchAvatarUrl}
          picks={allStoredPicks.filter((pick) => pick.userId === activeUserId)}
          finalPickIds={new Set(allStoredSlips.flatMap((slip) => slip.pickIds))}
          slipHistory={allStoredSlips}
          monthName={monthName}
          monthKey={monthKey}
          onSaveAvatar={saveAvatarPreference}
        />
      ) : null}

      <footer className="disclaimer">
        <UserRound size={16} />
        Unidades fictícias. Sem dinheiro real, depósitos, cashout ou execução de apostas.
      </footer>
      {tipModalMatch ? (
        <TipModal
          formState={formState}
          selectedMatch={tipModalMatch}
          matchOdds={tipModalOdds}
          activeUser={activeUser}
          onSubmit={submitPick}
          onChange={setFormState}
          onClose={() => setTipModalMatchId(null)}
        />
      ) : null}
      {pendingSettlement ? (
        <ConfirmSettlementPopup
          status={pendingSettlement.status}
          onCancel={() => setPendingSettlement(null)}
          onConfirm={confirmPendingSettlement}
        />
      ) : null}
      {popup ? <AppPopup title={popup.title} body={popup.body} onClose={() => setPopup(null)} /> : null}
    </main>
  );
}

function AppPopup({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return (
    <div className="popup-backdrop" role="dialog" aria-modal="true" aria-labelledby="popup-title">
      <section className="popup-card">
        <div className="brand-mark">
          <CheckCircle2 size={22} />
        </div>
        <div>
          <h3 id="popup-title">{title}</h3>
          <p>{body}</p>
        </div>
        <button onClick={onClose}>OK</button>
      </section>
    </div>
  );
}

function ConfirmSettlementPopup({
  status,
  onCancel,
  onConfirm
}: {
  status: PickStatus;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="popup-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-settlement-title">
      <section className="popup-card confirm-card">
        <div className="brand-mark">
          <ShieldCheck size={22} />
        </div>
        <div>
          <h3 id="confirm-settlement-title">Confirmar resolução</h3>
          <p>Vais marcar esta aposta como <b>{statusLabel(status)}</b>. Confirma se o resultado está correto antes de guardar.</p>
        </div>
        <div className="confirm-actions">
          <button className="ghost" onClick={onCancel}>Cancelar</button>
          <button onClick={onConfirm}>Confirmar</button>
        </div>
      </section>
    </div>
  );
}

function TipModal({
  formState,
  selectedMatch,
  matchOdds,
  activeUser,
  onSubmit,
  onChange,
  onClose
}: {
  formState: { marketType: MarketType; selection: string; odds: string; stake: string; bookmaker: string; reason: string };
  selectedMatch: Match;
  matchOdds: MatchOdd[];
  activeUser: User;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: React.Dispatch<React.SetStateAction<{ marketType: MarketType; selection: string; odds: string; stake: string; bookmaker: string; reason: string }>>;
  onClose: () => void;
}) {
  return (
    <div className="popup-backdrop" role="dialog" aria-modal="true" aria-labelledby="tip-modal-title">
      <section className="tip-modal-card">
        <div className="tip-modal-header">
          <div>
            <span>{formatMatchCompetition(selectedMatch)}</span>
            <h3 id="tip-modal-title">{selectedMatch.homeTeam} vs {selectedMatch.awayTeam}</h3>
            <p>{formatKickoff(selectedMatch.startsAt)}</p>
          </div>
          <button type="button" onClick={onClose}>Fechar</button>
        </div>
        <TipForm
          formState={formState}
          selectedMatch={selectedMatch}
          matchOdds={matchOdds}
          activeUser={activeUser}
          onSubmit={onSubmit}
          onChange={onChange}
        />
      </section>
    </div>
  );
}

function ProfilePage({
  user,
  twitchAvatarUrl,
  picks,
  finalPickIds,
  slipHistory,
  monthName,
  monthKey,
  onSaveAvatar
}: {
  user: User;
  twitchAvatarUrl: string | null;
  picks: Pick[];
  finalPickIds: Set<string>;
  slipHistory: SlipHistoryItem[];
  monthName: string;
  monthKey: string;
  onSaveAvatar: (avatarUrl: string | null) => Promise<void>;
}) {
  const [avatarInput, setAvatarInput] = useState(user.avatarUrl ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const userPickIds = new Set(picks.map((pick) => pick.id));

  useEffect(() => {
    setAvatarInput(user.avatarUrl ?? "");
  }, [user.avatarUrl]);

  function buildPersonalStats(filter: (value: string) => boolean) {
    const scopedPicks = picks.filter((pick) => filter(pick.createdAt));
    const settledPicks = scopedPicks.filter((pick) => pick.status !== "pending");
    const settledSlipShares = slipHistory
      .filter((slip) => slip.mode === "combined" && slip.settlementStatus !== "pending" && filter(slip.publishedAt))
      .reduce((total, slip) => {
        const userSelections = slip.pickIds.filter((pickId) => userPickIds.has(pickId)).length;
        if (userSelections === 0 || slip.pickIds.length === 0) return total;
        return total + (slip.profit / slip.pickIds.length) * userSelections;
      }, 0);
    const individualProfit = settledPicks.reduce((total, pick) => total + pick.profit, 0);
    const stake = settledPicks.reduce((total, pick) => total + pick.stake, 0);
    const won = settledPicks.filter((pick) => pick.status === "won" || pick.status === "half_won").length;

    return {
      submitted: scopedPicks.length,
      finals: scopedPicks.filter((pick) => finalPickIds.has(pick.id)).length,
      resolved: settledPicks.length,
      pending: scopedPicks.length - settledPicks.length,
      profit: roundUnits(individualProfit + settledSlipShares),
      roi: stake > 0 ? roundUnits(((individualProfit + settledSlipShares) / stake) * 100) : 0,
      winrate: settledPicks.length > 0 ? Math.round((won / settledPicks.length) * 100) : 0
    };
  }

  async function handleAvatarSave(nextUrl: string | null) {
    setIsSaving(true);
    await onSaveAvatar(nextUrl);
    setIsSaving(false);
  }

  const monthStats = buildPersonalStats((value) => value.slice(0, 7) === monthKey);
  const allStats = buildPersonalStats(() => true);
  const avatarPreview = avatarInput.trim() || user.avatarUrl || twitchAvatarUrl || "";

  return (
    <section className="profile-page">
      <section className="panel profile-card">
        <div className="section-title spread">
          <div><UserRound size={18} /><h3>Perfil</h3></div>
          <span>{user.role}</span>
        </div>
        <div className="profile-hero">
          <div className="profile-avatar-frame">
            {avatarPreview ? <img src={avatarPreview} alt={`Avatar ${user.displayName}`} /> : <Avatar user={user} />}
          </div>
          <div>
            <h2>{user.displayName}</h2>
            <p>Avatar e estatísticas pessoais da tua conta Twitch.</p>
          </div>
        </div>
        <label className="profile-avatar-field">
          URL do avatar
          <input
            value={avatarInput}
            onChange={(event) => setAvatarInput(event.target.value)}
            placeholder="https://..."
          />
        </label>
        <div className="profile-actions">
          <button onClick={() => handleAvatarSave(avatarInput)} disabled={isSaving}>
            <Camera size={16} />
            {isSaving ? "A guardar" : "Guardar avatar"}
          </button>
          <button className="ghost" onClick={() => handleAvatarSave(twitchAvatarUrl)} disabled={!twitchAvatarUrl || isSaving}>
            Usar Twitch
          </button>
          <button className="ghost" onClick={() => handleAvatarSave(null)} disabled={isSaving}>
            Remover
          </button>
        </div>
      </section>

      <section className="panel profile-stats-card">
        <div className="section-title spread">
          <div><LineChart size={18} /><h3>As minhas estatísticas</h3></div>
          <span>{monthName}</span>
        </div>
        <div className="profile-stats-grid">
          <span>Tips este mês <b>{monthStats.submitted}</b></span>
          <span>Nas finais <b>{monthStats.finals}</b></span>
          <span>Pendentes <b>{monthStats.pending}</b></span>
          <span>Resolvidas <b>{monthStats.resolved}</b></span>
          <span>Winrate <b>{monthStats.winrate}%</b></span>
          <span>ROI <b>{monthStats.roi.toFixed(1)}%</b></span>
          <span>Lucro mensal <b>{monthStats.profit >= 0 ? "+" : ""}{monthStats.profit.toFixed(2)}u</b></span>
          <span>Lucro geral <b>{allStats.profit >= 0 ? "+" : ""}{allStats.profit.toFixed(2)}u</b></span>
        </div>
      </section>
    </section>
  );
}

function ViewerBetsPage({
  user,
  picks,
  allPicks,
  finalPicks,
  matches,
  dailySlip,
  slipHistory,
  combinedOdds,
  multiplesStake,
  votes
}: {
  user: User;
  picks: Pick[];
  allPicks: Pick[];
  finalPicks: Pick[];
  matches: Match[];
  dailySlip: DailySlip;
  slipHistory: SlipHistoryItem[];
  combinedOdds: number;
  multiplesStake: number;
  votes: VoteRecord[];
}) {
  const finalPickIds = new Set(finalPicks.map((pick) => pick.id));
  const userFinalPicks = finalPicks.filter((pick) => pick.userId === user.id);
  const isPublished = dailySlip.status === "published" && finalPicks.length > 0;
  const combinedShare = userFinalPicks.length > 0 && finalPicks.length > 0
    ? {
        stake: roundUnits((dailySlip.combinedStake / finalPicks.length) * userFinalPicks.length),
        profit: roundUnits((dailySlip.profit / finalPicks.length) * userFinalPicks.length)
      }
    : { stake: 0, profit: 0 };
  const userSettledPicks = picks.filter((pick) => pick.status !== "pending");
  const userProfit = dailySlip.mode === "combined" && isPublished && dailySlip.settlementStatus !== "pending"
    ? combinedShare.profit
    : roundUnits(userSettledPicks.reduce((total, pick) => total + pick.profit, 0));
  const userStake = dailySlip.mode === "combined" && isPublished && dailySlip.settlementStatus !== "pending"
    ? combinedShare.stake
    : roundUnits(userSettledPicks.reduce((total, pick) => total + pick.stake, 0));
  const userRoi = userStake > 0 ? roundUnits((userProfit / userStake) * 100) : 0;
  const slipModeLabel = dailySlip.mode === "combined" ? "Combinada" : "Multiplas";
  const slipStake = dailySlip.mode === "combined" ? dailySlip.combinedStake : multiplesStake;
  const resolvedPicks = picks
    .filter((pick) => pick.status !== "pending")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const isSettledSlip = isPublished && dailySlip.settlementStatus !== "pending";
  const finalGamesStillOpen = isPublished && finalPicks.every((pick) => {
    const match = matches.find((item) => item.id === pick.matchId);
    return Boolean(match) && match?.status === "scheduled" && new Date(match.startsAt).getTime() > Date.now();
  });
  const isOpenSlip = isPublished && dailySlip.settlementStatus === "pending" && finalGamesStillOpen;
  const viewerSlipTitle = isSettledSlip ? "Ultima aposta" : isOpenSlip ? "Aposta aberta" : "Aposta da comunidade";
  const publishedStatusLabel = isPublished
    ? isOpenSlip
      ? "Aberta"
      : statusLabel(dailySlip.settlementStatus)
    : "Ainda nao registada";
  const viewerSlipStateTitle = isPublished
    ? isSettledSlip
      ? "Ultima aposta publicada pelo SerginhoEsteves"
      : isOpenSlip
        ? "Boletim aberto para a comunidade"
        : "Boletim publicado pelo SerginhoEsteves"
    : "O streamer ainda nao publicou a aposta final";
  const viewerSlipStateCopy = isPublished
    ? isSettledSlip
      ? `${slipModeLabel} resolvida como ${statusLabel(dailySlip.settlementStatus).toLowerCase()} com ${finalPicks.length} tips finais.`
      : isOpenSlip
        ? `${slipModeLabel} com ${finalPicks.length} tips finais. Os jogos ainda nao comecaram e a comunidade ainda pode acompanhar a aposta.`
        : `${slipModeLabel} com ${finalPicks.length} tips finais.`
    : "Quando for publicado, aparece aqui o tipo de aposta, stake, odd e as tuas tips escolhidas.";
  const [expandedSlipIds, setExpandedSlipIds] = useState<Set<string>>(() => new Set());

  function toggleExpandedSlip(slipId: string) {
    setExpandedSlipIds((current) => {
      const next = new Set(current);
      if (next.has(slipId)) next.delete(slipId);
      else next.add(slipId);
      return next;
    });
  }

  function renderSlipDetailList(slip: SlipHistoryItem) {
    return (
      <div className="slip-detail-list">
        {slip.pickIds.map((pickId, index) => {
          const pick = allPicks.find((item) => item.id === pickId);
          if (!pick) {
            return (
              <div className="slip-detail-row" key={pickId}>
                <span>{index + 1}</span>
                <div>
                  <strong>Pick indisponivel</strong>
                  <small>ID {pickId}</small>
                </div>
              </div>
            );
          }
          const match = matches.find((item) => item.id === pick.matchId);
          const author = userById(pick.userId);
          return (
            <div className="slip-detail-row" key={pick.id}>
              <span>{index + 1}</span>
              <div>
                <strong>{pick.selection}</strong>
                <small>{author.displayName} - @{pick.odds.toFixed(2)} - Score {scorePick(pick.id, votes)}</small>
              </div>
              <MatchMiniCard match={match} />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className="viewer-bets-page">
      <section className="panel viewer-slip-panel">
        <div className="section-title spread">
          <div><ShieldCheck size={18} /><h3>{viewerSlipTitle}</h3></div>
          <span>{publishedStatusLabel}</span>
        </div>
        <div className={`viewer-slip-state ${isPublished ? "published" : "draft"} ${isOpenSlip ? "open" : ""} ${isSettledSlip ? "settled" : ""}`}>
          <strong>{viewerSlipStateTitle}</strong>
          <p>{viewerSlipStateCopy}</p>
        </div>
        <div className="viewer-slip-metrics">
          <span>Tipo <b>{slipModeLabel}</b></span>
          <span>Stake <b>{isPublished ? `${slipStake.toFixed(2)}u` : "0.00u"}</b></span>
          <span>Odd combinada <b>{dailySlip.mode === "combined" && isPublished ? combinedOdds.toFixed(2) : "-"}</b></span>
          <span>Estado <b>{isPublished ? statusLabel(dailySlip.mode === "combined" ? dailySlip.settlementStatus : "pending") : "Draft"}</b></span>
        </div>
        <div className="viewer-final-list">
          {isPublished ? (
            <div className="viewer-final-expanded">
              <div className="viewer-final-heading">
                <strong>Jogos do boletim</strong>
                <span>{finalPicks.length}</span>
              </div>
                {finalPicks.map((pick, index) => {
                  const match = matches.find((item) => item.id === pick.matchId);
                  const author = userById(pick.userId);
                  return (
                    <article className="viewer-final-card" key={pick.id}>
                      <small>#{index + 1} - {author.displayName}</small>
                      <strong>{pick.selection}</strong>
                      <MatchMiniCard match={match} />
                      <small>@{pick.odds.toFixed(2)} - Score {scorePick(pick.id, votes)}</small>
                    </article>
                  );
                })}
            </div>
          ) : null}
          {false ? userFinalPicks.map((pick) => {
            const match = matches.find((item) => item.id === pick.matchId);
            return (
              <article className="viewer-final-card" key={pick.id}>
                <strong>{pick.selection}</strong>
                <MatchMiniCard match={match} />
                <small>@{pick.odds.toFixed(2)} · Score {scorePick(pick.id, votes)}</small>
              </article>
            );
          }) : null}
          {isPublished && userFinalPicks.length === 0 ? <p className="empty-copy">Nenhuma das tuas tips entrou na aposta final de hoje.</p> : null}
          {!isPublished ? <p className="empty-copy">Aposta ainda por registar. Continua a submeter e votar tips na comunidade.</p> : null}
        </div>
      </section>

      {false ? <section className="panel viewer-history-panel">
        <div className="section-title spread">
          <div><LineChart size={18} /><h3>O meu historico</h3></div>
          <span>{picks.length} tips</span>
        </div>
        <div className="viewer-slip-metrics">
          <span>Submetidas <b>{picks.length}</b></span>
          <span>Nas finais <b>{picks.filter((pick) => finalPickIds.has(pick.id)).length}</b></span>
          <span>Lucro <b>{userProfit >= 0 ? "+" : ""}{userProfit.toFixed(2)}u</b></span>
          <span>ROI <b>{userRoi.toFixed(1)}%</b></span>
        </div>
        <div className="viewer-history-list">
          {slipHistory.map((slip, index) => (
            <article className="slip-history-card" key={slip.id}>
              <button className="viewer-history-row slip-history-row slip-expand-toggle" onClick={() => toggleExpandedSlip(slip.id)}>
                <div>
                  <strong>Boletim publicado #{slipHistory.length - index}</strong>
                  <span>{formatSlipDateTime(slip.publishedAt)} - {slip.mode === "combined" ? "Combinada" : "Multiplas"} com {slip.pickIds.length} picks</span>
                </div>
                <small>{slip.mode === "combined" ? `${slip.combinedStake.toFixed(2)}u` : `${(slip.multiplesStake * slip.pickIds.length).toFixed(2)}u`}</small>
                <div className={`status ${slip.settlementStatus}`}>{statusLabel(slip.settlementStatus)}</div>
                <b>{expandedSlipIds.has(slip.id) ? "Esconder" : `${slip.profit >= 0 ? "+" : ""}${slip.profit.toFixed(2)}u`}</b>
              </button>
              {expandedSlipIds.has(slip.id) ? renderSlipDetailList(slip) : null}
            </article>
          ))}
          {resolvedPicks.map((pick) => {
              const match = matches.find((item) => item.id === pick.matchId);
              const selected = finalPickIds.has(pick.id);
              const displayedStatus: PickStatus = dailySlip.mode === "combined" && selected && isPublished ? dailySlip.settlementStatus : pick.status;
              const displayedProfit = dailySlip.mode === "combined" && selected && dailySlip.settlementStatus !== "pending"
                ? roundUnits(dailySlip.profit / Math.max(finalPicks.length, 1))
                : pick.profit;
              return (
                <article className={`viewer-history-row ${selected ? "selected" : ""}`} key={pick.id}>
                  <div>
                    <strong>{pick.selection}</strong>
                    <MatchMiniCard match={match} />
                  </div>
                  <small>{pick.marketType} · @{pick.odds.toFixed(2)} · Score {scorePick(pick.id, votes)}</small>
                  <div className={`status ${displayedStatus}`}>{selected ? "Final" : statusLabel(displayedStatus)}</div>
                  <b>{displayedProfit >= 0 ? "+" : ""}{displayedProfit.toFixed(2)}u</b>
                </article>
              );
            })}
          {resolvedPicks.length === 0 && slipHistory.length === 0 ? <p className="empty-copy">O historico fechado aparece aqui depois das tips serem resolvidas.</p> : null}
        </div>
      </section> : null}
    </section>
  );
}

function AdminClassifyPage({
  picks,
  matches,
  slipHistory,
  votes,
  onSettlePick
}: {
  picks: Pick[];
  matches: Match[];
  slipHistory: SlipHistoryItem[];
  votes: VoteRecord[];
  onSettlePick: (pickId: string, status: PickStatus) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | PickStatus>("pending");
  const [search, setSearch] = useState("");
  const finalPickIds = new Set(slipHistory.flatMap((slip) => slip.pickIds));
  const normalizedSearch = normalizeFilterText(search);
  const filteredPicks = [...picks]
    .filter((pick) => statusFilter === "all" || pick.status === statusFilter)
    .filter((pick) => {
      if (!normalizedSearch) return true;
      const match = matches.find((item) => item.id === pick.matchId);
      const author = userById(pick.userId);
      const text = normalizeFilterText(`${pick.selection} ${pick.marketType} ${author.displayName} ${match?.homeTeam ?? ""} ${match?.awayTeam ?? ""} ${match?.competition ?? ""}`);
      return text.includes(normalizedSearch);
    })
    .sort((left, right) => {
      if (left.status === "pending" && right.status !== "pending") return -1;
      if (left.status !== "pending" && right.status === "pending") return 1;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  const settledCount = picks.filter((pick) => pick.status !== "pending").length;

  return (
    <section className="admin-page">
      <section className="panel admin-panel">
        <div className="section-title spread">
          <div><ShieldCheck size={18} /><h3>Painel admin</h3></div>
          <span>{settledCount}/{picks.length} classificadas</span>
        </div>
        <div className="admin-toolbar">
          <label className="match-search-field">
            <span>Pesquisar</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Viewer, equipa, jogo ou tip"
            />
          </label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | PickStatus)}>
            <option value="pending">Pendentes</option>
            <option value="all">Todas</option>
            <option value="won">Ganhas</option>
            <option value="lost">Perdidas</option>
            <option value="void">Void</option>
            <option value="half_won">Meia ganha</option>
            <option value="half_lost">Meia perdida</option>
          </select>
        </div>
        <div className="admin-pick-list">
          {filteredPicks.map((pick) => {
            const match = matches.find((item) => item.id === pick.matchId);
            const author = userById(pick.userId);
            const profit = calculateProfit(pick.status, fixedViewerStake, pick.odds);
            return (
              <article className="admin-pick-row" key={pick.id}>
                <div className="author">
                  <Avatar user={author} />
                  <div>
                    <strong>{author.displayName}</strong>
                    <span>{new Date(pick.createdAt).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
                <MatchMiniCard match={match} />
                <div className="admin-pick-main">
                  <strong>{pick.selection}</strong>
                  <small>{pick.marketType} - @{pick.odds.toFixed(2)} - Score {scorePick(pick.id, votes)}{finalPickIds.has(pick.id) ? " - Final streamer" : ""}</small>
                  <p>{pick.reason.trim() || "Sem justificacao."}</p>
                </div>
                <div className="admin-pick-result">
                  <div className={`status ${pick.status}`}>{statusLabel(pick.status)}</div>
                  <b className={profit < 0 ? "negative-value" : "positive-value"}>{profit >= 0 ? "+" : ""}{profit.toFixed(2)}u</b>
                </div>
                <select value={pick.status} onChange={(event) => onSettlePick(pick.id, event.target.value as PickStatus)}>
                  <option value="pending">Pendente</option>
                  <option value="won">Ganha</option>
                  <option value="lost">Perdida</option>
                  <option value="void">Void</option>
                  <option value="half_won">Meia ganha</option>
                  <option value="half_lost">Meia perdida</option>
                </select>
              </article>
            );
          })}
          {filteredPicks.length === 0 ? <p className="empty-copy">Nao ha tips para este filtro.</p> : null}
        </div>
      </section>
    </section>
  );
}

function HistoryPage({
  user,
  isStreamer,
  canEditOdds,
  allPicks,
  matches,
  slipHistory,
  votes,
  onUpdateOdd
}: {
  user: User;
  isStreamer: boolean;
  canEditOdds: boolean;
  allPicks: Pick[];
  matches: Match[];
  slipHistory: SlipHistoryItem[];
  votes: VoteRecord[];
  onUpdateOdd?: (slipId: string, pickId: string, odds: number) => void;
}) {
  const [expandedSlipIds, setExpandedSlipIds] = useState<Set<string>>(() => new Set());
  const visiblePicks = isStreamer ? allPicks : allPicks.filter((pick) => pick.userId === user.id);
  const resolvedPicks = visiblePicks
    .filter((pick) => pick.status !== "pending")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const settledSlips = slipHistory.filter((slip) => slip.settlementStatus !== "pending");
  const totalProfit = settledSlips.reduce((total, slip) => total + slip.profit, 0);

  function toggleExpandedSlip(slipId: string) {
    setExpandedSlipIds((current) => {
      const next = new Set(current);
      if (next.has(slipId)) next.delete(slipId);
      else next.add(slipId);
      return next;
    });
  }

  function renderSlipDetailList(slip: SlipHistoryItem) {
    return (
      <div className="slip-detail-list">
        {slip.pickIds.map((pickId, index) => {
          const pick = allPicks.find((item) => item.id === pickId);
          if (!pick) return null;
          const match = matches.find((item) => item.id === pick.matchId);
          const author = userById(pick.userId);
          return (
            <div className="slip-detail-row" key={pick.id}>
              <span>{index + 1}</span>
              <div>
                <strong>{pick.selection}</strong>
                <small>{author.displayName} - @{pick.odds.toFixed(2)} - Score {scorePick(pick.id, votes)}</small>
                {canEditOdds && onUpdateOdd ? (
                  <label className="settlement-odd-field">
                    Odd final
                    <input
                      type="number"
                      step="0.01"
                      min="1.01"
                      value={pick.odds}
                      onChange={(event) => onUpdateOdd(slip.id, pick.id, Number(event.target.value))}
                    />
                  </label>
                ) : null}
              </div>
              <MatchMiniCard match={match} />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className="history-page">
      <section className="panel history-panel">
        <div className="section-title spread">
          <div><LineChart size={18} /><h3>Histórico de apostas</h3></div>
          <span>{settledSlips.length} resolvidas</span>
        </div>
        <div className="viewer-slip-metrics">
          <span>Boletins <b>{slipHistory.length}</b></span>
          <span>Resolvidos <b>{settledSlips.length}</b></span>
          <span>Tips fechadas <b>{resolvedPicks.length}</b></span>
          <span>Lucro <b>{totalProfit >= 0 ? "+" : ""}{totalProfit.toFixed(2)}u</b></span>
        </div>
        <div className="viewer-history-list">
          {slipHistory.map((slip, index) => (
            <article className="slip-history-card" key={slip.id}>
              <button className="viewer-history-row slip-history-row slip-expand-toggle" onClick={() => toggleExpandedSlip(slip.id)}>
                <div>
                  <strong>Boletim publicado #{slipHistory.length - index}</strong>
                  <span>{formatSlipDateTime(slip.publishedAt)} - {slip.mode === "combined" ? "Combinada" : "Multiplas"} com {slip.pickIds.length} picks</span>
                </div>
                <small>{slip.mode === "combined" ? `${slip.combinedStake.toFixed(2)}u` : `${(slip.multiplesStake * slip.pickIds.length).toFixed(2)}u`}</small>
                <div className={`status ${slip.settlementStatus}`}>{statusLabel(slip.settlementStatus)}</div>
                <b>{expandedSlipIds.has(slip.id) ? "Esconder" : `${slip.profit >= 0 ? "+" : ""}${slip.profit.toFixed(2)}u`}</b>
              </button>
              {expandedSlipIds.has(slip.id) ? renderSlipDetailList(slip) : null}
            </article>
          ))}
          {slipHistory.length === 0 ? <p className="empty-copy">Ainda nao existem apostas publicadas no historico.</p> : null}
        </div>
      </section>
    </section>
  );
}

function TipForm({
  formState,
  selectedMatch,
  matchOdds,
  activeUser,
  onSubmit,
  onChange
}: {
  formState: { marketType: MarketType; selection: string; odds: string; stake: string; bookmaker: string; reason: string };
  selectedMatch?: Match;
  matchOdds?: MatchOdd[];
  activeUser: User;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: React.Dispatch<React.SetStateAction<{ marketType: MarketType; selection: string; odds: string; stake: string; bookmaker: string; reason: string }>>;
}) {
  const availableOdds = getAvailableOddsForMarket(matchOdds, formState.marketType);
  const selectionOptions = availableOdds.map((odd) => odd.selection);
  const selectedOdd = findAvailableOdd(availableOdds, formState.marketType, formState.selection);
  const hasApiOdds = selectionOptions.length > 0;
  const isManualOddsMode = !hasApiOdds || formState.bookmaker === manualOverrideBookmaker;
  const canSubmit = Boolean(
    selectedMatch
    && formState.selection.trim()
    && (selectedOdd || (isManualOddsMode && Number(formState.odds) > 1))
  );

  return (
    <section className="viewer-control">
      <div className="section-title">
        <Vote size={18} />
        <h3>Criar tip como {activeUser.displayName}</h3>
      </div>
      <form className="pick-form" onSubmit={onSubmit}>
        <label>
          Mercado
          <select value={formState.marketType} onChange={(event) => onChange((state) => ({ ...state, marketType: event.target.value as MarketType, selection: "", odds: "", bookmaker: "API-Football" }))}>
            {marketOptions.map((market) => <option key={market}>{market}</option>)}
          </select>
        </label>
        <label className="selection-field">
          Pick
          {hasApiOdds ? (
            <>
              <select
                value={isManualOddsMode ? manualSelectionValue : formState.selection}
                onChange={(event) => {
                  if (event.target.value === manualSelectionValue) {
                    onChange((state) => ({ ...state, selection: "", odds: "", bookmaker: manualOverrideBookmaker }));
                    return;
                  }
                  const nextOdd = findAvailableOdd(availableOdds, formState.marketType, event.target.value);
                  onChange((state) => ({
                    ...state,
                    selection: event.target.value,
                    odds: nextOdd ? nextOdd.odds.toFixed(2) : "",
                    bookmaker: nextOdd?.bookmaker ?? "API-Football"
                  }));
                }}
              >
                <option value="">Escolhe a pick</option>
                {selectionOptions.map((selection) => {
                  const odd = findAvailableOdd(availableOdds, formState.marketType, selection);
                  return (
                  <option value={selection} key={selection}>
                    {odd ? `${selection} @${odd.odds.toFixed(2)}` : selection}
                  </option>
                  );
                })}
                <option value={manualSelectionValue}>Escrever pick/odd manualmente</option>
              </select>
              {isManualOddsMode ? (
                <input
                  className="manual-selection-input"
                  placeholder={marketPlaceholders[formState.marketType]}
                  value={formState.selection}
                  onChange={(event) => onChange((state) => ({ ...state, selection: event.target.value, bookmaker: manualOverrideBookmaker }))}
                />
              ) : null}
            </>
          ) : (
            <input placeholder={marketPlaceholders[formState.marketType]} value={formState.selection} onChange={(event) => onChange((state) => ({ ...state, selection: event.target.value, bookmaker: "Manual" }))} />
          )}
        </label>
        <label>
          Odd
          <input
            type="number"
            step="0.01"
            min="1.01"
            value={!isManualOddsMode ? selectedOdd?.odds.toFixed(2) ?? "" : formState.odds}
            readOnly={!isManualOddsMode}
            disabled={!isManualOddsMode}
            onChange={(event) => onChange((state) => ({ ...state, odds: event.target.value, bookmaker: isManualOddsMode ? manualOverrideBookmaker : "Manual" }))}
          />
        </label>
        <label>
          Stake fixa
          <input type="text" value={`${fixedViewerStake}u`} readOnly disabled />
        </label>
        <label className="reason-field">
          Argumento opcional
          <textarea placeholder="Porque é que a comunidade deve confiar nesta pick?" value={formState.reason} onChange={(event) => onChange((state) => ({ ...state, reason: event.target.value }))} />
        </label>
        <button type="submit" disabled={!canSubmit}>Submeter tip</button>
      </form>
    </section>
  );
}

function SlipPanel({
  picks,
  matches,
  combinedOdds,
  combinedStake,
  multiplesUnitStake,
  multiplesStake,
  mode,
  status
}: {
  picks: Pick[];
  matches: Match[];
  combinedOdds: number;
  combinedStake: number;
  multiplesUnitStake: number;
  multiplesStake: number;
  mode: DailySlip["mode"];
  status: DailySlip["status"];
}) {
  const modeLabel = mode === "combined" ? "Combinada" : "Múltiplas";
  const combinedReturn = combinedStake * combinedOdds;

  return (
    <section className="panel slip-panel">
      <div className="section-title spread">
        <div><ShieldCheck size={18} /><h3>Picks finais do streamer</h3></div>
        <span className={`slip-state ${status}`}>{status}</span>
      </div>
      <div className={`slip-mode-summary ${mode}`}>
        <strong>{modeLabel}</strong>
        <span>
          {mode === "combined"
            ? "Uma aposta acumulada: todas as picks precisam bater."
            : "Apostas individuais: cada pick conta separadamente."}
        </span>
      </div>
      <div className="slip-list">
        {picks.map((pick, index) => {
          const match = matches.find((item) => item.id === pick.matchId);
          return (
            <div className="slip-item" key={pick.id}>
              <span>{index + 1}</span>
              <div>
                <strong>{pick.selection}</strong>
                {mode === "multiples" ? <small>Stake final: {multiplesUnitStake}u</small> : null}
                <small>{match?.homeTeam} vs {match?.awayTeam} · @{pick.odds.toFixed(2)} · {pick.stake}u</small>
              </div>
            </div>
          );
        })}
        {picks.length === 0 ? <p className="empty-copy">O streamer escolhe aqui as tips finais a partir dos votos.</p> : null}
      </div>
      <div className="combined-odds">
        <span>{mode === "combined" ? "Stake combinada" : "Stake total"}</span>
        <strong>{mode === "combined" ? `${combinedStake.toFixed(2)}u` : `${multiplesStake.toFixed(2)}u`}</strong>
      </div>
      {mode === "combined" ? (
        <div className="combined-odds compact">
          <span>Odd / retorno possível</span>
          <strong>{picks.length ? `${combinedOdds.toFixed(2)} / ${combinedReturn.toFixed(2)}u` : "0.00"}</strong>
        </div>
      ) : null}
    </section>
  );
}

function OverlayPage({
  slip,
  picks,
  matches,
  combinedOdds,
  multiplesStake,
  syncStatus
}: {
  slip: DailySlip;
  picks: Pick[];
  matches: Match[];
  combinedOdds: number;
  multiplesStake: number;
  syncStatus: SyncStatus;
}) {
  const isPublished = slip.status === "published" && picks.length > 0;
  const modeLabel = slip.mode === "combined" ? "Combinada" : "Multiplas";
  const stake = slip.mode === "combined" ? slip.combinedStake : multiplesStake;
  const possibleReturn = slip.mode === "combined" ? roundUnits(stake * combinedOdds) : 0;
  const status = slip.mode === "combined" ? slip.settlementStatus : "pending";
  const statusText = isPublished ? statusLabel(status) : syncStatus === "loading" ? "A carregar" : "Sem aposta";

  return (
    <main className="overlay-screen">
      <section className={`stream-overlay-card ${isPublished ? "published" : "empty"}`}>
        <header className="overlay-header">
          <div className="overlay-brand">
            <img src="/serginhobet-icon.svg" alt="" />
            <div>
              <strong>SerginhoBet</strong>
              <span>Aposta diaria</span>
            </div>
          </div>
          <span className={`overlay-status ${status}`}>{statusText}</span>
        </header>

        {isPublished ? (
          <>
            <div className="overlay-main-metric">
              <span>{modeLabel}</span>
              <strong>{slip.mode === "combined" ? combinedOdds.toFixed(2) : `${picks.length} picks`}</strong>
            </div>

            <div className="overlay-metrics">
              <span>Stake <b>{stake.toFixed(2)}u</b></span>
              {slip.mode === "combined" ? <span>Retorno <b>{possibleReturn.toFixed(2)}u</b></span> : null}
              <span>Picks <b>{picks.length}</b></span>
            </div>

            <div className="overlay-pick-list">
              {picks.slice(0, 6).map((pick, index) => {
                const match = matches.find((item) => item.id === pick.matchId);
                return (
                  <article className="overlay-pick" key={pick.id}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{pick.selection}</strong>
                      <small>{match ? `${match.homeTeam} vs ${match.awayTeam}` : "Jogo indisponivel"}</small>
                    </div>
                    <b>@{pick.odds.toFixed(2)}</b>
                  </article>
                );
              })}
              {picks.length > 6 ? <div className="overlay-more">+{picks.length - 6} picks no boletim</div> : null}
            </div>
          </>
        ) : (
          <div className="overlay-empty-state">
            <strong>Aposta ainda nao publicada</strong>
            <span>Quando o streamer publicar o boletim, aparece aqui automaticamente.</span>
          </div>
        )}
      </section>
    </main>
  );
}

function ResolvePage({
  selectedSlip,
  slipHistory,
  picks,
  matches,
  combinedOdds,
  selectedSlipId,
  onSelectSlip,
  onUpdateOdd,
  onSettlePick,
  onSettleCombined
}: {
  selectedSlip?: SlipHistoryItem;
  slipHistory: SlipHistoryItem[];
  picks: Pick[];
  matches: Match[];
  combinedOdds: number;
  selectedSlipId: string;
  onSelectSlip: (slipId: string) => void;
  onUpdateOdd: (slipId: string, pickId: string, odds: number) => void;
  onSettlePick: (slipId: string, pickId: string, status: PickStatus) => void;
  onSettleCombined: (slipId: string, status: PickStatus) => void;
}) {
  const combinedReturn = selectedSlip ? roundUnits(selectedSlip.combinedStake * combinedOdds) : 0;
  const orderedPicks = [...picks].sort((left, right) => {
    if (left.status === "pending" && right.status !== "pending") return -1;
    if (left.status !== "pending" && right.status === "pending") return 1;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
  const canResolve = Boolean(selectedSlip) && orderedPicks.length > 0;

  if (!canResolve || !selectedSlip) {
    return (
      <section className="resolve-page">
        <section className="panel resolve-panel">
          <div className="section-title spread">
            <div><Activity size={18} /><h3>Resolver aposta</h3></div>
            <span>Sem aposta publicada</span>
          </div>
          <div className="resolve-empty">
            <ShieldCheck size={34} />
            <strong>Publica a aposta final primeiro</strong>
            <p>So aparece no Resolver aquilo que o SerginhoEsteves publicar na aba Comunidade.</p>
          </div>
        </section>
      </section>
    );
  }

  const slipSelector = (
    <label className="resolve-slip-picker">
      Boletim a resolver
      <select value={selectedSlipId} onChange={(event) => onSelectSlip(event.target.value)}>
        {slipHistory.map((slip, index) => (
          <option value={slip.id} key={slip.id}>
            Boletim #{slipHistory.length - index} - {slip.mode === "combined" ? "Combinada" : "Multiplas"} - {formatSlipDateTime(slip.publishedAt)}
          </option>
        ))}
      </select>
    </label>
  );

  if (selectedSlip.mode === "combined") {
    return (
      <section className="resolve-page">
        <section className="panel resolve-panel">
          <div className="section-title spread">
            <div><Activity size={18} /><h3>Resolver combinada</h3></div>
            <span>{slipHistory.length} publicadas</span>
          </div>
          {slipSelector}
          <article className="combined-resolve-card">
            <div className="resolve-slip-summary">
              <div>
                <strong>Combinada da comunidade</strong>
                <span>Se uma tip falhar, a combinada inteira fica perdida.</span>
              </div>
              <div className={`status ${selectedSlip.settlementStatus}`}>{statusLabel(selectedSlip.settlementStatus)}</div>
            </div>
            <div className="combined-resolve-list">
              {orderedPicks.map((pick, index) => {
                const match = matches.find((item) => item.id === pick.matchId);
                const author = userById(pick.userId);
                return (
                  <div className="combined-resolve-item" key={pick.id}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{pick.selection}</strong>
                      <small>{author.displayName} - @{pick.odds.toFixed(2)}</small>
                      <label className="settlement-odd-field">
                        Odd final
                        <input
                          type="number"
                          step="0.01"
                          min="1.01"
                          value={pick.odds}
                          onChange={(event) => onUpdateOdd(selectedSlip.id, pick.id, Number(event.target.value))}
                        />
                      </label>
                    </div>
                    <MatchMiniCard match={match} />
                  </div>
                );
              })}
            </div>
            <div className="resolve-slip-footer">
              <span>Stake <b>{selectedSlip.combinedStake.toFixed(2)}u</b></span>
              <span>Odd combinada <b>{combinedOdds.toFixed(2)}</b></span>
              <span>Retorno possivel <b>{combinedReturn.toFixed(2)}u</b></span>
              <span>Resultado <b>{selectedSlip.profit >= 0 ? "+" : ""}{selectedSlip.profit.toFixed(2)}u</b></span>
              <select value={selectedSlip.settlementStatus} onChange={(event) => onSettleCombined(selectedSlip.id, event.target.value as PickStatus)}>
                <option value="pending">Pendente</option>
                <option value="won">Ganha</option>
                <option value="lost">Perdida</option>
                <option value="void">Void</option>
              </select>
            </div>
          </article>
        </section>
      </section>
    );
  }

  return (
    <section className="resolve-page">
      <section className="panel resolve-panel">
        <div className="section-title spread">
          <div><Activity size={18} /><h3>Resolver multiplas</h3></div>
          <span>{orderedPicks.filter((pick) => pick.status === "pending").length} pendentes</span>
        </div>
        {slipSelector}
        <div className="resolve-list">
          {orderedPicks.map((pick) => {
            const match = matches.find((item) => item.id === pick.matchId);
            const author = userById(pick.userId);
            return (
              <article className="resolve-row" key={pick.id}>
                <div className="author">
                  <Avatar user={author} />
                  <div>
                    <strong>{author.displayName}</strong>
                  </div>
                </div>
                <MatchMiniCard match={match} />
                <div>
                  <strong>{pick.selection}</strong>
                  <small>{pick.marketType} - @{pick.odds.toFixed(2)} - {selectedSlip.multiplesStake}u</small>
                  <label className="settlement-odd-field">
                    Odd final
                    <input
                      type="number"
                      step="0.01"
                      min="1.01"
                      value={pick.odds}
                      onChange={(event) => onUpdateOdd(selectedSlip.id, pick.id, Number(event.target.value))}
                    />
                  </label>
                </div>
                <div className={`status ${pick.status}`}>{statusLabel(pick.status)}</div>
                <select value={pick.status} onChange={(event) => onSettlePick(selectedSlip.id, pick.id, event.target.value as PickStatus)}>
                  <option value="pending">Pendente</option>
                  <option value="won">Ganha</option>
                  <option value="lost">Perdida</option>
                  <option value="void">Void</option>
                  <option value="half_won">Meia ganha</option>
                  <option value="half_lost">Meia perdida</option>
                </select>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
}

function LegacyResolvePage({ picks, matches, onSettle }: { picks: Pick[]; matches: Match[]; onSettle: (pickId: string, status: PickStatus) => void }) {
  const orderedPicks = [...picks].sort((left, right) => {
    if (left.status === "pending" && right.status !== "pending") return -1;
    if (left.status !== "pending" && right.status === "pending") return 1;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });

  return (
    <section className="resolve-page">
      <section className="panel resolve-panel">
        <div className="section-title spread">
          <div><Activity size={18} /><h3>Resolver tips</h3></div>
          <span>{orderedPicks.filter((pick) => pick.status === "pending").length} pendentes</span>
        </div>
        <div className="resolve-list">
          {orderedPicks.map((pick) => {
            const match = matches.find((item) => item.id === pick.matchId);
            const author = userById(pick.userId);
            return (
              <article className="resolve-row" key={pick.id}>
                <div className="author">
                  <Avatar user={author} />
                  <div>
                    <strong>{author.displayName}</strong>
                  </div>
                </div>
                <MatchMiniCard match={match} />
                <div>
                  <strong>{pick.selection}</strong>
                  <small>{pick.marketType} · @{pick.odds.toFixed(2)} · {pick.stake}u</small>
                </div>
                <div className={`status ${pick.status}`}>{statusLabel(pick.status)}</div>
                <select value={pick.status} onChange={(event) => onSettle(pick.id, event.target.value as PickStatus)}>
                  <option value="pending">Pendente</option>
                  <option value="won">Ganha</option>
                  <option value="lost">Perdida</option>
                  <option value="void">Void</option>
                  <option value="half_won">Meia ganha</option>
                  <option value="half_lost">Meia perdida</option>
                </select>
              </article>
            );
          })}
          {orderedPicks.length === 0 ? <p className="empty-copy">Ainda não há tips para resolver.</p> : null}
        </div>
      </section>
    </section>
  );
}

function BankPanel({ bankroll }: { bankroll: ReturnType<typeof calculateBankroll> }) {
  return (
    <section className="panel bank-mini">
      <div className="section-title"><Gauge size={18} /><h3>Estado da banca</h3></div>
      <div className="bank-line"><span>Disponível</span><strong>{(bankroll.current - bankroll.exposure).toFixed(2)}u</strong></div>
      <div className="bank-line"><span>Exposição boletim</span><strong>{bankroll.exposure.toFixed(2)}u</strong></div>
      <div className="bank-line"><span>Lucro fechado</span><strong>{bankroll.settledProfit >= 0 ? "+" : ""}{bankroll.settledProfit.toFixed(2)}u</strong></div>
    </section>
  );
}

function StatsDashboard({
  dayScope,
  monthScope,
  allTimeScope,
  dayTimeline,
  monthTimeline,
  allTimeTimeline,
  monthlyLeaderboard,
  generalLeaderboard,
  bankroll,
  monthName
}: {
  dayScope: StatsScope;
  monthScope: StatsScope;
  allTimeScope: StatsScope;
  dayTimeline: ChartPoint[];
  monthTimeline: ChartPoint[];
  allTimeTimeline: ChartPoint[];
  monthlyLeaderboard: Array<{ user: User; picks: number; profit: number; roi: number; winrate: number }>;
  generalLeaderboard: Array<{ user: User; picks: number; profit: number; roi: number; winrate: number }>;
  bankroll: ReturnType<typeof calculateBankroll>;
  monthName: string;
}) {
  const monthLeader = monthlyLeaderboard.find((row) => row.picks > 0);
  const generalLeader = generalLeaderboard.find((row) => row.picks > 0);

  return (
    <section className="stats-page">
      <section className="panel stats-overview-panel">
        <div className="section-title spread">
          <div><Trophy size={18} /><h3>Resumo competitivo</h3></div>
          <span>{monthName}</span>
        </div>
        <div className="stats-overview-grid">
          <span>
            Lider de {monthName}
            <b>{monthLeader ? monthLeader.user.displayName : "Ainda sem resolvidas"}</b>
            <small>{monthLeader ? `ROI ${monthLeader.roi.toFixed(1)}% - ${monthLeader.profit >= 0 ? "+" : ""}${monthLeader.profit.toFixed(2)}u` : "Resolve uma aposta final para iniciar ranking."}</small>
          </span>
          <span>
            Lider geral
            <b>{generalLeader ? generalLeader.user.displayName : "Ainda sem resolvidas"}</b>
            <small>{generalLeader ? `ROI ${generalLeader.roi.toFixed(1)}% - ${generalLeader.profit >= 0 ? "+" : ""}${generalLeader.profit.toFixed(2)}u` : "Sem historico fechado."}</small>
          </span>
          <span>
            Banca atual
            <b>{bankroll.current.toFixed(2)}u</b>
            <small>{bankroll.exposure.toFixed(2)}u expostas - {(bankroll.current - bankroll.exposure).toFixed(2)}u livres</small>
          </span>
        </div>
      </section>

      <section className="panel stats-hero-panel">
        <div className="section-title"><LineChart size={18} /><h3>Estatisticas do dia</h3></div>
        <StatsMetricGrid scope={dayScope} bankroll={bankroll} />
        <ProfitChart points={dayTimeline} title="Evolucao do ROI do dia" />
      </section>

      <section className="panel stats-hero-panel">
        <div className="section-title"><LineChart size={18} /><h3>Estatisticas de {monthName}</h3></div>
        <StatsMetricGrid scope={monthScope} />
        <ProfitChart points={monthTimeline} title={`Evolucao do ROI de ${monthName}`} />
      </section>

      <section className="panel stats-hero-panel">
        <div className="section-title"><LineChart size={18} /><h3>Estatisticas gerais</h3></div>
        <StatsMetricGrid scope={allTimeScope} />
        <ProfitChart points={allTimeTimeline} title="Evolucao do ROI geral" />
      </section>

      <StatsTable title={`Performance de ${monthName}`} scope={monthScope} />
      <StatsTable title="Performance geral" scope={allTimeScope} />
      <LeaderboardPanel title={`Leaderboard de ${monthName}`} leaderboard={monthlyLeaderboard} />
      <LeaderboardPanel title="Leaderboard geral" leaderboard={generalLeaderboard} />
    </section>
  );
}

function StatsMetricGrid({ scope, bankroll }: { scope: StatsScope; bankroll?: ReturnType<typeof calculateBankroll> }) {
  return (
    <div className="stat-grid wide">
      <span>Tips submetidas <b>{scope.total.submitted}</b></span>
      <span>Finais do streamer <b>{scope.total.selected}</b></span>
      <span>Resolvidas <b>{scope.total.settled}</b></span>
      <span>Stake fechada <b>{scope.total.staked.toFixed(2)}u</b></span>
      <span>Lucro total <b>{scope.total.profit >= 0 ? "+" : ""}{scope.total.profit.toFixed(2)}u</b></span>
      <span>ROI <b>{scope.total.roi.toFixed(1)}%</b></span>
      {bankroll ? (
        <>
          <span>Banca atual <b>{bankroll.current.toFixed(2)}u</b></span>
          <span>Disponivel <b>{(bankroll.current - bankroll.exposure).toFixed(2)}u</b></span>
        </>
      ) : null}
    </div>
  );
}

function StatsTable({ title, scope }: { title: string; scope: StatsScope }) {
  const rankedRows = runtimeUsers
    .map((user) => ({
      user,
      row: scope.byViewer.find((viewerRow) => viewerRow.userId === user.id) ?? {
        submitted: 0,
        selected: 0,
        settled: 0,
        pendingSelected: 0,
        staked: 0,
        profit: 0,
        roi: 0
      }
    }))
    .sort((left, right) =>
      Number(right.row.settled > 0) - Number(left.row.settled > 0)
      || right.row.roi - left.row.roi
      || right.row.profit - left.row.profit
      || right.row.settled - left.row.settled
      || right.row.selected - left.row.selected
    );

  return (
    <section className="panel stats-table-panel">
      <div className="section-title spread">
        <div><Trophy size={18} /><h3>{title}</h3></div>
        <span>Ranking por ROI</span>
      </div>
      <div className="stats-table">
        <div className="stats-table-head"><span>Pessoa</span><span>Tips</span><span>Finais</span><span>Resolvidas</span><span>Stake</span><span>Lucro</span><span>ROI</span></div>
        {rankedRows.length > 0 ? rankedRows.map(({ user, row }) => (
          <div className="stats-table-row" key={user.id}>
            <span className="viewer-cell"><Avatar user={user} /> {user.displayName}</span>
            <span>{row.submitted}</span>
            <span>{row.selected}</span>
            <span>{row.settled}</span>
            <span>{row.staked.toFixed(2)}u</span>
            <b className={row.profit < 0 ? "negative-value" : "positive-value"}>{row.profit >= 0 ? "+" : ""}{row.profit.toFixed(2)}u</b>
            <b className={row.roi < 0 ? "negative-value" : "positive-value"}>{row.roi.toFixed(1)}%</b>
          </div>
        )) : <div className="stats-empty-row">Ainda nao existem perfis reais nesta liga.</div>}
      </div>
    </section>
  );
}

function LeaderboardPanel({ title, leaderboard }: { title: string; leaderboard: Array<{ user: User; picks: number; profit: number; roi: number; winrate: number }> }) {
  return (
    <section className="panel stats-table-panel">
      <div className="section-title spread">
        <div><Trophy size={18} /><h3>{title}</h3></div>
        <span>ROI</span>
      </div>
      <div className="leaderboard">
        {leaderboard.map((row, index) => (
          <div className="leader-row" key={row.user.id}>
            <span>{index + 1}</span>
            <Avatar user={row.user} />
            <strong>{row.user.displayName}</strong>
            <small>{row.picks} resolvidas - {row.profit >= 0 ? "+" : ""}{row.profit.toFixed(2)}u</small>
            <b className={row.roi < 0 ? "negative-value" : "positive-value"}>{row.roi.toFixed(1)}%</b>
          </div>
        ))}
        {leaderboard.length === 0 ? <div className="stats-empty-row">Ainda nao existem perfis reais nesta liga.</div> : null}
      </div>
    </section>
  );
}

function StatsPage({
  dailyStats,
  profitTimeline,
  leaderboard,
  bankroll
}: {
  dailyStats: ReturnType<typeof calculateDailyStats>;
  profitTimeline: ChartPoint[];
  leaderboard: Array<{ user: User; picks: number; profit: number; roi: number; winrate: number }>;
  bankroll: ReturnType<typeof calculateBankroll>;
}) {
  const giveawayLeader = leaderboard[0];
  const eligibleViewers = leaderboard.filter((row) => row.picks > 0).length;

  return (
    <section className="stats-page">
      <section className="panel stats-hero-panel">
        <div className="section-title"><LineChart size={18} /><h3>Estatísticas do dia</h3></div>
        <div className="stat-grid wide">
          <span>Tips submetidas <b>{dailyStats.total.submitted}</b></span>
          <span>Finais do streamer <b>{dailyStats.total.selected}</b></span>
          <span>Lucro total <b>{dailyStats.total.profit >= 0 ? "+" : ""}{dailyStats.total.profit.toFixed(2)}u</b></span>
          <span>ROI <b>{dailyStats.total.roi.toFixed(1)}%</b></span>
          <span>Banca atual <b>{bankroll.current.toFixed(2)}u</b></span>
          <span>Disponível <b>{(bankroll.current - bankroll.exposure).toFixed(2)}u</b></span>
        </div>
        <ProfitChart points={profitTimeline} title="Evolucao do ROI" />
      </section>

      <section className="panel giveaway-panel">
        <div className="section-title spread">
          <div><Trophy size={18} /><h3>Destaque do dia</h3></div>
          <span>{eligibleViewers} elegiveis</span>
        </div>
        {giveawayLeader ? (
          <div className="giveaway-leader">
            <span className="giveaway-rank">1</span>
            <Avatar user={giveawayLeader.user} />
            <div>
              <strong>{giveawayLeader.user.displayName}</strong>
              <small>1.º lugar por lucro fechado no fim do dia</small>
            </div>
            <b>{giveawayLeader.profit >= 0 ? "+" : ""}{giveawayLeader.profit.toFixed(2)}u</b>
          </div>
        ) : null}
        <div className="giveaway-rules">
          <span>Minimo <b>1 tip final resolvida</b></span>
          <span>Desempate <b>ROI, depois winrate</b></span>
        </div>
      </section>

      <section className="panel stats-table-panel">
        <div className="section-title"><Trophy size={18} /><h3>Performance por pessoa</h3></div>
        <div className="stats-table">
          <div className="stats-table-head"><span>Pessoa</span><span>Tips</span><span>Finais</span><span>Resolvidas</span><span>Stake</span><span>Lucro</span><span>ROI</span></div>
          {runtimeUsers.map((user) => {
            const row = dailyStats.byViewer.find((viewerRow) => viewerRow.userId === user.id) ?? {
              submitted: 0,
              selected: 0,
              settled: 0,
              pendingSelected: 0,
              staked: 0,
              profit: 0,
              roi: 0
            };
            return (
              <div className="stats-table-row" key={user.id}>
                <span className="viewer-cell"><Avatar user={user} /> {user.displayName}</span>
                <span>{row.submitted}</span>
                <span>{row.selected}</span>
                <span>{row.settled}</span>
                <span>{row.staked.toFixed(2)}u</span>
                <b>{row.profit >= 0 ? "+" : ""}{row.profit.toFixed(2)}u</b>
                <span>{row.roi.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel stats-table-panel">
        <div className="section-title"><Trophy size={18} /><h3>Leaderboard geral</h3></div>
        <div className="leaderboard">
          {leaderboard.map((row, index) => (
            <div className="leader-row" key={row.user.id}>
              <span>{index + 1}</span>
              <Avatar user={row.user} />
              <strong>{row.user.displayName}</strong>
              <small>{row.picks} resolvidas · {row.winrate.toFixed(0)}%</small>
              <b>{row.profit >= 0 ? "+" : ""}{row.profit.toFixed(2)}u</b>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function ProfitChart({ points, title }: { points: ChartPoint[]; title: string }) {
  if (points.length === 0) return <div className="chart-empty">Ainda nao ha apostas resolvidas para desenhar evolucao.</div>;

  const width = 760;
  const height = 260;
  const paddingX = 48;
  const paddingTop = 30;
  const paddingBottom = 42;
  const values = points.map((point) => point.roi);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const paddedMin = min === max ? min - 5 : Math.floor((min - 4) / 5) * 5;
  const paddedMax = min === max ? max + 5 : Math.ceil((max + 4) / 5) * 5;
  const range = paddedMax - paddedMin || 1;
  const coords = points.map((point, index) => {
    const x = paddingX + (index / Math.max(points.length - 1, 1)) * (width - paddingX * 2);
    const y = height - paddingBottom - ((point.roi - paddedMin) / range) * (height - paddingTop - paddingBottom);
    return { ...point, x, y };
  });
  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const zeroY = height - paddingBottom - ((0 - paddedMin) / range) * (height - paddingTop - paddingBottom);
  const finalPoint = points[points.length - 1];
  const guideValues = [paddedMax, roundUnits((paddedMax + paddedMin) / 2), paddedMin];
  const labelEvery = Math.max(1, Math.ceil(points.length / 5));

  return (
    <div className="chart-wrap">
      <div className="chart-summary">
        <div>
          <strong>{title}</strong>
          <span>ROI acumulado por aposta resolvida</span>
        </div>
        <b className={finalPoint.roi < 0 ? "negative-value" : "positive-value"}>{finalPoint.roi.toFixed(1)}%</b>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        {guideValues.map((value, index) => {
          const y = height - paddingBottom - ((value - paddedMin) / range) * (height - paddingTop - paddingBottom);
          return (
            <g key={`${value}-${index}`}>
              <line className="chart-grid" x1={paddingX} x2={width - paddingX} y1={y} y2={y} />
              <text className="chart-y-label" x={12} y={y + 4}>{value.toFixed(0)}%</text>
            </g>
          );
        })}
        <line className="chart-axis" x1={paddingX} x2={width - paddingX} y1={zeroY} y2={zeroY} />
        <path className="chart-line" d={path} />
        {coords.map((point, index) => {
          const showLabel = index === 0 || index === coords.length - 1 || index % labelEvery === 0;
          return (
          <g key={`${point.label}-${point.cumulative}-${index}`}>
            <circle className={point.roi >= 0 ? "chart-dot positive" : "chart-dot negative"} cx={point.x} cy={point.y} r="5" />
            {showLabel ? <text className="chart-x-label" x={point.x} y={height - 12} textAnchor="middle">{point.label}</text> : null}
          </g>
          );
        })}
      </svg>
      <div className="chart-foot">
        <span>Lucro acumulado: <b className={finalPoint.cumulative < 0 ? "negative-value" : "positive-value"}>{finalPoint.cumulative >= 0 ? "+" : ""}{finalPoint.cumulative.toFixed(2)}u</b></span>
        <span>Stake fechada: <b>{finalPoint.cumulativeStake.toFixed(2)}u</b></span>
      </div>
    </div>
  );
}
