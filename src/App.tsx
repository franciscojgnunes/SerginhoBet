import {
  Activity,
  Banknote,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  Flame,
  Gauge,
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
  calculateDailyStats,
  calculateBankroll,
  calculateProfit,
  scorePick,
  selectSlipPicks
} from "./domain";
import { fetchTodayMatches } from "./sportsApi";
import type { DailySlip, MarketType, Match, Pick, PickStatus, User, Vote as VoteRecord, VoteType } from "./types";

const currentDate = new Date("2026-05-05T12:00:00+01:00");
const tipDay = "2026-05-05";
const communityInitialBankroll = 100;

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

export function App() {
  const [activeUserId, setActiveUserId] = useState("u-xico");
  const [matches, setMatches] = useState<Match[]>(fallbackMatches);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [matchSync, setMatchSync] = useState<"loading" | "live" | "empty" | "fallback">("loading");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [votes, setVotes] = useState<VoteRecord[]>([]);
  const [dailySlip, setDailySlip] = useState<DailySlip>({
    status: "draft",
    pickIds: [],
    generatedAt: currentDate.toISOString()
  });
  const [formState, setFormState] = useState({
    marketType: "1X2" as MarketType,
    selection: "",
    odds: "2.00",
    stake: "1",
    bookmaker: "Manual",
    reason: ""
  });

  useEffect(() => {
    void syncTodayMatches();
  }, []);

  async function syncTodayMatches() {
    setMatchSync("loading");
    try {
      const todayMatches = await fetchTodayMatches(currentDate);
      setMatches(todayMatches);
      setSelectedMatchId(todayMatches[0]?.id ?? "");
      setMatchSync(todayMatches.length > 0 ? "live" : "empty");
      setPicks(createStarterPicks(todayMatches));
      setVotes([]);
      setDailySlip({
        status: "draft",
        pickIds: [],
        generatedAt: new Date().toISOString()
      });
    } catch {
      setMatches(fallbackMatches);
      setSelectedMatchId(fallbackMatches[0]?.id ?? "");
      setMatchSync("fallback");
      setPicks([]);
      setVotes([]);
      setDailySlip({
        status: "draft",
        pickIds: [],
        generatedAt: new Date().toISOString()
      });
    }
  }

  const activeUser = userById(activeUserId);
  const isStreamer = activeUser.role === "streamer";
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? matches[0];
  const pendingPicks = picks.filter((pick) => pick.status === "pending");
  const selectedMatchPicks = selectedMatch ? picks.filter((pick) => pick.matchId === selectedMatch.id) : [];

  const topSlipPicks = dailySlip.pickIds
    .map((pickId) => picks.find((pick) => pick.id === pickId))
    .filter((pick): pick is Pick => Boolean(pick));

  const combinedOdds = topSlipPicks.reduce((total, pick) => total * pick.odds, 1);
  const communityBankroll = calculateBankroll(communityInitialBankroll, picks, dailySlip.pickIds);
  const dailyStats = calculateDailyStats(picks, dailySlip.pickIds, tipDay);
  const suggestedPicks = selectSlipPicks(picks, votes, 8);

  const stats = useMemo(() => {
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
      .sort((a, b) => b.profit - a.profit);
  }, [picks]);

  function submitPick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const odds = Number(formState.odds);
    const stake = Number(formState.stake);
    if (!selectedMatch || !formState.selection.trim() || !formState.reason.trim() || odds <= 1 || stake <= 0) return;

    const nextPick: Pick = {
      id: `p-${Date.now()}`,
      matchId: selectedMatch.id,
      userId: activeUserId,
      marketType: formState.marketType,
      selection: formState.selection.trim(),
      odds,
      stake,
      bookmaker: formState.bookmaker.trim() || "Manual",
      reason: formState.reason.trim(),
      status: "pending",
      profit: 0,
      createdAt: new Date().toISOString()
    };

    setPicks((current) => [nextPick, ...current]);
    setFormState({
      marketType: "1X2",
      selection: "",
      odds: "2.00",
      stake: "1",
      bookmaker: "Manual",
      reason: ""
    });
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
    const bestPickIds = selectSlipPicks(picks, votes, 4).map((pick) => pick.id);

    setDailySlip({
      status: "draft",
      pickIds: bestPickIds,
      generatedAt: new Date().toISOString()
    });
  }

  function publishSlip() {
    if (dailySlip.pickIds.length === 0) generateSlip();
    setDailySlip((slip) => ({ ...slip, status: "published" }));
  }

  function toggleFinalPick(pickId: string) {
    setDailySlip((slip) => {
      const exists = slip.pickIds.includes(pickId);
      return {
        ...slip,
        status: "draft",
        pickIds: exists ? slip.pickIds.filter((id) => id !== pickId) : [...slip.pickIds, pickId]
      };
    });
  }

  function settlePick(pickId: string, status: PickStatus) {
    setPicks((current) =>
      current.map((pick) =>
        pick.id === pickId
          ? {
              ...pick,
              status,
              profit: calculateProfit(status, pick.stake, pick.odds)
            }
          : pick
      )
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
            <p>Comunidade Twitch, picks de futebol e banca ficticia coletiva</p>
          </div>
        </div>

        <div className="login-panel">
          <LogIn size={18} />
          <select value={activeUserId} onChange={(event) => setActiveUserId(event.target.value)}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
          <span className="role-pill">{activeUser.role}</span>
        </div>
      </header>

      <section className="hero-grid">
        <div className="hero-copy">
          <div className={`sync-chip ${matchSync}`}>
            <RefreshCw size={15} />
            {matchSync === "loading" ? "A sincronizar jogos de hoje" : null}
            {matchSync === "live" ? "Tips de hoje via ESPN + TheSportsDB" : null}
            {matchSync === "empty" ? "Sem jogos reais encontrados para hoje" : null}
            {matchSync === "fallback" ? "APIs indisponiveis" : null}
          </div>
          <h2>O boletim nasce da votacao da stream.</h2>
          <p>
            So entram jogos do dia. A comunidade sugere e vota nas melhores tips, mas o SerginhoEsteves escolhe
            as picks finais para a banca ficticia coletiva.
          </p>
          <div className="hero-actions">
            {isStreamer ? (
              <>
                <button onClick={generateSlip}>
                  <Sparkles size={18} />
                  Sugerir por votos
                </button>
                <button className="secondary" onClick={publishSlip}>
                  <CheckCircle2 size={18} />
                  Publicar escolhas do streamer
                </button>
              </>
            ) : (
              <button>
                <Eye size={18} />
                Ver picks do dia
              </button>
            )}
            <button className="ghost" onClick={syncTodayMatches}>
              <RefreshCw size={18} />
              Atualizar jogos
            </button>
          </div>
        </div>

        <div className="bankroll-card">
          <div className="bankroll-top">
            <Banknote size={24} />
            <span>Banca da comunidade</span>
          </div>
          <strong>{communityBankroll.current.toFixed(2)}u</strong>
          <div className="bankroll-grid">
            <span>Inicial <b>{communityBankroll.initial}u</b></span>
            <span>Exposto <b>{communityBankroll.exposure.toFixed(2)}u</b></span>
            <span>Lucro <b>{communityBankroll.settledProfit >= 0 ? "+" : ""}{communityBankroll.settledProfit.toFixed(2)}u</b></span>
            <span>ROI <b>{communityBankroll.roi.toFixed(1)}%</b></span>
          </div>
        </div>
      </section>

      <section className="metric-strip">
        <div>
          <CalendarDays size={18} />
          <span>{matches.length}</span>
          <p>Jogos hoje</p>
        </div>
        <div>
          <Vote size={18} />
          <span>{pendingPicks.length}</span>
          <p>Picks em votacao</p>
        </div>
        <div>
          <ShieldCheck size={18} />
          <span>{topSlipPicks.length}</span>
          <p>Escolhidas pelo streamer</p>
        </div>
        <div>
          <CircleDollarSign size={18} />
          <span>{topSlipPicks.length ? combinedOdds.toFixed(2) : "0.00"}</span>
          <p>Odd combinada</p>
        </div>
      </section>

      <section className="workspace">
        <aside className="panel match-list">
          <div className="section-title spread">
            <div>
              <CalendarDays size={18} />
              <h3>Jogos de hoje</h3>
            </div>
            <span>{matchSync === "live" ? "API" : "Sem demo"}</span>
          </div>
          {matches.map((match) => (
            <button
              className={`match-row ${match.id === selectedMatch.id ? "selected" : ""}`}
              key={match.id}
              onClick={() => setSelectedMatchId(match.id)}
            >
              <span>{match.competition}</span>
              <strong>
                {match.homeTeam} vs {match.awayTeam}
              </strong>
              <small>
                {formatKickoff(match.startsAt)} · {matchStatusLabel(match)}
                {match.homeScore !== undefined && match.awayScore !== undefined ? ` · ${match.homeScore}-${match.awayScore}` : ""}
              </small>
            </button>
          ))}
          {matches.length === 0 ? (
            <p className="empty-copy">Nao ha jogos reais carregados para este dia. Experimenta atualizar daqui a pouco.</p>
          ) : null}
        </aside>

        <section className="panel picks-panel">
          <div className="section-title spread">
            <div>
              <Vote size={18} />
              <h3>{selectedMatch ? `${selectedMatch.homeTeam} vs ${selectedMatch.awayTeam}` : "Sem jogo selecionado"}</h3>
            </div>
            <span>{selectedMatchPicks.length} picks</span>
          </div>

          {isStreamer ? (
            <section className="streamer-control">
              <div className="section-title spread">
                <div>
                  <Sparkles size={18} />
                  <h3>Painel streamer</h3>
                </div>
                <span>{dailySlip.pickIds.length} finais</span>
              </div>
              <div className="control-actions">
                <button onClick={generateSlip}>
                  <Sparkles size={16} />
                  Preencher por votos
                </button>
                <button className="secondary" onClick={publishSlip}>
                  <CheckCircle2 size={16} />
                  Publicar finais
                </button>
              </div>
              <div className="candidate-list">
                {suggestedPicks.map((pick) => {
                  const match = matches.find((item) => item.id === pick.matchId);
                  const author = userById(pick.userId);
                  const selected = dailySlip.pickIds.includes(pick.id);
                  return (
                    <div className={`candidate-row ${selected ? "selected" : ""}`} key={pick.id}>
                      <div>
                        <strong>{pick.selection}</strong>
                        <small>
                          {author.displayName} · {match?.homeTeam} vs {match?.awayTeam} · Score {scorePick(pick.id, votes)}
                        </small>
                      </div>
                      <button onClick={() => toggleFinalPick(pick.id)}>{selected ? "Remover" : "Escolher"}</button>
                    </div>
                  );
                })}
                {suggestedPicks.length === 0 ? <p className="empty-copy">Ainda não há picks da comunidade para escolher.</p> : null}
              </div>
            </section>
          ) : (
            <section className="viewer-control">
              <div className="section-title">
                <Vote size={18} />
                <h3>Painel viewer</h3>
              </div>
              <form className="pick-form" onSubmit={submitPick}>
                <label>
                  Mercado
                  <select
                    value={formState.marketType}
                    onChange={(event) =>
                      setFormState((state) => ({
                        ...state,
                        marketType: event.target.value as MarketType,
                        selection: ""
                      }))
                    }
                  >
                    {marketOptions.map((market) => (
                      <option key={market}>{market}</option>
                    ))}
                  </select>
                </label>
                <label className="selection-field">
                  Pick
                  <input
                    placeholder={marketPlaceholders[formState.marketType]}
                    value={formState.selection}
                    onChange={(event) => setFormState((state) => ({ ...state, selection: event.target.value }))}
                  />
                </label>
                <label>
                  Odd
                  <input
                    type="number"
                    step="0.01"
                    min="1.01"
                    value={formState.odds}
                    onChange={(event) => setFormState((state) => ({ ...state, odds: event.target.value }))}
                  />
                </label>
                <label>
                  Stake
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={formState.stake}
                    onChange={(event) => setFormState((state) => ({ ...state, stake: event.target.value }))}
                  />
                </label>
                <label>
                  Fonte
                  <input
                    placeholder="Bookmaker"
                    value={formState.bookmaker}
                    onChange={(event) => setFormState((state) => ({ ...state, bookmaker: event.target.value }))}
                  />
                </label>
                <label className="reason-field">
                  Argumento
                  <textarea
                    placeholder="Porque e que a comunidade deve confiar nesta pick?"
                    value={formState.reason}
                    onChange={(event) => setFormState((state) => ({ ...state, reason: event.target.value }))}
                  />
                </label>
                <button type="submit" disabled={!selectedMatch}>Submeter pick</button>
              </form>
            </section>
          )}

          <div className="pick-stack">
            {selectedMatchPicks.map((pick) => {
              const author = userById(pick.userId);
              const score = scorePick(pick.id, votes);
              return (
                <article className="pick-card" key={pick.id}>
                  <div className="pick-header">
                    <div className="author">
                      <Avatar user={author} />
                      <div>
                        <strong>{author.displayName}</strong>
                        <span>{pick.marketType}</span>
                      </div>
                    </div>
                    <div className={`status ${pick.status}`}>{statusLabel(pick.status)}</div>
                  </div>
                  <div className="pick-body">
                    <h4>{pick.selection}</h4>
                    <p>{pick.reason}</p>
                  </div>
                  <div className="pick-meta">
                    <span>@{pick.odds.toFixed(2)}</span>
                    <span>{pick.stake}u</span>
                    <span>{pick.bookmaker}</span>
                    <span>Score {score}</span>
                  </div>
                  <div className="vote-row">
                    <button onClick={() => castVote(pick.id, "trust")} disabled={pick.userId === activeUserId}>
                      <ThumbsUp size={16} />
                      Confio
                    </button>
                    <button onClick={() => castVote(pick.id, "doubt")} disabled={pick.userId === activeUserId}>
                      <ThumbsDown size={16} />
                      Nao confio
                    </button>
                    <button onClick={() => castVote(pick.id, "strong")} disabled={pick.userId === activeUserId}>
                      <Flame size={16} />
                      Forte
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="side-column">
          <section className="panel slip-panel">
            <div className="section-title spread">
              <div>
                <ShieldCheck size={18} />
                <h3>Picks finais do streamer</h3>
              </div>
              <span className={`slip-state ${dailySlip.status}`}>{dailySlip.status}</span>
            </div>
            <div className="slip-list">
              {topSlipPicks.map((pick, index) => {
                const match = matches.find((item) => item.id === pick.matchId);
                return (
                  <div className="slip-item" key={pick.id}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{pick.selection}</strong>
                      <small>
                        {match?.homeTeam} vs {match?.awayTeam} · @{pick.odds.toFixed(2)} · {pick.stake}u
                      </small>
                    </div>
                  </div>
                );
              })}
              {topSlipPicks.length === 0 ? (
                <p className="empty-copy">Usa os votos como sugestao; o streamer publica as picks finais.</p>
              ) : null}
            </div>
            <div className="combined-odds">
              <span>Odd combinada</span>
              <strong>{topSlipPicks.length ? combinedOdds.toFixed(2) : "0.00"}</strong>
            </div>
          </section>

          <section className="panel bank-mini">
            <div className="section-title">
              <Gauge size={18} />
              <h3>Estado da banca</h3>
            </div>
            <div className="bank-line">
              <span>Disponivel</span>
              <strong>{(communityBankroll.current - communityBankroll.exposure).toFixed(2)}u</strong>
            </div>
            <div className="bank-line">
              <span>Exposicao boletim</span>
              <strong>{communityBankroll.exposure.toFixed(2)}u</strong>
            </div>
            <div className="bank-line">
              <span>Lucro fechado</span>
              <strong>{communityBankroll.settledProfit >= 0 ? "+" : ""}{communityBankroll.settledProfit.toFixed(2)}u</strong>
            </div>
          </section>

          <section className="panel stats-panel">
            <div className="section-title">
              <CircleDollarSign size={18} />
              <h3>Estatísticas do dia</h3>
            </div>
            <div className="stat-grid">
              <span>Submetidas <b>{dailyStats.total.submitted}</b></span>
              <span>Finais <b>{dailyStats.total.selected}</b></span>
              <span>Lucro total <b>{dailyStats.total.profit >= 0 ? "+" : ""}{dailyStats.total.profit.toFixed(2)}u</b></span>
              <span>ROI <b>{dailyStats.total.roi.toFixed(1)}%</b></span>
            </div>
            <div className="viewer-stats">
              {users
                .filter((user) => user.role !== "streamer")
                .map((user) => {
                  const row =
                    dailyStats.byViewer.find((viewerRow) => viewerRow.userId === user.id) ?? {
                      submitted: 0,
                      selected: 0,
                      settled: 0,
                      pendingSelected: 0,
                      staked: 0,
                      profit: 0,
                      roi: 0
                    };
                  return (
                    <div className="viewer-stat-row" key={user.id}>
                      <Avatar user={user} />
                      <strong>{user.displayName}</strong>
                      <small>{row.submitted} tips · {row.selected} finais</small>
                      <b>{row.profit >= 0 ? "+" : ""}{row.profit.toFixed(2)}u</b>
                    </div>
                  );
                })}
            </div>
          </section>

          <section className="panel">
            <div className="section-title">
              <Trophy size={18} />
              <h3>Leaderboard</h3>
            </div>
            <div className="leaderboard">
              {stats.map((row, index) => (
                <div className="leader-row" key={row.user.id}>
                  <span>{index + 1}</span>
                  <Avatar user={row.user} />
                  <strong>{row.user.displayName}</strong>
                  <small>{row.picks} picks</small>
                  <b>{row.profit >= 0 ? "+" : ""}{row.profit.toFixed(2)}u</b>
                </div>
              ))}
            </div>
          </section>

          {isStreamer ? (
            <section className="panel admin-panel">
              <div className="section-title">
                <Activity size={18} />
                <h3>Resolver picks</h3>
              </div>
              {pendingPicks.slice(0, 8).map((pick) => (
                <div className="settle-row" key={pick.id}>
                  <span>{pick.selection}</span>
                  <select onChange={(event) => settlePick(pick.id, event.target.value as PickStatus)} defaultValue="pending">
                    <option value="pending">Pendente</option>
                    <option value="won">Ganha</option>
                    <option value="lost">Perdida</option>
                    <option value="void">Void</option>
                    <option value="half_won">Meia ganha</option>
                    <option value="half_lost">Meia perdida</option>
                  </select>
                </div>
              ))}
            </section>
          ) : null}
        </aside>
      </section>

      <footer className="disclaimer">
        <UserRound size={16} />
        Unidades ficticias. Sem dinheiro real, depositos, cashout ou execucao de apostas.
      </footer>
    </main>
  );
}

function createStarterPicks(todayMatches: Match[]): Pick[] {
  const first = todayMatches[0];
  const second = todayMatches[1] ?? todayMatches[0];
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
      reason: "Pick inicial para testar a votacao da comunidade com jogos reais de hoje.",
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
      reason: "Mercado popular para simular odds manuais enquanto a API so fornece calendario/resultados.",
      status: "pending",
      profit: 0,
      createdAt: new Date().toISOString()
    }
  ];
}
