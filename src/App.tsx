import {
  Activity,
  Award,
  CalendarDays,
  CheckCircle2,
  Flame,
  LogIn,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trophy,
  UserRound,
  Vote
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { initialPicks, initialVotes, matches, users } from "./data";
import type { DailySlip, MarketType, Pick, PickStatus, User, VoteType } from "./types";

const currentDate = new Date("2026-05-05T12:00:00+01:00");

function formatKickoff(value: string) {
  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getProfit(status: PickStatus, stake: number, odds: number) {
  if (status === "won") return stake * (odds - 1);
  if (status === "lost") return -stake;
  if (status === "void" || status === "pending") return 0;
  if (status === "half_won") return (stake * (odds - 1)) / 2;
  return -stake / 2;
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

function voteScore(pickId: string, votes: { pickId: string; userId: string; type: VoteType }[]) {
  return votes
    .filter((voteItem) => voteItem.pickId === pickId)
    .reduce((total, voteItem) => {
      if (voteItem.type === "trust") return total + 1;
      if (voteItem.type === "strong") return total + 2;
      return total - 1;
    }, 0);
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
  const [selectedMatchId, setSelectedMatchId] = useState(matches[0].id);
  const [picks, setPicks] = useState<Pick[]>(initialPicks);
  const [votes, setVotes] = useState(initialVotes);
  const [dailySlip, setDailySlip] = useState<DailySlip>({
    status: "draft",
    pickIds: ["p-1", "p-2"],
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

  const activeUser = userById(activeUserId);
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? matches[0];
  const pendingPicks = picks.filter((pick) => pick.status === "pending");
  const selectedMatchPicks = picks.filter((pick) => pick.matchId === selectedMatch.id);

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

  const topSlipPicks = dailySlip.pickIds
    .map((pickId) => picks.find((pick) => pick.id === pickId))
    .filter((pick): pick is Pick => Boolean(pick));

  const combinedOdds = topSlipPicks.reduce((total, pick) => total * pick.odds, 1);

  function submitPick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const odds = Number(formState.odds);
    const stake = Number(formState.stake);
    if (!formState.selection.trim() || !formState.reason.trim() || odds <= 1 || stake <= 0) return;

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
    const bestPickIds = [...pendingPicks]
      .sort((left, right) => voteScore(right.id, votes) - voteScore(left.id, votes))
      .slice(0, 3)
      .map((pick) => pick.id);

    setDailySlip({
      status: "draft",
      pickIds: bestPickIds,
      generatedAt: new Date().toISOString()
    });
  }

  function settlePick(pickId: string, status: PickStatus) {
    setPicks((current) =>
      current.map((pick) =>
        pick.id === pickId
          ? {
              ...pick,
              status,
              profit: getProfit(status, pick.stake, pick.odds)
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
            <p>Predictions sociais de futebol com unidades ficticias</p>
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
          <h2>Boletim da comunidade, criado pelos viewers.</h2>
          <p>
            Jogos entram automaticamente, odds ficam manuais, e a comunidade decide quais picks merecem ir para
            o boletim do dia.
          </p>
          <div className="hero-actions">
            <button onClick={generateSlip}>
              <Sparkles size={18} />
              Gerar boletim
            </button>
            <button className="secondary" onClick={() => setDailySlip((slip) => ({ ...slip, status: "published" }))}>
              <CheckCircle2 size={18} />
              Publicar
            </button>
          </div>
        </div>

        <div className="metric-strip">
          <div>
            <span>{matches.length}</span>
            <p>Jogos sync</p>
          </div>
          <div>
            <span>{pendingPicks.length}</span>
            <p>Picks pendentes</p>
          </div>
          <div>
            <span>{topSlipPicks.length}</span>
            <p>No boletim</p>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="panel match-list">
          <div className="section-title">
            <CalendarDays size={18} />
            <h3>Jogos importados</h3>
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
                {formatKickoff(match.startsAt)}
                {match.status === "finished" && ` · ${match.homeScore}-${match.awayScore}`}
              </small>
            </button>
          ))}
        </aside>

        <section className="panel picks-panel">
          <div className="section-title spread">
            <div>
              <Vote size={18} />
              <h3>{selectedMatch.homeTeam} vs {selectedMatch.awayTeam}</h3>
            </div>
            <span>{selectedMatchPicks.length} picks</span>
          </div>

          <form className="pick-form" onSubmit={submitPick}>
            <select
              value={formState.marketType}
              onChange={(event) => setFormState((state) => ({ ...state, marketType: event.target.value as MarketType }))}
            >
              <option>1X2</option>
              <option>Over/Under</option>
              <option>BTTS</option>
              <option>Handicap</option>
              <option>Outro</option>
            </select>
            <input
              placeholder="Selecao: Sporting vence"
              value={formState.selection}
              onChange={(event) => setFormState((state) => ({ ...state, selection: event.target.value }))}
            />
            <input
              type="number"
              step="0.01"
              min="1.01"
              value={formState.odds}
              onChange={(event) => setFormState((state) => ({ ...state, odds: event.target.value }))}
            />
            <input
              type="number"
              step="0.5"
              min="0.5"
              value={formState.stake}
              onChange={(event) => setFormState((state) => ({ ...state, stake: event.target.value }))}
            />
            <input
              placeholder="Bookmaker"
              value={formState.bookmaker}
              onChange={(event) => setFormState((state) => ({ ...state, bookmaker: event.target.value }))}
            />
            <textarea
              placeholder="Justificacao da pick"
              value={formState.reason}
              onChange={(event) => setFormState((state) => ({ ...state, reason: event.target.value }))}
            />
            <button type="submit">Submeter pick</button>
          </form>

          <div className="pick-stack">
            {selectedMatchPicks.map((pick) => {
              const author = userById(pick.userId);
              const score = voteScore(pick.id, votes);
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
                <h3>Boletim do dia</h3>
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
                        {match?.homeTeam} vs {match?.awayTeam} · @{pick.odds.toFixed(2)}
                      </small>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="combined-odds">
              <span>Odd combinada</span>
              <strong>{topSlipPicks.length ? combinedOdds.toFixed(2) : "0.00"}</strong>
            </div>
          </section>

          <section className="panel">
            <div className="section-title">
              <Award size={18} />
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

          <section className="panel admin-panel">
            <div className="section-title">
              <Activity size={18} />
              <h3>Admin settlement</h3>
            </div>
            {pendingPicks.slice(0, 4).map((pick) => (
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
        </aside>
      </section>

      <footer className="disclaimer">
        <UserRound size={16} />
        Unidades ficticias. Sem dinheiro real, depositos, cashout ou execucao de apostas.
      </footer>
    </main>
  );
}
