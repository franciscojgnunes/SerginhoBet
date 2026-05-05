import type { Match, MatchStatus } from "./types";

type SportsDbEvent = {
  idEvent: string;
  strTimestamp: string | null;
  strEvent: string;
  strLeague: string;
  strCountry: string | null;
  strHomeTeam: string;
  strAwayTeam: string;
  intHomeScore: string | null;
  intAwayScore: string | null;
  strStatus: string | null;
};

type SportsDbResponse = {
  events: SportsDbEvent[] | null;
};

export async function fetchTodayMatches(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const response = await fetch(`https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${day}&s=Soccer`);

  if (!response.ok) {
    throw new Error(`TheSportsDB respondeu ${response.status}`);
  }

  const data = (await response.json()) as SportsDbResponse;
  return (data.events ?? []).map(mapSportsDbEvent);
}

function mapSportsDbEvent(event: SportsDbEvent): Match {
  const homeScore = parseScore(event.intHomeScore);
  const awayScore = parseScore(event.intAwayScore);

  return {
    id: `api-${event.idEvent}`,
    competition: event.strLeague,
    country: event.strCountry ?? undefined,
    homeTeam: event.strHomeTeam,
    awayTeam: event.strAwayTeam,
    startsAt: normalizeTimestamp(event.strTimestamp),
    status: getStatus(event.strStatus, homeScore, awayScore),
    homeScore,
    awayScore,
    source: "api"
  };
}

function normalizeTimestamp(value: string | null) {
  if (!value) return new Date().toISOString();
  return value.endsWith("Z") ? value : `${value}Z`;
}

function parseScore(value: string | null) {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getStatus(status: string | null, homeScore?: number, awayScore?: number): MatchStatus {
  if (status?.toLowerCase().includes("not started")) return "scheduled";
  if (homeScore !== undefined && awayScore !== undefined && status?.toLowerCase() !== "not started") {
    return status?.toLowerCase().includes("2h") || status?.toLowerCase().includes("1h") ? "live" : "finished";
  }
  if (status && status.toLowerCase() !== "not started") return "live";
  return "scheduled";
}
