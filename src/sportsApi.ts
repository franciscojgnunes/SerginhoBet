import { buildMatchSlate, filterMatchesForDay } from "./domain";
import type { Match, MatchStatus } from "./types";

const espnSoccerLeagues = [
  "uefa.champions",
  "uefa.europa",
  "uefa.europa.conf",
  "concacaf.champions",
  "afc.champions",
  "caf.champions",
  "eng.1",
  "eng.2",
  "esp.1",
  "ita.1",
  "ger.1",
  "fra.1",
  "por.1",
  "ned.1",
  "bra.1",
  "usa.1",
  "mex.1",
  "arg.1"
];

type SportsDbEvent = {
  idEvent: string;
  strTimestamp: string | null;
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

type EspnScoreboardResponse = {
  events?: EspnEvent[];
};

type EspnEvent = {
  id: string;
  date: string;
  name: string;
  league?: {
    name?: string;
    abbreviation?: string;
  };
  competitions?: Array<{
    competitors?: Array<{
      homeAway: "home" | "away";
      score?: string;
      team: {
        displayName?: string;
        shortDisplayName?: string;
      };
    }>;
    status?: {
      type?: {
        state?: string;
        completed?: boolean;
      };
    };
  }>;
};

export async function fetchTodayMatches(date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  const [espnMatches, sportsDbMatches] = await Promise.all([fetchEspnMatches(day), fetchSportsDbMatches(day)]);

  return filterMatchesForDay(buildMatchSlate(espnMatches, sportsDbMatches), day).sort(
    (left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
  );
}

async function fetchSportsDbMatches(day: string) {
  try {
    const response = await fetch(`https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=${day}&s=Soccer`);
    if (!response.ok) return [];

    const data = (await response.json()) as SportsDbResponse;
    return (data.events ?? []).map(mapSportsDbEvent);
  } catch {
    return [];
  }
}

async function fetchEspnMatches(day: string) {
  const espnDay = day.split("-").join("");
  const settled = await Promise.allSettled(
    espnSoccerLeagues.map(async (league) => {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${espnDay}`);
      if (!response.ok) return [];

      const data = (await response.json()) as EspnScoreboardResponse;
      return (data.events ?? []).map((event) => mapEspnEvent(event, league));
    })
  );

  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

function mapSportsDbEvent(event: SportsDbEvent): Match {
  const homeScore = parseScore(event.intHomeScore);
  const awayScore = parseScore(event.intAwayScore);

  return {
    id: `sportsdb-${event.idEvent}`,
    competition: event.strLeague,
    country: event.strCountry ?? undefined,
    homeTeam: event.strHomeTeam,
    awayTeam: event.strAwayTeam,
    startsAt: normalizeTimestamp(event.strTimestamp),
    status: getSportsDbStatus(event.strStatus, homeScore, awayScore),
    homeScore,
    awayScore,
    source: "api"
  };
}

function mapEspnEvent(event: EspnEvent, leagueSlug: string): Match {
  const competition = event.competitions?.[0];
  const home = competition?.competitors?.find((competitor) => competitor.homeAway === "home");
  const away = competition?.competitors?.find((competitor) => competitor.homeAway === "away");
  const homeScore = parseScore(home?.score ?? null);
  const awayScore = parseScore(away?.score ?? null);

  return {
    id: `espn-${leagueSlug}-${event.id}`,
    competition: event.league?.name ?? event.league?.abbreviation ?? leagueSlug,
    homeTeam: home?.team.displayName ?? home?.team.shortDisplayName ?? event.name.split(" at ")[1] ?? "Home",
    awayTeam: away?.team.displayName ?? away?.team.shortDisplayName ?? event.name.split(" at ")[0] ?? "Away",
    startsAt: event.date,
    status: getEspnStatus(competition?.status?.type?.state, competition?.status?.type?.completed),
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

function getSportsDbStatus(status: string | null, homeScore?: number, awayScore?: number): MatchStatus {
  if (status?.toLowerCase().includes("not started")) return "scheduled";
  if (homeScore !== undefined && awayScore !== undefined && status?.toLowerCase() !== "not started") {
    return status?.toLowerCase().includes("2h") || status?.toLowerCase().includes("1h") ? "live" : "finished";
  }
  if (status && status.toLowerCase() !== "not started") return "live";
  return "scheduled";
}

function getEspnStatus(state?: string, completed?: boolean): MatchStatus {
  if (completed || state === "post") return "finished";
  if (state === "in") return "live";
  return "scheduled";
}
