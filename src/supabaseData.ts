import { supabase } from "./supabaseClient";
import type { DailySlip, Match, Pick, PickStatus, SlipHistoryItem, User, Vote } from "./types";

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

type PickRow = {
  id: string;
  day: string;
  match_id: string;
  user_id: string;
  market_type: Pick["marketType"];
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
  matches: Match[];
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
    avatarColor: row.role === "streamer" ? "#b7ff34" : "#16d782"
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

function mapPick(row: PickRow): Pick {
  return {
    id: row.id,
    matchId: row.match_id,
    userId: row.user_id,
    marketType: row.market_type,
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

export async function loadRemoteState(day: string): Promise<RemoteState> {
  if (!supabase) return { profiles: [], matches: [], picks: [], votes: [], slipHistory: [] };

  const [profilesResult, matchesResult, picksResult, votesResult, slipsResult] = await Promise.all([
    supabase.from("profiles").select("id,twitch_id,display_name,avatar_url,role"),
    supabase.from("matches").select("*").eq("day", day).order("starts_at", { ascending: true }),
    supabase.from("picks").select("*").eq("day", day).order("created_at", { ascending: false }),
    supabase.from("votes").select("*"),
    supabase.from("daily_slips").select("*, slip_items(pick_id, sort_order)").eq("day", day).order("published_at", { ascending: false })
  ]);

  if (profilesResult.error) throw profilesResult.error;
  if (matchesResult.error) throw matchesResult.error;
  if (picksResult.error) throw picksResult.error;
  if (votesResult.error) throw votesResult.error;
  if (slipsResult.error) throw slipsResult.error;

  const slipHistory = (slipsResult.data ?? []).map((row) => {
    const items = [...((row as SlipRow & { slip_items?: SlipItemRow[] }).slip_items ?? [])].sort((left, right) => left.sort_order - right.sort_order);
    return mapSlip(row as SlipRow, items.map((item) => item.pick_id));
  });

  return {
    profiles: (profilesResult.data ?? []).map((row) => mapProfile(row as ProfileRow)),
    matches: (matchesResult.data ?? []).map((row) => mapMatch(row as MatchRow)),
    picks: (picksResult.data ?? []).map((row) => mapPick(row as PickRow)),
    votes: (votesResult.data ?? []).map((row) => mapVote(row as VoteRow)),
    dailySlip: slipHistory[0],
    slipHistory
  };
}

export async function saveProfile(profile: User, twitchId?: string | null, avatarUrl?: string | null) {
  if (!supabase) return;
  const { data: existing, error: readError } = await supabase.from("profiles").select("id").eq("id", profile.id).maybeSingle();
  if (readError) throw readError;
  if (existing) return;

  const payload = {
    twitch_id: twitchId ?? null,
    display_name: profile.displayName,
    avatar_url: avatarUrl ?? null
  };
  const { error } = await supabase.from("profiles").insert({ id: profile.id, ...payload, role: profile.role });
  if (error) throw error;
}

export async function savePick(day: string, pick: Pick) {
  if (!supabase) return;
  const { error } = await supabase.from("picks").insert({
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
  });
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

export async function saveSlip(day: string, slip: SlipHistoryItem) {
  if (!supabase) return;
  const { error: slipError } = await supabase.from("daily_slips").upsert({
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
  }, { onConflict: "id" });
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
