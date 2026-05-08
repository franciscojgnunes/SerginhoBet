import { buildMatchSlate, cleanCompetitionName, filterMatchesForDay, filterUpcomingScheduledMatches, getLocalDateKey } from "./domain";
import type { Match, MatchStatus } from "./types";

type ApiFootballResponse = {
  response?: ApiFootballFixture[];
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

const dayRequestCache = new Map<string, Promise<Match[]>>();

export async function fetchTodayMatches(date = new Date(), options: { forceRefresh?: boolean } = {}) {
  const day = getLocalDateKey(date);
  if (!options.forceRefresh && dayRequestCache.has(day)) return dayRequestCache.get(day)!;

  const request = fetchMatchesForDay(day, date).then((matches) => {
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

async function fetchMatchesForDay(day: string, now: Date) {
  const apiFootballMatches = await fetchApiFootballMatches(day);
  return sortUpcomingMatches(apiFootballMatches, day, now);
}

function sortUpcomingMatches(matches: Match[], day: string, now: Date) {
  return filterUpcomingScheduledMatches(filterMatchesForDay(matches, day), now).sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
  );
}

async function fetchApiFootballMatches(day: string) {
  const serverMatches = await fetchServerApiFootballMatches(day);
  if (serverMatches.length > 0) return serverMatches;

  const apiKey = import.meta.env.VITE_API_FOOTBALL_KEY as string | undefined;
  if (!apiKey) return [];

  try {
    const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${day}&timezone=Europe/Lisbon`, {
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

async function fetchServerApiFootballMatches(day: string) {
  try {
    const response = await fetch(`/api/matches?date=${day}`);
    if (!response.ok) return [];

    const data = (await response.json()) as ApiFootballResponse;
    return (data.response ?? []).map(mapApiFootballFixture);
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

function getApiFootballStatus(status?: string): MatchStatus {
  if (!status || status === "NS" || status === "TBD") return "scheduled";
  if (["FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO"].includes(status)) return "finished";
  return "live";
}
