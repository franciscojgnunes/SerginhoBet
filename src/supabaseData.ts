import { supabase } from "./supabaseClient";
import type { DailySlip, League, Match, MatchOdd, Pick, PickStatus, SlipHistoryItem, User, Vote } from "./types";

type ProfileRow = {
  id: string;
  twitch_id: string | null;
  display_name: string;
  avatar_url: string | null;
  role: User["role"];
};

type MatchRow = {
  id: string;
  day: string;
  competition: string;
  country: string | null;
  home_team: string;
  away_team: string;
  starts_at: string;
  status: Match["status"];
  home_score: number | null;
  away_score: number | null;
  home_logo_url: string | null;
  away_logo_url: string | null;
  home_record: string | null;
  away_record: string | null;
  venue: string | null;
  source: Match["source"] | null;
};

type LeagueRow = {
  id: string;
  code: string;
  name: string;
  streamer_id: string | null;
};

type PickRow = {
  id: string;
  day: string;
  match_id: string;
  user_id: string;
  market_type: string;
  selection: string;
  odds: number;
  stake: number;
  bookmaker: string;
  reason: string;
  status: PickStatus;
  profit: number;
  created_at: string;
};

type VoteRow = {
  pick_id: string;
  user_id: string;
  type: Vote["type"];
};

type MatchOddRow = {
  id: string;
  match_id: string;
  market_type: string;
  selection: string;
  odds: number;
  bookmaker: string;
  fetched_at: string;
};

type SlipRow = {
  id: string;
  day: string;
  status: DailySlip["status"];
  mode: DailySlip["mode"];
  combined_stake: number;
  multiples_stake: number;
  settlement_status: PickStatus;
  profit: number;
  generated_at: string;
  published_at: string;
};

type SlipItemRow = {
  slip_id: string;
  pick_id: string;
  sort_order: number;
};

export type RemoteState = {
  profiles: User[];
  league?: League;
  matches: Match[];
  odds: MatchOdd[];
  picks: Pick[];
  votes: Vote[];
  dailySlip?: DailySlip;
  slipHistory: SlipHistoryItem[];
};

export function mapProfile(row: ProfileRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    avatarColor: row.role === "streamer" ? "#b7ff34" : "#16d782",
    avatarUrl: row.avatar_url ?? undefined
  };
}

function mapLeague(row: LeagueRow): League {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    streamerId: row.streamer_id ?? undefined
  };
}

function mapMatch(row: MatchRow): Match {
  return {
    id: row.id,
    competition: row.competition,
    country: row.country ?? undefined,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    startsAt: row.starts_at,
    status: row.status,
    homeScore: row.home_score ?? undefined,
    awayScore: row.away_score ?? undefined,
    homeLogoUrl: row.home_logo_url ?? undefined,
    awayLogoUrl: row.away_logo_url ?? undefined,
    homeRecord: row.home_record ?? undefined,
    awayRecord: row.away_record ?? undefined,
    venue: row.venue ?? undefined,
    source: row.source ?? undefined
  };
}

function normalizeMarketType(value: string): Pick["marketType"] {
  if (value === "BTTS") return "Ambas marcam";
  return value as Pick["marketType"];
}

function getLisbonDateKey(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function mapPick(row: PickRow): Pick {
  return {
    id: row.id,
    matchId: row.match_id,
    userId: row.user_id,
    marketType: normalizeMarketType(row.market_type),
    selection: row.selection,
    odds: Number(row.odds),
    stake: Number(row.stake),
    bookmaker: row.bookmaker,
    reason: row.reason,
    status: row.status,
    profit: Number(row.profit),
    createdAt: row.created_at
  };
}

function mapVote(row: VoteRow): Vote {
  return {
    pickId: row.pick_id,
    userId: row.user_id,
    type: row.type
  };
}

function mapMatchOdd(row: MatchOddRow): MatchOdd {
  return {
    id: row.id,
    matchId: row.match_id,
    marketType: normalizeMarketType(row.market_type),
    selection: row.selection,
    odds: Number(row.odds),
    bookmaker: row.bookmaker,
    fetchedAt: row.fetched_at
  };
}

function mapSlip(row: SlipRow, pickIds: string[]): SlipHistoryItem {
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    combinedStake: Number(row.combined_stake),
    multiplesStake: Number(row.multiples_stake),
    settlementStatus: row.settlement_status,
    profit: Number(row.profit),
    pickIds,
    generatedAt: row.generated_at,
    publishedAt: row.published_at
  };
}

export async function loadRemoteState(day: string, leagueCode: string, matchDays = [day]): Promise<RemoteState> {
  if (!supabase) return { profiles: [], matches: [], odds: [], picks: [], votes: [], slipHistory: [] };

  const leagueResult = await supabase.from("leagues").select("id,code,name,streamer_id").eq("code", leagueCode).maybeSingle();
  const leagueTablesReady = !leagueResult.error;
  if (leagueResult.error) {
    console.warn("League tables are not ready yet; loading unscoped state.", leagueResult.error.message);
  }
  const league = leagueResult.data ? mapLeague(leagueResult.data as LeagueRow) : undefined;
  const leagueId = league?.id;

  const picksQuery = leagueTablesReady
    ? leagueId
      ? supabase.from("picks").select("*").eq("day", day).eq("league_id", leagueId).order("created_at", { ascending: false })
      : supabase.from("picks").select("*").eq("day", day).is("league_id", null).order("created_at", { ascending: false })
    : supabase.from("picks").select("*").eq("day", day).order("created_at", { ascending: false });

  const votesQuery = leagueTablesReady && leagueId
    ? supabase.from("votes").select("*, picks!inner(league_id)").eq("picks.league_id", leagueId)
    : supabase.from("votes").select("*");

  const slipsQuery = leagueTablesReady
    ? leagueId
      ? supabase.from("daily_slips").select("*, slip_items(pick_id, sort_order)").eq("day", day).eq("league_id", leagueId).order("published_at", { ascending: false })
      : supabase.from("daily_slips").select("*, slip_items(pick_id, sort_order)").eq("day", day).is("league_id", null).order("published_at", { ascending: false })
    : supabase.from("daily_slips").select("*, slip_items(pick_id, sort_order)").eq("day", day).order("published_at", { ascending: false });

  const [profilesResult, matchesResult, oddsResult, picksResult, votesResult, slipsResult] = await Promise.all([
    supabase.from("profiles").select("id,twitch_id,display_name,avatar_url,role"),
    supabase.from("matches").select("*").in("day", matchDays).order("starts_at", { ascending: true }),
    supabase.from("match_odds").select("*").in("day", matchDays),
    picksQuery,
    votesQuery,
    slipsQuery
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (matchesResult.error) throw matchesResult.error;
  const oddsTableMissing = oddsResult.error?.code === "PGRST205" || oddsResult.error?.message?.toLowerCase().includes("match_odds");
  if (oddsResult.error && !oddsTableMissing) throw oddsResult.error;
  if (picksResult.error) throw picksResult.error;
  if (votesResult.error) throw votesResult.error;
  if (slipsResult.error) throw slipsResult.error;

  const slipHistory = (slipsResult.data ?? []).map((row) => {
    const items = [...((row as SlipRow & { slip_items?: SlipItemRow[] }).slip_items ?? [])].sort((left, right) => left.sort_order - right.sort_order);
    return mapSlip(row as SlipRow, items.map((item) => item.pick_id));
  });

  return {
    profiles: (profilesResult.data ?? []).map((row) => mapProfile(row as ProfileRow)),
    league,
    matches: (matchesResult.data ?? []).map((row) => mapMatch(row as MatchRow)),
    odds: oddsTableMissing ? [] : (oddsResult.data ?? []).map((row) => mapMatchOdd(row as MatchOddRow)),
    picks: (picksResult.data ?? []).map((row) => mapPick(row as PickRow)),
    votes: (votesResult.data ?? []).map((row) => mapVote(row as VoteRow)),
    dailySlip: slipHistory[0],
    slipHistory
  };
}

export async function saveOdds(day: string, odds: MatchOdd[]) {
  if (!supabase || odds.length === 0) return;
  const { error } = await supabase.from("match_odds").upsert(
    odds.map((odd) => ({
      id: odd.id,
      day,
      match_id: odd.matchId,
      market_type: odd.marketType,
      selection: odd.selection,
      odds: odd.odds,
      bookmaker: odd.bookmaker,
      fetched_at: odd.fetchedAt
    })),
    { onConflict: "id" }
  );
  if (error) throw error;
}

export async function saveProfile(profile: User, twitchId?: string | null, avatarUrl?: string | null) {
  if (!supabase) return;
  const { data: existing, error: readError } = await supabase.from("profiles").select("id,avatar_url").eq("id", profile.id).maybeSingle();
  if (readError) throw readError;
  if (existing) {
    const { error } = await supabase
      .from("profiles")
      .update({
        twitch_id: twitchId ?? null,
        display_name: profile.displayName,
        avatar_url: existing.avatar_url ?? avatarUrl ?? null
      })
      .eq("id", profile.id);
    if (error) throw error;
    return;
  }

  const payload = {
    twitch_id: twitchId ?? null,
    display_name: profile.displayName,
    avatar_url: avatarUrl ?? null
  };
  const { error } = await supabase.from("profiles").insert({ id: profile.id, ...payload, role: profile.role });
  if (error) throw error;
}

export async function updateProfileAvatar(userId: string, avatarUrl: string | null) {
  if (!supabase) return;
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", userId);
  if (error) throw error;
}

export async function ensureLeagueMember(leagueId: string, userId: string, role: "member" | "streamer" | "mod" = "member") {
  if (!supabase) return;
  const { error } = await supabase.from("league_members").upsert({
    league_id: leagueId,
    user_id: userId,
    role
  }, { onConflict: "league_id,user_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function saveMatch(day: string, match: Match) {
  if (!supabase) return;
  const { error } = await supabase.from("matches").upsert({
    id: match.id,
    day,
    competition: match.competition,
    country: match.country ?? null,
    home_team: match.homeTeam,
    away_team: match.awayTeam,
    starts_at: match.startsAt,
    status: match.status,
    home_score: match.homeScore ?? null,
    away_score: match.awayScore ?? null,
    home_logo_url: match.homeLogoUrl ?? null,
    away_logo_url: match.awayLogoUrl ?? null,
    home_record: match.homeRecord ?? null,
    away_record: match.awayRecord ?? null,
    venue: match.venue ?? null,
    source: match.source ?? "api"
  }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function saveMatches(matches: Match[]) {
  if (!supabase || matches.length === 0) return;
  const rows = matches.map((match) => ({
    id: match.id,
    day: getLisbonDateKey(match.startsAt),
    competition: match.competition,
    country: match.country ?? null,
    home_team: match.homeTeam,
    away_team: match.awayTeam,
    starts_at: match.startsAt,
    status: match.status,
    home_score: match.homeScore ?? null,
    away_score: match.awayScore ?? null,
    home_logo_url: match.homeLogoUrl ?? null,
    away_logo_url: match.awayLogoUrl ?? null,
    home_record: match.homeRecord ?? null,
    away_record: match.awayRecord ?? null,
    venue: match.venue ?? null,
    source: match.source ?? "api"
  }));

  for (let index = 0; index < rows.length; index += 500) {
    const { error } = await supabase
      .from("matches")
      .upsert(rows.slice(index, index + 500), { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
  }
}

export async function savePick(day: string, pick: Pick, leagueId?: string, match?: Match) {
  if (!supabase) return;
  if (match) await saveMatch(getLisbonDateKey(match.startsAt), match);

  const payload: Record<string, unknown> = {
    id: pick.id,
    day,
    match_id: pick.matchId,
    user_id: pick.userId,
    market_type: pick.marketType,
    selection: pick.selection,
    odds: pick.odds,
    stake: pick.stake,
    bookmaker: pick.bookmaker,
    reason: pick.reason,
    status: pick.status,
    profit: pick.profit,
    created_at: pick.createdAt
  };
  if (leagueId) payload.league_id = leagueId;
  const { error } = await supabase.from("picks").insert(payload);
  if (error) throw error;
}

export async function saveVote(vote: Vote) {
  if (!supabase) return;
  const { error } = await supabase.from("votes").upsert({
    pick_id: vote.pickId,
    user_id: vote.userId,
    type: vote.type
  }, { onConflict: "pick_id,user_id" });
  if (error) throw error;
}

export async function saveSlip(day: string, slip: SlipHistoryItem, leagueId?: string) {
  if (!supabase) return;
  const payload: Record<string, unknown> = {
    id: slip.id,
    day,
    status: slip.status,
    mode: slip.mode,
    combined_stake: slip.combinedStake,
    multiples_stake: slip.multiplesStake,
    settlement_status: slip.settlementStatus,
    profit: slip.profit,
    generated_at: slip.generatedAt,
    published_at: slip.publishedAt
  };
  if (leagueId) payload.league_id = leagueId;
  const { error: slipError } = await supabase.from("daily_slips").upsert(payload, { onConflict: "id" });
  if (slipError) throw slipError;

  const { error: deleteError } = await supabase.from("slip_items").delete().eq("slip_id", slip.id);
  if (deleteError) throw deleteError;

  const { error: itemError } = await supabase.from("slip_items").insert(
    slip.pickIds.map((pickId, index) => ({ slip_id: slip.id, pick_id: pickId, sort_order: index }))
  );
  if (itemError) throw itemError;
}

export async function saveSettlement(slip: SlipHistoryItem, picks: Pick[]) {
  if (!supabase) return;
  const client = supabase;
  const { error: slipError } = await supabase
    .from("daily_slips")
    .update({ settlement_status: slip.settlementStatus, profit: slip.profit })
    .eq("id", slip.id);
  if (slipError) throw slipError;

  const updates = picks.map((pick) =>
    client
      .from("picks")
      .update({ status: pick.status, profit: pick.profit })
      .eq("id", pick.id)
  );
  const results = await Promise.all(updates);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}
