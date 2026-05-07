import {
  Activity,
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
import { fallbackMatches, users } from "./data";
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
import type { DailySlip, MarketType, Match, Pick, PickStatus, SlipHistoryItem, User, Vote as VoteRecord, VoteType } from "./types";

const currentDate = new Date();
const tipDay = getLocalDateKey(currentDate);
const communityInitialBankroll = 100;
const hasApiFootballKey = Boolean(import.meta.env.VITE_API_FOOTBALL_KEY);
const matchesCacheKey = `pickroom:matches:${tipDay}:${hasApiFootballKey ? "api-football-v2" : "free-v1"}`;
const picksCacheKey = `pickroom:picks:${tipDay}`;
const votesCacheKey = `pickroom:votes:${tipDay}`;
const slipCacheKey = `pickroom:slip:${tipDay}`;
const slipHistoryCacheKey = `pickroom:slip-history:${tipDay}`;

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

type Page = "games" | "community" | "viewer" | "resolve" | "stats";

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
  return users.find((user) => user.id === userId) ?? users[0];
}

function Avatar({ user }: { user: User }) {
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
  const [matches, setMatches] = useState<Match[]>(() => readStoredValue<Match[]>(matchesCacheKey, fallbackMatches));
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [matchSync, setMatchSync] = useState<"loading" | "live" | "empty" | "fallback">(() => (
    readStoredValue<Match[]>(matchesCacheKey, fallbackMatches).length > 0 ? "live" : "loading"
  ));
  const [picks, setPicks] = useState<Pick[]>(() => readStoredValue<Pick[]>(picksCacheKey, []));
  const [votes, setVotes] = useState<VoteRecord[]>(() => readStoredValue<VoteRecord[]>(votesCacheKey, []));
  const [dailySlip, setDailySlip] = useState<DailySlip>(() => readStoredValue<DailySlip>(slipCacheKey, createDefaultDailySlip()));
  const [slipHistory, setSlipHistory] = useState<SlipHistoryItem[]>(() => readStoredValue<SlipHistoryItem[]>(slipHistoryCacheKey, []));
  const [popup, setPopup] = useState<{ title: string; body: string } | null>(null);
  const [tipModalMatchId, setTipModalMatchId] = useState<string | null>(null);
  const [selectedResolveSlipId, setSelectedResolveSlipId] = useState("");
  const [activePage, setActivePage] = useState<Page>("games");
  const [competitionFilter, setCompetitionFilter] = useState("all");
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
      if (picks.length === 0) setPicks(createStarterPicks(upcomingMatches));
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
    if (slipHistory.length === 0) {
      setSelectedResolveSlipId("");
      return;
    }
    if (!slipHistory.some((slip) => slip.id === selectedResolveSlipId)) {
      setSelectedResolveSlipId(slipHistory[0].id);
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
      setPicks((current) => (current.length > 0 ? current : createStarterPicks(upcomingMatches)));
      return;
    }

    try {
      const todayMatches = await fetchTodayMatches(currentDate, { forceRefresh });
      const upcomingMatches = filterUpcomingScheduledMatches(todayMatches);
      setMatches(todayMatches);
      setSelectedMatchId(upcomingMatches[0]?.id ?? "");
      setMatchSync(todayMatches.length > 0 ? "live" : "empty");
      setPicks((current) => (current.length > 0 ? current : createStarterPicks(upcomingMatches)));
    } catch {
      setMatches(fallbackMatches);
      setSelectedMatchId("");
      setMatchSync("fallback");
    }
  }

  const activeUser = userById(activeUserId);
  const isStreamer = activeUser.role === "streamer";
  const scheduledMatches = useMemo(() => filterUpcomingScheduledMatches(matches), [matches]);
  const competitionOptions = useMemo(
    () => ["all", ...Array.from(new Set(scheduledMatches.map((match) => match.competition))).sort((a, b) => a.localeCompare(b))],
    [scheduledMatches]
  );
  const visibleMatches = useMemo(
    () => (competitionFilter === "all" ? scheduledMatches : scheduledMatches.filter((match) => match.competition === competitionFilter)),
    [competitionFilter, scheduledMatches]
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
  const selectedMatchPicks = selectedMatch ? picks.filter((pick) => pick.matchId === selectedMatch.id) : [];
  const communityPicks = [...picks].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const topSlipPicks = dailySlip.pickIds
    .map((pickId) => picks.find((pick) => pick.id === pickId))
    .filter((pick): pick is Pick => Boolean(pick));
  const selectedResolveSlip = slipHistory.find((slip) => slip.id === selectedResolveSlipId) ?? slipHistory[0];
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
  const suggestedPicks = selectSlipPicks(picks, votes, 8);
  const profitTimeline = buildProfitTimeline(picks, dailySlip.pickIds);
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

  const leaderboard = useMemo(() => {
    if (dailySlip.mode === "combined" && dailySlip.status === "published") {
      return users
        .map((user) => {
          const row = displayedDailyStats.byViewer.find((viewerRow) => viewerRow.userId === user.id);
          return {
            user,
            picks: row?.settled ?? 0,
            profit: row?.profit ?? 0,
            roi: row?.roi ?? 0,
            winrate: row && row.settled > 0 && dailySlip.settlementStatus === "won" ? 100 : 0
          };
        })
        .sort((a, b) => b.profit - a.profit || b.roi - a.roi || b.winrate - a.winrate);
    }

    return users
      .map((user) => {
        const settled = picks.filter((pick) => pick.userId === user.id && pick.status !== "pending");
        const totalProfit = settled.reduce((total, pick) => total + pick.profit, 0);
        const totalStaked = settled.reduce((total, pick) => total + pick.stake, 0);
        const wins = settled.filter((pick) => pick.status === "won" || pick.status === "half_won").length;
        return {
          user,
          picks: settled.length,
          profit: totalProfit,
          roi: totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0,
          winrate: settled.length > 0 ? (wins / settled.length) * 100 : 0
        };
      })
      .sort((a, b) => b.profit - a.profit || b.roi - a.roi || b.winrate - a.winrate);
  }, [dailySlip.mode, dailySlip.settlementStatus, dailySlip.status, displayedDailyStats.byViewer, picks]);

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

    setVotes((current) => [
      ...current.filter((voteItem) => !(voteItem.pickId === pickId && voteItem.userId === activeUserId)),
      { pickId, userId: activeUserId, type }
    ]);
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
    setDailySlip(nextSlip);
    setSlipHistory((current) => [
      { ...nextSlip, id: historyId, publishedAt },
      ...current
    ]);
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

    setPicks(nextPicks);
    setSlipHistory((current) =>
      current.map((item) => (item.id === slipId ? { ...item, settlementStatus, profit } : item))
    );
    if (slip.generatedAt === dailySlip.generatedAt) {
      setDailySlip((current) => ({ ...current, settlementStatus, profit }));
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
    setSlipHistory((current) =>
      current.map((item) => (item.id === slipId ? { ...item, settlementStatus: status, profit } : item))
    );
    if (slip.generatedAt === dailySlip.generatedAt) {
      setDailySlip((current) => ({ ...current, settlementStatus: status, profit }));
    }
  }

  function loginAs(role: "viewer" | "streamer") {
    setActiveUserId(role === "streamer" ? "u-serginho" : "u-xico");
    setIsLoggedIn(true);
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
          <div className="brand-mark large">
            <Trophy size={34} />
          </div>
          <h1>PickRoom SerginhoEsteves</h1>
          <p>Entra como viewer para sugerir e votar tips, ou como streamer para gerir as escolhas finais.</p>
          <div className="login-choice-grid">
            <button onClick={() => loginAs("viewer")}>
              <UserRound size={22} />
              Entrar como Viewer
            </button>
            <button className="streamer-login" onClick={() => loginAs("streamer")}>
              <ShieldCheck size={22} />
              Entrar como Streamer
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Trophy size={22} />
          </div>
          <div>
            <h1>PickRoom SerginhoEsteves</h1>
            <p>Tips de futebol por dia, comunidade Twitch e banca fictícia coletiva</p>
          </div>
        </div>

        <div className="login-panel">
          <div className="page-tabs">
            <button className={activePage === "games" ? "active" : ""} onClick={() => setActivePage("games")}>Jogos</button>
            <button className={activePage === "community" ? "active" : ""} onClick={() => setActivePage("community")}>Comunidade</button>
            {!isStreamer ? <button className={activePage === "viewer" ? "active" : ""} onClick={() => setActivePage("viewer")}>Minhas apostas</button> : null}
            {isStreamer ? <button className={activePage === "resolve" ? "active" : ""} onClick={() => setActivePage("resolve")}>Resolver</button> : null}
            <button className={activePage === "stats" ? "active" : ""} onClick={() => setActivePage("stats")}>Estatísticas</button>
          </div>
          <LogIn size={18} />
          <select value={activeUserId} onChange={(event) => setActiveUserId(event.target.value)}>
            {users.filter((user) => (isStreamer ? user.role === "streamer" : user.role !== "streamer")).map((user) => (
              <option key={user.id} value={user.id}>{user.displayName}</option>
            ))}
          </select>
          <span className="role-pill">{activeUser.role}</span>
          <button className="logout-button" onClick={() => setIsLoggedIn(false)}>Sair</button>
        </div>
      </header>

      {activePage === "games" ? (
        <section className="games-page">
          <section className="panel games-center">
            <div className="section-title spread games-toolbar">
              <div><CalendarDays size={18} /><h3>Jogos de hoje</h3></div>
              <div className="games-actions">
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
                  {matchSync === "fallback" ? "APIs indisponíveis" : null}
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
                <div className="candidate-list">
                  {suggestedPicks.map((pick) => {
                    const match = matches.find((item) => item.id === pick.matchId);
                    const author = userById(pick.userId);
                    const selected = dailySlip.pickIds.includes(pick.id);
                    return (
                      <div className={`candidate-row ${selected ? "selected" : ""}`} key={pick.id}>
                        <div>
                          <strong>{pick.selection}</strong>
                          <small>{author.displayName} · {match?.homeTeam} vs {match?.awayTeam} · Score {scorePick(pick.id, votes)}</small>
                        </div>
                        <button onClick={() => toggleFinalPick(pick.id)}>{selected ? "Remover" : "Escolher"}</button>
                      </div>
                    );
                  })}
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
          slipHistory={slipHistory}
          picks={selectedResolvePicks}
          matches={matches}
          combinedOdds={selectedResolveCombinedOdds}
          selectedSlipId={selectedResolveSlipId}
          onSelectSlip={setSelectedResolveSlipId}
          onSettlePick={settlePick}
          onSettleCombined={settleCombinedSlip}
        />
      ) : null}

      {activePage === "stats" ? (
        <StatsPage dailyStats={displayedDailyStats} profitTimeline={displayedProfitTimeline} leaderboard={leaderboard} />
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

      <section className="panel viewer-history-panel">
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

function StatsPage({
  dailyStats,
  profitTimeline,
  leaderboard
}: {
  dailyStats: ReturnType<typeof calculateDailyStats>;
  profitTimeline: Array<{ label: string; profit: number; cumulative: number }>;
  leaderboard: Array<{ user: User; picks: number; profit: number; roi: number; winrate: number }>;
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
          {users.map((user) => {
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

function createStarterPicks(todayMatches: Match[]): Pick[] {
  const first = todayMatches[0];
  const second = todayMatches[1] ?? todayMatches[0];
  const third = todayMatches[2] ?? todayMatches[0];
  if (!first) return [];

  return [
    {
      id: "api-p-1",
      matchId: first.id,
      userId: "u-xico",
      marketType: "1X2",
      selection: `${first.homeTeam} vence`,
      odds: 2.1,
      stake: 1,
      bookmaker: "Manual",
      reason: "Pick inicial para testar a votação da comunidade com jogos reais de hoje.",
      status: "pending",
      profit: 0,
      createdAt: new Date().toISOString()
    },
    {
      id: "api-p-2",
      matchId: second.id,
      userId: "u-bytex",
      marketType: "Over/Under",
      selection: "Mais de 2.5 golos",
      odds: 1.85,
      stake: 1,
      bookmaker: "Manual",
      reason: "Mercado popular para simular odds manuais enquanto a API fornece calendário e resultados.",
      status: "pending",
      profit: 0,
      createdAt: new Date().toISOString()
    },
    {
      id: "api-p-3",
      matchId: third.id,
      userId: "u-serginho",
      marketType: "BTTS",
      selection: "Ambas marcam: Sim",
      odds: 1.78,
      stake: 1,
      bookmaker: "Manual",
      reason: "Tip do streamer para mostrar que o SerginhoEsteves também participa no boletim.",
      status: "pending",
      profit: 0,
      createdAt: new Date().toISOString()
    }
  ];
}
