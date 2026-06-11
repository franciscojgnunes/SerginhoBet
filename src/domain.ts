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
    const teams = [normalizeMatchTeam(match.homeTeam), normalizeMatchTeam(match.awayTeam)].sort().join("-");
    const key = `${teams}-${getLocalDateKey(new Date(match.startsAt))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(match);
  }

  return merged;
}

function normalizeMatchTeam(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function filterMatchesForDay(matches: Match[], day: string) {
  return matches.filter((match) => getLocalDateKey(new Date(match.startsAt)) === day);
}

export function getLocalDateKey(date: Date, timeZone = "Europe/Lisbon") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function filterUpcomingScheduledMatches(matches: Match[], now = new Date()) {
  return matches.filter((match) => match.status === "scheduled" && new Date(match.startsAt).getTime() > now.getTime());
}

const competitionNameMap: Record<string, string> = {
  "Austrian Regionalliga Ost": "Áustria Regionalliga Ost",
  "Chinese Super League": "China Super League",
  "CONMEBOL Libertadores": "Copa Libertadores",
  "CONMEBOL Sudamericana": "Copa Sudamericana",
  "Czech National Football League": "Chéquia 2ª Liga",
  "Indian Super League": "Índia Super League",
  "Saudi Pro League": "Saudi Pro League",
  "South African First Division": "África do Sul 2ª Liga",
  "South African Premiership": "RSA Premiership",
  "UEFA Champions League": "Champions League",
  "USL Championship": "USL Championship",
  "FIFA World Cup": "Mundial",
  "World Cup": "Mundial",
  "arg.1": "Argentina Liga Profesional",
  "arg.2": "Argentina 2ª Liga",
  "aut.1": "Áustria Bundesliga",
  "bel.1": "Bélgica Pro League",
  "bra.1": "Brasil Série A",
  "chi.1": "Chile Primera División",
  "chn.1": "China Super League",
  "col.1": "Colômbia Primera A",
  "cze.1": "Chéquia 1ª Liga",
  "cze.2": "Chéquia 2ª Liga",
  "den.1": "Dinamarca Superliga",
  "ecu.1": "Equador LigaPro",
  "eng.1": "Premier League",
  "eng.2": "Championship",
  "eng.3": "League One",
  "eng.4": "League Two",
  "esp.1": "LaLiga",
  "esp.2": "LaLiga 2",
  "fin.1": "Finlândia Veikkausliiga",
  "fra.1": "Ligue 1",
  "fra.2": "Ligue 2",
  "ger.1": "Bundesliga",
  "ger.2": "2. Bundesliga",
  "gre.1": "Grécia Super League",
  "idn.1": "Indonésia Liga 1",
  "ind.1": "Índia Super League",
  "ita.1": "Serie A",
  "ita.2": "Serie B",
  "jpn.1": "J1 League",
  "kor.1": "K League 1",
  "ksa.1": "Saudi Pro League",
  "mex.1": "Liga MX",
  "ned.1": "Eredivisie",
  "ned.2": "Eerste Divisie",
  "nor.1": "Noruega Eliteserien",
  "per.1": "Peru Liga 1",
  "pol.1": "Polónia Ekstraklasa",
  "por.1": "Liga Portugal",
  "por.2": "Liga Portugal 2",
  "qat.1": "Qatar Stars League",
  "rou.1": "Roménia SuperLiga",
  "rsa.1": "RSA Premiership",
  "rsa.2": "África do Sul 2ª Liga",
  "sco.1": "Escócia Premiership",
  "sui.1": "Suíça Super League",
  "swe.1": "Suécia Allsvenskan",
  "tur.1": "Turquia Süper Lig",
  "uae.1": "EAU Pro League",
  "conmebol.libertadores": "Copa Libertadores",
  "conmebol.sudamericana": "Copa Sudamericana",
  "uefa.champions": "Champions League",
  "uefa.europa": "Europa League",
  "uefa.europa.conf": "Conference League",
  "uru.1": "Uruguai Primera",
  "usa.1": "MLS",
  "usa.nwsl": "NWSL",
  "usa.usl.1": "USL Championship"
};

export function cleanCompetitionName(name: string) {
  const normalized = name.replace(/\s+/g, " ").trim();
  return competitionNameMap[normalized] ?? normalized.replace(/^English /, "").replace(/^Spanish /, "").replace(/^German /, "");
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
