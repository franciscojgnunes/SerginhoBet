import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiFootballKey = process.env.API_FOOTBALL_KEY;
const timezone = "Europe/Lisbon";

function getLocalDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}

function cleanCompetitionName(value) {
  return value
    .replace(/\s*-\s*(regular season|apertura|clausura|group stage|playoffs)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function statusFromApiFootball(shortStatus) {
  if (!shortStatus || shortStatus === "NS" || shortStatus === "TBD") return "scheduled";
  if (["FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO"].includes(shortStatus)) return "finished";
  return "live";
}

if (!supabaseUrl || !serviceRoleKey || !apiFootballKey) {
  throw new Error("Missing VITE_SUPABASE_URL/SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or API_FOOTBALL_KEY.");
}

const day = process.argv[2] || getLocalDateKey();
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${day}&timezone=${timezone}&status=NS-TBD`, {
  headers: {
    "x-apisports-key": apiFootballKey
  }
});

if (!response.ok) {
  throw new Error(`API Football request failed: ${response.status} ${await response.text()}`);
}

const payload = await response.json();
const rows = (payload.response ?? []).map((event) => ({
  id: `api-football-${event.fixture.id}`,
  day,
  competition: cleanCompetitionName(event.league.name),
  country: event.league.country ?? null,
  home_team: event.teams.home.name,
  away_team: event.teams.away.name,
  starts_at: event.fixture.date,
  status: statusFromApiFootball(event.fixture.status?.short),
  home_score: event.goals?.home ?? null,
  away_score: event.goals?.away ?? null,
  home_logo_url: event.teams.home.logo ?? null,
  away_logo_url: event.teams.away.logo ?? null,
  venue: event.fixture.venue?.name ?? null,
  source: "api"
}));

if (rows.length === 0) {
  console.log(`No matches returned for ${day}.`);
  process.exit(0);
}

const { error } = await supabase.from("matches").upsert(rows, { onConflict: "id" });
if (error) throw error;

console.log(`Imported ${rows.length} matches for ${day}.`);
