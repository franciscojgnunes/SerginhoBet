import { buildMatchSlate, cleanCompetitionName, filterMatchesForDay, filterUpcomingScheduledMatches, getLocalDateKey } from "./domain";
import type { Match, MatchStatus } from "./types";

type ApiFootballResponse = {
  response?: ApiFootballFixture[];
  espnWorldCup?: EspnEvent[];
};

type ApiFootballFixture = {
  fixture: {
    id: number;
    date: string;
    status?: {
      short?: string;
    };
    venue?: {
      name?: string | null;
    };
  };
  league: {
    name: string;
    country?: string;
  };
  teams: {
    home: {
      name: string;
      logo?: string;
    };
    away: {
      name: string;
      logo?: string;
    };
  };
  goals?: {
    home: number | null;
    away: number | null;
  };
};

type EspnScoreboardResponse = {
  events?: EspnEvent[];
};

type EspnEvent = {
  id: string;
  date: string;
  name?: string;
  status?: {
    type?: {
      name?: string;
      state?: string;
    };
  };
  competitions?: Array<{
    competitors?: Array<{
      homeAway?: "home" | "away";
      team?: {
        displayName?: string;
        logo?: string;
      };
      score?: string;
    }>;
    venue?: {
      fullName?: string;
    };
  }>;
};

const dayRequestCache = new Map<string, Promise<Match[]>>();

export async function fetchTodayMatches(date = new Date(), options: { forceRefresh?: boolean } = {}) {
  const day = getLocalDateKey(date);
  if (!options.forceRefresh && dayRequestCache.has(day)) return dayRequestCache.get(day)!;

  const request = fetchMatchesForDay(day, date, options.forceRefresh).then((matches) => {
    if (matches.length === 0) dayRequestCache.delete(day);
    return matches;
  });
  dayRequestCache.set(day, request);
  return request;
}

export async function fetchMatchesForDates(dates: Date[], options: { forceRefresh?: boolean } = {}) {
  const results = await Promise.all(dates.map((date) => fetchTodayMatches(date, options)));
  return buildMatchSlate(results.flat(), []).sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
  );
}

async function fetchMatchesForDay(day: string, now: Date, forceRefresh = false) {
  const [apiFootballMatches, espnWorldCupMatches] = await Promise.all([
    fetchApiFootballMatches(day, forceRefresh),
    fetchEspnWorldCupMatches(day, forceRefresh)
  ]);
  return sortUpcomingMatches(buildMatchSlate(apiFootballMatches, espnWorldCupMatches), day, now);
}

function sortUpcomingMatches(matches: Match[], day: string, now: Date) {
  return filterUpcomingScheduledMatches(filterMatchesForDay(matches, day), now).sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
  );
}

async function fetchApiFootballMatches(day: string, forceRefresh = false) {
  const serverMatches = await fetchServerApiFootballMatches(day, forceRefresh);
  if (serverMatches.length > 0) return serverMatches;

  const apiKey = import.meta.env.VITE_API_FOOTBALL_KEY as string | undefined;
  if (!apiKey) return [];

  try {
    const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${day}&timezone=Europe/Lisbon`, {
      cache: "no-store",
      headers: {
        "x-apisports-key": apiKey
      }
    });
    if (!response.ok) return [];

    const data = (await response.json()) as ApiFootballResponse;
    return (data.response ?? []).map(mapApiFootballFixture);
  } catch {
    return [];
  }
}

async function fetchServerApiFootballMatches(day: string, forceRefresh = false) {
  try {
    const cacheBust = forceRefresh ? `&refresh=${Date.now()}` : "";
    const response = await fetch(`/api/matches?date=${day}${cacheBust}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache"
      }
    });
    if (!response.ok) return [];

    const data = (await response.json()) as ApiFootballResponse;
    return [
      ...(data.response ?? []).map(mapApiFootballFixture),
      ...(data.espnWorldCup ?? []).map(mapEspnWorldCupEvent)
    ];
  } catch {
    return [];
  }
}

async function fetchEspnWorldCupMatches(day: string, forceRefresh = false) {
  try {
    const dateRange = getEspnDateRangeForLocalDay(day);
    const cacheBust = forceRefresh ? `&refresh=${Date.now()}` : "";
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateRange}&limit=200${cacheBust}`, {
      cache: "no-store"
    });
    if (!response.ok) return [];

    const data = (await response.json()) as EspnScoreboardResponse;
    return (data.events ?? []).map(mapEspnWorldCupEvent);
  } catch {
    return [];
  }
}

function mapApiFootballFixture(event: ApiFootballFixture): Match {
  const homeScore = event.goals?.home ?? undefined;
  const awayScore = event.goals?.away ?? undefined;

  return {
    id: `api-football-${event.fixture.id}`,
    competition: cleanCompetitionName(event.league.name),
    country: event.league.country,
    homeTeam: event.teams.home.name,
    awayTeam: event.teams.away.name,
    startsAt: event.fixture.date,
    status: getApiFootballStatus(event.fixture.status?.short),
    homeScore,
    awayScore,
    homeLogoUrl: event.teams.home.logo,
    awayLogoUrl: event.teams.away.logo,
    venue: event.fixture.venue?.name ?? undefined,
    source: "api"
  };
}

function mapEspnWorldCupEvent(event: EspnEvent): Match {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const home = competitors.find((competitor) => competitor.homeAway === "home") ?? competitors[0];
  const away = competitors.find((competitor) => competitor.homeAway === "away") ?? competitors[1];
  const homeScore = Number(home?.score);
  const awayScore = Number(away?.score);

  return {
    id: `api-football-espn-world-${event.id}`,
    competition: "Mundial",
    country: "World",
    homeTeam: home?.team?.displayName ?? event.name?.split(" at ")[1] ?? "Casa",
    awayTeam: away?.team?.displayName ?? event.name?.split(" at ")[0] ?? "Fora",
    startsAt: event.date,
    status: getEspnStatus(event.status?.type?.name, event.status?.type?.state),
    homeScore: Number.isFinite(homeScore) ? homeScore : undefined,
    awayScore: Number.isFinite(awayScore) ? awayScore : undefined,
    homeLogoUrl: home?.team?.logo,
    awayLogoUrl: away?.team?.logo,
    venue: competition?.venue?.fullName,
    source: "api"
  };
}

function getApiFootballStatus(status?: string): MatchStatus {
  if (!status || status === "NS" || status === "TBD") return "scheduled";
  if (["FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO"].includes(status)) return "finished";
  return "live";
}

function getEspnStatus(name?: string, state?: string): MatchStatus {
  if (state === "post" || name === "STATUS_FINAL") return "finished";
  if (state === "in") return "live";
  return "scheduled";
}

function getEspnDateRangeForLocalDay(day: string) {
  const current = new Date(`${day}T12:00:00Z`);
  const previous = new Date(current.getTime() - 24 * 60 * 60 * 1000);
  return `${formatEspnDateKey(previous)}-${formatEspnDateKey(current)}`;
}

function formatEspnDateKey(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("");
}
