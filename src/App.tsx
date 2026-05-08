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
import { FormEvent, useEffect, useMemo, useState } from "react";
import { users } from "./data";
import {
  buildProfitTimeline,
  calculateBankroll,
  calculateDailyStats,
  calculateProfit,
  filterUpcomingScheduledMatches,
  getLocalDateKey,
  roundUnits,
  scorePick,
  selectSlipPicks
} from "./domain";
import { fetchTodayMatches } from "./sportsApi";
import { getSiteUrl, isSupabaseConfigured, supabase } from "./supabaseClient";
import { ensureLeagueMember, loadRemoteState, savePick, saveProfile, saveSettlement, saveSlip, saveVote, updateProfileAvatar } from "./supabaseData";
import type { DailySlip, League, MarketType, Match, Pick, PickStatus, SlipHistoryItem, User, Vote as VoteRecord, VoteType } from "./types";

const currentDate = new Date();
const tipDay = getLocalDateKey(currentDate);
const communityInitialBankroll = 100;
const hasApiFootballKey = Boolean(import.meta.env.VITE_API_FOOTBALL_KEY);
const matchesCacheKey = `pickroom:matches:${tipDay}:${hasApiFootballKey ? "api-football-v2" : "free-v1"}`;
const picksCacheKey = `pickroom:picks:${tipDay}`;
const votesCacheKey = `pickroom:votes:${tipDay}`;
const slipCacheKey = `pickroom:slip:${tipDay}`;
const slipHistoryCacheKey = `pickroom:slip-history:${tipDay}`;
const defaultLeagueCode = "SERGINHO";

const marketOptions: MarketType[] = [
  "1X2",
  "Dupla chance",
  "Over/Under",
  "BTTS",
  "Handicap",
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
  BTTS: "Ambas marcam: Sim",
  Handicap: "Casa -1.0",
  "Resultado correto": "2-1",
  "Intervalo/Final": "Empate / Casa",
  Marcador: "Jogador marca a qualquer momento",
  Cartoes: "Mais de 4.5 cartoes",
  Cantos: "Mais de 8.5 cantos",
  Outro: "Escreve o mercado"
};

type Page = "games" | "community" | "viewer" | "resolve" | "history" | "stats" | "profile";
type StatsScope = ReturnType<typeof buildStatsScope>;
type SyncStatus = "idle" | "loading" | "ready" | "saving" | "error";

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

function formatKickoff(value: string) {
  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
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
  return runtimeUsers.find((user) => user.id === userId) ?? users.find((user) => user.id === userId) ?? users[0];
}

function buildStatsScope(label: string, picks: Pick[], slips: SlipHistoryItem[], filter: (value: string) => boolean) {
  const scopePicks = picks.filter((pick) => filter(pick.createdAt));
  const scopeSlips = slips.filter((slip) => filter(slip.publishedAt));
  const selectedIds = new Set(scopeSlips.flatMap((slip) => slip.pickIds));
  const settledSlips = scopeSlips.filter((slip) => slip.settlementStatus !== "pending");
  const staked = roundUnits(settledSlips.reduce((total, slip) => total + (slip.mode === "combined" ? slip.combinedStake : slip.multiplesStake * slip.pickIds.length), 0));
  const profit = roundUnits(settledSlips.reduce((total, slip) => total + slip.profit, 0));

  return {
    label,
    total: {
      submitted: scopePicks.length,
      selected: selectedIds.size,
      settled: settledSlips.length,
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

      for (const slip of settledSlips) {
        const slipPicks = slip.pickIds.map((pickId) => picks.find((pick) => pick.id === pickId)).filter((pick): pick is Pick => Boolean(pick));
        const viewerPickCount = slipPicks.filter((pick) => pick.userId === user.id).length;
        if (viewerPickCount === 0 || slipPicks.length === 0) continue;
        const slipStake = slip.mode === "combined" ? slip.combinedStake : slip.multiplesStake * slip.pickIds.length;
        settled += viewerPickCount;
        viewerStake += (slipStake / slipPicks.length) * viewerPickCount;
        viewerProfit += (slip.profit / slipPicks.length) * viewerPickCount;
      }

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
    }).sort((left, right) => right.profit - left.profit || right.selected - left.selected || right.submitted - left.submitted)
  };
}

function buildSlipTimeline(slips: SlipHistoryItem[], filter: (value: string) => boolean) {
  let cumulative = 0;
  return slips
    .filter((slip) => slip.settlementStatus !== "pending" && filter(slip.publishedAt))
    .sort((left, right) => new Date(left.publishedAt).getTime() - new Date(right.publishedAt).getTime())
    .map((slip) => {
      cumulative = roundUnits(cumulative + slip.profit);
      return {
        label: new Date(slip.publishedAt).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" }),
        profit: slip.profit,
        cumulative
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
    .sort((a, b) => b.profit - a.profit || b.roi - a.roi || b.winrate - a.winrate);
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

export function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeUserId, setActiveUserId] = useState("u-serginho");
  const [authProfile, setAuthProfile] = useState<User | null>(null);
  const [remoteProfiles, setRemoteProfiles] = useState<User[]>([]);
  const [activeLeague, setActiveLeague] = useState<League | null>(null);
  const [twitchAvatarUrl, setTwitchAvatarUrl] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<SyncStatus>("loading");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [matches, setMatches] = useState<Match[]>(() => readStoredValue<Match[]>(matchesCacheKey, []));
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [matchSync, setMatchSync] = useState<"loading" | "live" | "empty">(() => (
    readStoredValue<Match[]>(matchesCacheKey, []).length > 0 ? "live" : "loading"
  ));
  const [picks, setPicks] = useState<Pick[]>(() => readStoredValue<Pick[]>(picksCacheKey, []));
  const [votes, setVotes] = useState<VoteRecord[]>(() => readStoredValue<VoteRecord[]>(votesCacheKey, []));
  const [dailySlip, setDailySlip] = useState<DailySlip>(() => readStoredValue<DailySlip>(slipCacheKey, createDefaultDailySlip()));
  const [slipHistory, setSlipHistory] = useState<SlipHistoryItem[]>(() => readStoredValue<SlipHistoryItem[]>(slipHistoryCacheKey, []));
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
      const upcomingMatches = filterUpcomingScheduledMatches(matches);
      setSelectedMatchId(upcomingMatches[0]?.id ?? "");
      return;
    }
    void syncTodayMatches();
  }, []);

  useEffect(() => writeStoredValue(matchesCacheKey, matches), [matches]);
  useEffect(() => writeStoredValue(picksCacheKey, picks), [picks]);
  useEffect(() => writeStoredValue(votesCacheKey, votes), [votes]);
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
        role: "viewer",
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
    if (!isLoggedIn || !isSupabaseConfigured) return;

    let mounted = true;
    let inFlight = false;
    async function loadSharedState(showLoading = false) {
      if (inFlight) return;
      inFlight = true;
      if (showLoading) setSyncStatus("loading");
      try {
        const remote = await loadRemoteState(tipDay, defaultLeagueCode);
        if (!mounted) return;
        setRemoteProfiles(remote.profiles);
        setActiveLeague(remote.league ?? null);
        if (remote.league && authProfile) {
          void ensureLeagueMember(remote.league.id, authProfile.id, authProfile.role === "streamer" ? "streamer" : authProfile.role === "mod" ? "mod" : "member");
        }
        if (remote.matches.length > 0) {
          setMatches((current) => mergeById([...current, ...remote.matches]));
          setSelectedMatchId((current) => {
            const mergedMatches = mergeById([...matches, ...remote.matches]);
            return mergedMatches.some((match) => match.id === current) ? current : filterUpcomingScheduledMatches(mergedMatches)[0]?.id ?? "";
          });
          setMatchSync("live");
        }
        setPicks(remote.picks);
        setVotes(remote.votes);
        if (remote.dailySlip) setDailySlip(remote.dailySlip);
        setSlipHistory(remote.slipHistory);
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
  }, [authProfile, isLoggedIn]);

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
    const cachedMatches = readStoredValue<Match[]>(matchesCacheKey, []);
    if (!forceRefresh && cachedMatches.length > 0) {
      const upcomingMatches = filterUpcomingScheduledMatches(cachedMatches);
      setMatches(cachedMatches);
      setSelectedMatchId(upcomingMatches[0]?.id ?? "");
      setMatchSync("live");
      return;
    }

    try {
      const todayMatches = await fetchTodayMatches(currentDate, { forceRefresh });
      const upcomingMatches = filterUpcomingScheduledMatches(todayMatches);
      if (todayMatches.length > 0) {
        setMatches(todayMatches);
        setSelectedMatchId(upcomingMatches[0]?.id ?? "");
        setMatchSync("live");
        return;
      }
      if (cachedMatches.length > 0) {
        const upcomingCachedMatches = filterUpcomingScheduledMatches(cachedMatches);
        setMatches(cachedMatches);
        setSelectedMatchId(upcomingCachedMatches[0]?.id ?? "");
        setMatchSync("live");
        return;
      }
      setMatches([]);
      setSelectedMatchId("");
      setMatchSync("empty");
    } catch {
      if (cachedMatches.length > 0) {
        const upcomingCachedMatches = filterUpcomingScheduledMatches(cachedMatches);
        setMatches(cachedMatches);
        setSelectedMatchId(upcomingCachedMatches[0]?.id ?? "");
        setMatchSync("live");
      } else {
        setMatches([]);
        setSelectedMatchId("");
        setMatchSync("empty");
      }
    }
  }

  const remoteActiveProfile = remoteProfiles.find((profile) => profile.id === activeUserId);
  const activeUser = remoteActiveProfile ?? authProfile ?? userById(activeUserId);
  const isStreamer = activeUser.role === "streamer";
  const scheduledMatches = useMemo(() => filterUpcomingScheduledMatches(matches), [matches]);
  const competitionOptions = useMemo(
    () => ["all", ...Array.from(new Set(scheduledMatches.map((match) => match.competition))).sort((a, b) => a.localeCompare(b))],
    [scheduledMatches]
  );
  const visibleMatches = useMemo(
    () => {
      const normalizedQuery = matchSearch.trim().toLowerCase();
      return scheduledMatches.filter((match) => {
        const matchesCompetition = competitionFilter === "all" || match.competition === competitionFilter;
        const matchesSearch = normalizedQuery.length === 0
          || match.competition.toLowerCase().includes(normalizedQuery)
          || match.homeTeam.toLowerCase().includes(normalizedQuery)
          || match.awayTeam.toLowerCase().includes(normalizedQuery)
          || match.country?.toLowerCase().includes(normalizedQuery);
        return matchesCompetition && matchesSearch;
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
  const isPickBeforeKickoff = (pick: Pick) => {
    const match = matches.find((item) => item.id === pick.matchId);
    return !match || new Date(match.startsAt).getTime() > kickoffCheckAt;
  };
  const selectedMatchPicks = selectedMatch ? picks.filter((pick) => pick.matchId === selectedMatch.id && isPickBeforeKickoff(pick)) : [];
  const communityPicks = [...picks]
    .filter(isPickBeforeKickoff)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const topSlipPicks = dailySlip.pickIds
    .map((pickId) => picks.find((pick) => pick.id === pickId))
    .filter((pick): pick is Pick => Boolean(pick));
  const resolvableSlipHistory = slipHistory.filter((slip) => slip.settlementStatus === "pending");
  const selectedResolveSlip = resolvableSlipHistory.find((slip) => slip.id === selectedResolveSlipId) ?? resolvableSlipHistory[0];
  const selectedResolvePicks = selectedResolveSlip
    ? selectedResolveSlip.pickIds.map((pickId) => picks.find((pick) => pick.id === pickId)).filter((pick): pick is Pick => Boolean(pick))
    : [];

  const combinedOdds = topSlipPicks.reduce((total, pick) => total * pick.odds, 1);
  const selectedResolveCombinedOdds = selectedResolvePicks.reduce((total, pick) => total * pick.odds, 1);
  const multiplesStake = topSlipPicks.length * dailySlip.multiplesStake;
  const isPublishedSlip = dailySlip.status === "published" && topSlipPicks.length > 0;
  const combinedSlipSettled = dailySlip.mode === "combined" && dailySlip.settlementStatus !== "pending";
  const slipExposure = isPublishedSlip && !combinedSlipSettled
    ? dailySlip.mode === "combined" ? dailySlip.combinedStake : multiplesStake
    : 0;
  const baseBankroll = calculateBankroll(communityInitialBankroll, picks, dailySlip.pickIds);
  const communityBankroll = dailySlip.mode === "combined"
    ? {
        initial: communityInitialBankroll,
        current: roundUnits(communityInitialBankroll + dailySlip.profit),
        exposure: slipExposure,
        settledProfit: dailySlip.settlementStatus === "pending" ? 0 : dailySlip.profit,
        roi: dailySlip.settlementStatus !== "pending" && dailySlip.combinedStake > 0
          ? roundUnits((dailySlip.profit / dailySlip.combinedStake) * 100)
          : 0
      }
    : { ...baseBankroll, exposure: slipExposure };
  const dailyStats = calculateDailyStats(picks, dailySlip.pickIds, tipDay);
  const profitTimeline = buildProfitTimeline(picks, dailySlip.pickIds);
  const allStoredPicks = useMemo(() => mergeById([...readStoredCollections<Pick>("pickroom:picks:"), ...picks]), [picks]);
  const allStoredSlips = useMemo(() => mergeById([...readStoredCollections<SlipHistoryItem>("pickroom:slip-history:"), ...slipHistory]), [slipHistory]);
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
  const monthProfitTimeline = useMemo(
    () => buildSlipTimeline(allStoredSlips, (value) => value.slice(0, 7) === monthKey),
    [allStoredSlips, monthKey]
  );
  const allTimeProfitTimeline = useMemo(
    () => buildSlipTimeline(allStoredSlips, () => true),
    [allStoredSlips]
  );
  const displayedDailyStats = dailySlip.mode === "combined" && dailySlip.status === "published"
    ? {
        ...dailyStats,
        total: {
          ...dailyStats.total,
          settled: dailySlip.settlementStatus === "pending" ? 0 : 1,
          pendingSelected: dailySlip.settlementStatus === "pending" ? topSlipPicks.length : 0,
          staked: dailySlip.settlementStatus === "pending" ? 0 : dailySlip.combinedStake,
          profit: dailySlip.settlementStatus === "pending" ? 0 : dailySlip.profit,
          roi: dailySlip.settlementStatus !== "pending" && dailySlip.combinedStake > 0
            ? roundUnits((dailySlip.profit / dailySlip.combinedStake) * 100)
            : 0
        },
        byViewer: dailyStats.byViewer.map((row) => {
          const selectedByViewer = topSlipPicks.filter((pick) => pick.userId === row.userId).length;
          if (selectedByViewer === 0) return row;
          const stakeShare = dailySlip.settlementStatus === "pending" ? 0 : roundUnits((dailySlip.combinedStake / topSlipPicks.length) * selectedByViewer);
          const profitShare = dailySlip.settlementStatus === "pending" ? 0 : roundUnits((dailySlip.profit / topSlipPicks.length) * selectedByViewer);
          return {
            ...row,
            settled: dailySlip.settlementStatus === "pending" ? 0 : selectedByViewer,
            pendingSelected: dailySlip.settlementStatus === "pending" ? selectedByViewer : 0,
            staked: stakeShare,
            profit: profitShare,
            roi: stakeShare > 0 ? roundUnits((profitShare / stakeShare) * 100) : 0
          };
        })
      }
    : dailyStats;
  const displayedProfitTimeline = dailySlip.mode === "combined" && dailySlip.status === "published" && dailySlip.settlementStatus !== "pending"
    ? [{ label: "Boletim", profit: dailySlip.profit, cumulative: dailySlip.profit }]
    : profitTimeline;
  const displayedDayScope = { ...dayScope, total: displayedDailyStats.total, byViewer: displayedDailyStats.byViewer };

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

  function submitPick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const odds = Number(formState.odds);
    const stake = Number(formState.stake);
    const targetMatch = tipModalMatch ?? selectedMatch;
    if (!targetMatch || !formState.selection.trim() || odds <= 1 || stake <= 0) return;

    const nextPick: Pick = {
      id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      matchId: targetMatch.id,
      userId: activeUserId,
      marketType: formState.marketType,
      selection: formState.selection.trim(),
      odds,
      stake,
      bookmaker: formState.bookmaker.trim() || "Manual",
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
    setFormState({ marketType: "1X2", selection: "", odds: "2.00", stake: "1", bookmaker: "Manual", reason: "" });
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

  function generateSlip() {
    setDailySlip((slip) => ({
      ...slip,
      status: "draft",
      settlementStatus: "pending",
      profit: 0,
      pickIds: selectSlipPicks(picks, votes, 4).map((pick) => pick.id),
      generatedAt: new Date().toISOString()
    }));
  }

  function publishSlip() {
    const publishedAt = new Date().toISOString();
    const historyId = `slip-${Date.now()}`;
    const nextSlip: DailySlip = {
      ...dailySlip,
      status: "published",
      settlementStatus: "pending",
      profit: 0,
      pickIds: dailySlip.pickIds.length > 0 ? dailySlip.pickIds : selectSlipPicks(picks, votes, 4).map((pick) => pick.id),
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
    setDailySlip((slip) => {
      const exists = slip.pickIds.includes(pickId);
      return {
        ...slip,
        status: "draft",
        settlementStatus: "pending",
        profit: 0,
        pickIds: exists ? slip.pickIds.filter((id) => id !== pickId) : [...slip.pickIds, pickId]
      };
    });
  }

  function setSlipMode(mode: DailySlip["mode"]) {
    setDailySlip((slip) => ({ ...slip, status: "draft", settlementStatus: "pending", profit: 0, mode }));
  }

  function setCombinedStake(value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    setDailySlip((slip) => ({ ...slip, status: "draft", settlementStatus: "pending", profit: 0, combinedStake: value }));
  }

  function setMultiplesStake(value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    setDailySlip((slip) => ({ ...slip, status: "draft", settlementStatus: "pending", profit: 0, multiplesStake: value }));
  }

  function settlePick(slipId: string, pickId: string, status: PickStatus) {
    const slip = slipHistory.find((item) => item.id === slipId);
    if (!slip) return;
    const nextPicks = picks.map((pick) => {
      if (pick.id !== pickId) return pick;
      const finalStake = slip.mode === "multiples" && slip.pickIds.includes(pickId) ? slip.multiplesStake : pick.stake;
      return { ...pick, stake: finalStake, status, profit: calculateProfit(status, finalStake, pick.odds) };
    });
    const slipPicks = slip.pickIds
      .map((id) => nextPicks.find((pick) => pick.id === id))
      .filter((pick): pick is Pick => Boolean(pick));
    const profit = roundUnits(slipPicks.reduce((total, pick) => total + pick.profit, 0));
    const settlementStatus: PickStatus = slipPicks.some((pick) => pick.status === "pending")
      ? "pending"
      : profit > 0 ? "won" : profit < 0 ? "lost" : "void";
    const nextSlip = { ...slip, settlementStatus, profit };

    setPicks(nextPicks);
    setSlipHistory((current) =>
      current.map((item) => (item.id === slipId ? nextSlip : item))
    );
    if (slip.generatedAt === dailySlip.generatedAt) {
      setDailySlip((current) => ({ ...current, settlementStatus, profit }));
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
    const slipPicks = slip.pickIds
      .map((pickId) => picks.find((pick) => pick.id === pickId))
      .filter((pick): pick is Pick => Boolean(pick));
    const odds = slipPicks.reduce((total, pick) => total * pick.odds, 1);
    const profit = calculateProfit(status, slip.combinedStake, odds);
    const nextSlip = { ...slip, settlementStatus: status, profit };
    setSlipHistory((current) =>
      current.map((item) => (item.id === slipId ? nextSlip : item))
    );
    if (slip.generatedAt === dailySlip.generatedAt) {
      setDailySlip((current) => ({ ...current, settlementStatus: status, profit }));
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

  function renderPickCard(pick: Pick) {
    const author = userById(pick.userId);
    const match = matches.find((item) => item.id === pick.matchId);
    const score = scorePick(pick.id, votes);
    const selected = dailySlip.pickIds.includes(pick.id);

    return (
      <article className={`pick-card ${selected ? "final" : ""}`} key={pick.id}>
        <div className="pick-header">
          <div className="author">
            <Avatar user={author} />
            <div>
              <strong>{author.displayName}</strong>
              <span>{pick.marketType}</span>
            </div>
          </div>
          <div className="pick-header-actions">
            <div className="score-badge" aria-label={`Score ${score}`}>
              <span>Score</span>
              <strong>{score}</strong>
            </div>
            <div className={`status ${pick.status}`}>{selected ? "Final" : statusLabel(pick.status)}</div>
          </div>
        </div>
        <div className="pick-body">
          <h4>{pick.selection}</h4>
          <p>{pick.reason}</p>
        </div>
        <div className="pick-meta">
          <span>@{pick.odds.toFixed(2)}</span>
          <span>{pick.stake}u</span>
          <span>{pick.bookmaker}</span>
          {match ? <span>{match.homeTeam} vs {match.awayTeam}</span> : null}
        </div>
        <div className="vote-row">
          <button onClick={() => castVote(pick.id, "trust")} disabled={pick.userId === activeUserId}>
            <ThumbsUp size={16} />
            Confio
          </button>
          <button onClick={() => castVote(pick.id, "doubt")} disabled={pick.userId === activeUserId}>
            <ThumbsDown size={16} />
            Não confio
          </button>
          <button onClick={() => castVote(pick.id, "strong")} disabled={pick.userId === activeUserId}>
            <Flame size={16} />
            Forte
          </button>
          {isStreamer ? (
            <button className="streamer-action" onClick={() => toggleFinalPick(pick.id)}>
              <ShieldCheck size={16} />
              {selected ? "Remover final" : "Escolher final"}
            </button>
          ) : null}
        </div>
      </article>
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
          <p>Entra obrigatoriamente com Twitch para sugerir, votar e acompanhar a aposta da comunidade.</p>
          <span className="login-league-badge">Liga {activeLeague?.code ?? defaultLeagueCode}</span>
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
            <button className={activePage === "history" ? "active" : ""} onClick={() => setActivePage("history")}>Histórico</button>
            <button className={activePage === "stats" ? "active" : ""} onClick={() => setActivePage("stats")}>Estatísticas</button>
            <button className={activePage === "profile" ? "active" : ""} onClick={() => setActivePage("profile")}>Perfil</button>
          </div>
          <LogIn size={18} />
          <span className="auth-name">{activeUser.displayName}</span>
          <span className="league-pill">Liga {activeLeague?.code ?? defaultLeagueCode}</span>
          <span className="role-pill">{activeUser.role}</span>
          <span className={`sync-pill ${syncStatus}`}>{syncStatus === "ready" ? "online" : syncStatus}</span>
          <button className="logout-button" onClick={logout}>Sair</button>
        </div>
      </header>

      {activePage === "games" ? (
        <section className="games-page">
          <section className="panel games-center">
            <div className="section-title spread games-toolbar">
              <div><CalendarDays size={18} /><h3>Jogos de hoje</h3></div>
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
                      {competition === "all" ? "Todas as competições" : competition}
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
                  <span className="game-competition">{match.competition}</span>
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
                  <span>Competição <b>{selectedMatch.competition}</b></span>
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
                  {selectedMatchPicks.slice(0, 3).map(renderPickCard)}
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
              <span>{communityPicks.length} tips</span>
            </div>
            <div className="pick-stack">
              {communityPicks.map(renderPickCard)}
              {communityPicks.length === 0 ? <p className="empty-copy">Ainda não existem tips. Vai à aba Jogos, abre um jogo e cria a primeira.</p> : null}
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
                    Stake da combinada
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={dailySlip.combinedStake}
                      onChange={(event) => setCombinedStake(Number(event.target.value))}
                    />
                  </label>
                ) : (
                  <label className="combined-stake-field">
                    Stake por múltipla
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={dailySlip.multiplesStake}
                      onChange={(event) => setMultiplesStake(Number(event.target.value))}
                    />
                  </label>
                )}
                <div className="candidate-list final-only-list">
                  {topSlipPicks.map((pick) => {
                    const match = matches.find((item) => item.id === pick.matchId);
                    const author = userById(pick.userId);
                    return (
                      <div className="candidate-row selected" key={pick.id}>
                        <div>
                          <strong>{pick.selection}</strong>
                          <small>{author.displayName} · {match?.homeTeam} vs {match?.awayTeam} · Score {scorePick(pick.id, votes)}</small>
                        </div>
                        <button onClick={() => toggleFinalPick(pick.id)}>Remover</button>
                      </div>
                    );
                  })}
                  {topSlipPicks.length === 0 ? (
                    <p className="empty-copy">Ainda nÃ£o existem picks finais. Usa "Preencher por votos" ou escolhe uma tip na lista da comunidade.</p>
                  ) : null}
                </div>
              </section>
            ) : null}
            <SlipPanel
              picks={topSlipPicks}
              matches={matches}
              combinedOdds={combinedOdds}
              combinedStake={dailySlip.combinedStake}
              multiplesUnitStake={dailySlip.multiplesStake}
              multiplesStake={multiplesStake}
              mode={dailySlip.mode}
              status={dailySlip.status}
            />
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
          onSettlePick={(slipId, pickId, status) => setPendingSettlement({ kind: "pick", slipId, pickId, status })}
          onSettleCombined={(slipId, status) => setPendingSettlement({ kind: "combined", slipId, status })}
        />
      ) : null}

      {activePage === "history" ? (
        <HistoryPage
          user={activeUser}
          isStreamer={isStreamer}
          allPicks={picks}
          matches={matches}
          slipHistory={slipHistory}
          votes={votes}
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
  activeUser,
  onSubmit,
  onChange,
  onClose
}: {
  formState: { marketType: MarketType; selection: string; odds: string; stake: string; bookmaker: string; reason: string };
  selectedMatch: Match;
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
            <span>{selectedMatch.competition}</span>
            <h3 id="tip-modal-title">{selectedMatch.homeTeam} vs {selectedMatch.awayTeam}</h3>
            <p>{formatKickoff(selectedMatch.startsAt)}</p>
          </div>
          <button type="button" onClick={onClose}>Fechar</button>
        </div>
        <TipForm
          formState={formState}
          selectedMatch={selectedMatch}
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
  const pendingPicks = picks
    .filter((pick) => pick.status === "pending")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const resolvedPicks = picks
    .filter((pick) => pick.status !== "pending")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const pendingSlipHistory = slipHistory.filter((item) => item.settlementStatus === "pending");
  const [showFinalPicks, setShowFinalPicks] = useState(false);
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
                <small>{author.displayName} - {match ? `${match.homeTeam} vs ${match.awayTeam}` : "Jogo indisponivel"} - @{pick.odds.toFixed(2)} - Score {scorePick(pick.id, votes)}</small>
              </div>
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
          <div><ShieldCheck size={18} /><h3>Aposta da comunidade</h3></div>
          <span>{isPublished ? "Registada" : "Ainda nao registada"}</span>
        </div>
        <div className={`viewer-slip-state ${isPublished ? "published" : "draft"}`}>
          <strong>{isPublished ? "Boletim publicado pelo SerginhoEsteves" : "O streamer ainda nao publicou a aposta final"}</strong>
          <p>
            {isPublished
              ? `${slipModeLabel} com ${finalPicks.length} tips finais.`
              : "Quando for publicado, aparece aqui o tipo de aposta, stake, odd e as tuas tips escolhidas."}
          </p>
        </div>
        <div className="viewer-slip-metrics">
          <span>Tipo <b>{slipModeLabel}</b></span>
          <span>Stake <b>{isPublished ? `${slipStake.toFixed(2)}u` : "0.00u"}</b></span>
          <span>Odd combinada <b>{dailySlip.mode === "combined" && isPublished ? combinedOdds.toFixed(2) : "-"}</b></span>
          <span>Estado <b>{isPublished ? statusLabel(dailySlip.mode === "combined" ? dailySlip.settlementStatus : "pending") : "Draft"}</b></span>
        </div>
        <div className="viewer-final-list">
          {isPublished ? (
            <div className="viewer-final-dropdown">
              <button className="viewer-final-toggle" onClick={() => setShowFinalPicks((current) => !current)}>
                <span>{showFinalPicks ? "Esconder jogos do boletim" : "Ver jogos do boletim"}</span>
                <b>{finalPicks.length}</b>
              </button>
              {showFinalPicks ? <div className="viewer-final-expanded">
                {finalPicks.map((pick, index) => {
                  const match = matches.find((item) => item.id === pick.matchId);
                  const author = userById(pick.userId);
                  return (
                    <article className="viewer-final-card" key={pick.id}>
                      <small>#{index + 1} - {author.displayName}</small>
                      <strong>{pick.selection}</strong>
                      <span>{match ? `${match.homeTeam} vs ${match.awayTeam}` : "Jogo indisponivel"}</span>
                      <small>@{pick.odds.toFixed(2)} - Score {scorePick(pick.id, votes)}</small>
                    </article>
                  );
                })}
              </div> : null}
            </div>
          ) : null}
          {false ? userFinalPicks.map((pick) => {
            const match = matches.find((item) => item.id === pick.matchId);
            return (
              <article className="viewer-final-card" key={pick.id}>
                <strong>{pick.selection}</strong>
                <span>{match ? `${match.homeTeam} vs ${match.awayTeam}` : "Jogo indisponivel"}</span>
                <small>@{pick.odds.toFixed(2)} · Score {scorePick(pick.id, votes)}</small>
              </article>
            );
          }) : null}
          {isPublished && userFinalPicks.length === 0 ? <p className="empty-copy">Nenhuma das tuas tips entrou na aposta final de hoje.</p> : null}
          {!isPublished ? <p className="empty-copy">Aposta ainda por registar. Continua a submeter e votar tips na comunidade.</p> : null}
        </div>
      </section>

      <section className="panel viewer-pending-panel">
        <div className="section-title spread">
          <div><Activity size={18} /><h3>Pendentes por resolver</h3></div>
          <span>{pendingPicks.length + pendingSlipHistory.length}</span>
        </div>
        <div className="viewer-pending-list">
          {pendingSlipHistory.map((slip, index) => (
            <article className="slip-history-card" key={slip.id}>
              <button className="viewer-pending-row slip-expand-toggle" onClick={() => toggleExpandedSlip(slip.id)}>
                <div>
                  <strong>Boletim #{slipHistory.length - index}</strong>
                  <span>{slip.mode === "combined" ? "Combinada" : "Multiplas"} com {slip.pickIds.length} picks</span>
                </div>
                <b>{expandedSlipIds.has(slip.id) ? "Esconder" : `${slip.mode === "combined" ? `${slip.combinedStake.toFixed(2)}u` : `${(slip.multiplesStake * slip.pickIds.length).toFixed(2)}u`}`}</b>
              </button>
              {expandedSlipIds.has(slip.id) ? renderSlipDetailList(slip) : null}
            </article>
          ))}
          {pendingPicks.map((pick) => {
            const match = matches.find((item) => item.id === pick.matchId);
            return (
              <article className="viewer-pending-row" key={pick.id}>
                <div>
                  <strong>{pick.selection}</strong>
                  <span>{match ? `${match.homeTeam} vs ${match.awayTeam}` : "Jogo indisponivel"}</span>
                </div>
                <b>@{pick.odds.toFixed(2)}</b>
              </article>
            );
          })}
          {pendingPicks.length === 0 && pendingSlipHistory.length === 0 ? (
            <p className="empty-copy">Nao tens tips nem boletins pendentes neste momento.</p>
          ) : null}
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
                  <span>{new Date(slip.publishedAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })} - {slip.mode === "combined" ? "Combinada" : "Multiplas"} com {slip.pickIds.length} picks</span>
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
                    <span>{match ? `${match.homeTeam} vs ${match.awayTeam}` : "Jogo indisponivel"}</span>
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

function HistoryPage({
  user,
  isStreamer,
  allPicks,
  matches,
  slipHistory,
  votes
}: {
  user: User;
  isStreamer: boolean;
  allPicks: Pick[];
  matches: Match[];
  slipHistory: SlipHistoryItem[];
  votes: VoteRecord[];
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
                <small>{author.displayName} - {match ? `${match.homeTeam} vs ${match.awayTeam}` : "Jogo indisponivel"} - @{pick.odds.toFixed(2)} - Score {scorePick(pick.id, votes)}</small>
              </div>
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
                  <span>{new Date(slip.publishedAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })} - {slip.mode === "combined" ? "Combinada" : "Multiplas"} com {slip.pickIds.length} picks</span>
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
  activeUser,
  onSubmit,
  onChange
}: {
  formState: { marketType: MarketType; selection: string; odds: string; stake: string; bookmaker: string; reason: string };
  selectedMatch?: Match;
  activeUser: User;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChange: React.Dispatch<React.SetStateAction<{ marketType: MarketType; selection: string; odds: string; stake: string; bookmaker: string; reason: string }>>;
}) {
  return (
    <section className="viewer-control">
      <div className="section-title">
        <Vote size={18} />
        <h3>Criar tip como {activeUser.displayName}</h3>
      </div>
      <form className="pick-form" onSubmit={onSubmit}>
        <label>
          Mercado
          <select value={formState.marketType} onChange={(event) => onChange((state) => ({ ...state, marketType: event.target.value as MarketType, selection: "" }))}>
            {marketOptions.map((market) => <option key={market}>{market}</option>)}
          </select>
        </label>
        <label className="selection-field">
          Pick
          <input placeholder={marketPlaceholders[formState.marketType]} value={formState.selection} onChange={(event) => onChange((state) => ({ ...state, selection: event.target.value }))} />
        </label>
        <label>
          Odd
          <input type="number" step="0.01" min="1.01" value={formState.odds} onChange={(event) => onChange((state) => ({ ...state, odds: event.target.value }))} />
        </label>
        <label>
          Stake
          <input type="number" step="0.5" min="0.5" value={formState.stake} onChange={(event) => onChange((state) => ({ ...state, stake: event.target.value }))} />
        </label>
        <label>
          Fonte
          <input placeholder="Bookmaker" value={formState.bookmaker} onChange={(event) => onChange((state) => ({ ...state, bookmaker: event.target.value }))} />
        </label>
        <label className="reason-field">
          Argumento opcional
          <textarea placeholder="Porque é que a comunidade deve confiar nesta pick?" value={formState.reason} onChange={(event) => onChange((state) => ({ ...state, reason: event.target.value }))} />
        </label>
        <button type="submit" disabled={!selectedMatch}>Submeter tip</button>
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

function ResolvePage({
  selectedSlip,
  slipHistory,
  picks,
  matches,
  combinedOdds,
  selectedSlipId,
  onSelectSlip,
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
            Boletim #{slipHistory.length - index} - {slip.mode === "combined" ? "Combinada" : "Multiplas"} - {new Date(slip.publishedAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
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
                      <small>{author.displayName} - {match ? `${match.homeTeam} vs ${match.awayTeam}` : "Jogo indisponivel"} - @{pick.odds.toFixed(2)}</small>
                    </div>
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
                    <span>{match ? `${match.homeTeam} vs ${match.awayTeam}` : "Jogo indisponivel"}</span>
                  </div>
                </div>
                <div>
                  <strong>{pick.selection}</strong>
                  <small>{pick.marketType} - @{pick.odds.toFixed(2)} - {selectedSlip.multiplesStake}u</small>
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
                    <span>{match ? `${match.homeTeam} vs ${match.awayTeam}` : "Jogo indisponível"}</span>
                  </div>
                </div>
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
  dayTimeline: Array<{ label: string; profit: number; cumulative: number }>;
  monthTimeline: Array<{ label: string; profit: number; cumulative: number }>;
  allTimeTimeline: Array<{ label: string; profit: number; cumulative: number }>;
  monthlyLeaderboard: Array<{ user: User; picks: number; profit: number; roi: number; winrate: number }>;
  generalLeaderboard: Array<{ user: User; picks: number; profit: number; roi: number; winrate: number }>;
  bankroll: ReturnType<typeof calculateBankroll>;
  monthName: string;
}) {
  const giveawayLeader = monthlyLeaderboard.find((row) => row.picks > 0) ?? monthlyLeaderboard[0];
  const eligibleViewers = monthlyLeaderboard.filter((row) => row.picks > 0).length;

  return (
    <section className="stats-page">
      <section className="panel stats-hero-panel">
        <div className="section-title"><LineChart size={18} /><h3>Estatisticas do dia</h3></div>
        <StatsMetricGrid scope={dayScope} bankroll={bankroll} />
        <ProfitChart points={dayTimeline} />
      </section>

      <section className="panel stats-hero-panel">
        <div className="section-title"><LineChart size={18} /><h3>Estatisticas de {monthName}</h3></div>
        <StatsMetricGrid scope={monthScope} />
        <ProfitChart points={monthTimeline} />
      </section>

      <section className="panel stats-hero-panel">
        <div className="section-title"><LineChart size={18} /><h3>Estatisticas gerais</h3></div>
        <StatsMetricGrid scope={allTimeScope} />
        <ProfitChart points={allTimeTimeline} />
      </section>

      <section className="panel giveaway-panel">
        <div className="section-title spread">
          <div><Trophy size={18} /><h3>Giveaway de {monthName}</h3></div>
          <span>{eligibleViewers} elegiveis</span>
        </div>
        {giveawayLeader ? (
          <div className="giveaway-leader">
            <span className="giveaway-rank">1</span>
            <Avatar user={giveawayLeader.user} />
            <div>
              <strong>{giveawayLeader.user.displayName}</strong>
              <small>1. lugar por lucro fechado em {monthName}</small>
            </div>
            <b>{giveawayLeader.profit >= 0 ? "+" : ""}{giveawayLeader.profit.toFixed(2)}u</b>
          </div>
        ) : null}
        <div className="giveaway-rules">
          <span>Minimo <b>1 tip final resolvida</b></span>
          <span>Desempate <b>ROI, depois winrate</b></span>
          <span>Premio <b>Badge + giveaway em stream</b></span>
        </div>
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
  return (
    <section className="panel stats-table-panel">
      <div className="section-title spread">
        <div><Trophy size={18} /><h3>{title}</h3></div>
        <span>{scope.total.profit >= 0 ? "+" : ""}{scope.total.profit.toFixed(2)}u</span>
      </div>
      <div className="stats-table">
        <div className="stats-table-head"><span>Pessoa</span><span>Tips</span><span>Finais</span><span>Resolvidas</span><span>Stake</span><span>Lucro</span><span>ROI</span></div>
        {runtimeUsers.map((user) => {
          const row = scope.byViewer.find((viewerRow) => viewerRow.userId === user.id) ?? {
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
  );
}

function LeaderboardPanel({ title, leaderboard }: { title: string; leaderboard: Array<{ user: User; picks: number; profit: number; roi: number; winrate: number }> }) {
  return (
    <section className="panel stats-table-panel">
      <div className="section-title"><Trophy size={18} /><h3>{title}</h3></div>
      <div className="leaderboard">
        {leaderboard.map((row, index) => (
          <div className="leader-row" key={row.user.id}>
            <span>{index + 1}</span>
            <Avatar user={row.user} />
            <strong>{row.user.displayName}</strong>
            <small>{row.picks} resolvidas - ROI {row.roi.toFixed(1)}%</small>
            <b>{row.profit >= 0 ? "+" : ""}{row.profit.toFixed(2)}u</b>
          </div>
        ))}
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
  profitTimeline: Array<{ label: string; profit: number; cumulative: number }>;
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
        <ProfitChart points={profitTimeline} />
      </section>

      <section className="panel giveaway-panel">
        <div className="section-title spread">
          <div><Trophy size={18} /><h3>Giveaway do dia</h3></div>
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
          <span>Premio <b>Badge + giveaway em stream</b></span>
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

function ProfitChart({ points }: { points: Array<{ label: string; profit: number; cumulative: number }> }) {
  if (points.length === 0) return <div className="chart-empty">Ainda não há picks finais resolvidas para desenhar evolução.</div>;

  const width = 760;
  const height = 260;
  const padding = 34;
  const values = points.map((point) => point.cumulative);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const coords = points.map((point, index) => {
    const x = padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - ((point.cumulative - min) / range) * (height - padding * 2);
    return { ...point, x, y };
  });
  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const zeroY = height - padding - ((0 - min) / range) * (height - padding * 2);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolução do lucro das picks finais">
        <line className="chart-axis" x1={padding} x2={width - padding} y1={zeroY} y2={zeroY} />
        <path className="chart-line" d={path} />
        {coords.map((point) => (
          <g key={`${point.label}-${point.cumulative}`}>
            <circle className={point.cumulative >= 0 ? "chart-dot positive" : "chart-dot negative"} cx={point.x} cy={point.y} r="5" />
            <text x={point.x} y={height - 10} textAnchor="middle">{point.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
