import type { Match, Pick, User, Vote } from "./types";

export const users: User[] = [
  { id: "u-serginho", displayName: "SerginhoEsteves", role: "streamer", avatarColor: "#b7ff34" },
  { id: "u-xico", displayName: "Xico", role: "viewer", avatarColor: "#00a85a" },
  { id: "u-bytex", displayName: "Bytex", role: "mod", avatarColor: "#16d782" },
  { id: "u-grilo", displayName: "Grilo", role: "viewer", avatarColor: "#064e3b" }
];

export const fallbackMatches: Match[] = [
  {
    id: "m-1",
    competition: "Indonesian Super League",
    country: "Indonesia",
    homeTeam: "Borneo Samarinda",
    awayTeam: "Persita Tangerang",
    startsAt: "2026-05-05T12:00:00Z",
    status: "live",
    homeScore: 2,
    awayScore: 0,
    source: "demo"
  },
  {
    id: "m-2",
    competition: "Indonesian Super League",
    country: "Indonesia",
    homeTeam: "Madura United",
    awayTeam: "Bali United",
    startsAt: "2026-05-05T08:30:00Z",
    status: "live",
    homeScore: 2,
    awayScore: 0,
    source: "demo"
  },
  {
    id: "m-3",
    competition: "Austrian Regionalliga Ost",
    country: "Austria",
    homeTeam: "Wiener SC",
    awayTeam: "Parndorf",
    startsAt: "2026-05-05T17:30:00Z",
    status: "scheduled",
    source: "demo"
  }
];

export const initialPicks: Pick[] = [
  {
    id: "p-1",
    matchId: "m-1",
    userId: "u-xico",
    marketType: "1X2",
    selection: "Borneo Samarinda vence",
    odds: 2.1,
    stake: 1,
    bookmaker: "Betano",
    reason: "Equipa da casa forte, vantagem no ritmo e bom controlo do jogo.",
    status: "pending",
    profit: 0,
    createdAt: "2026-05-05T09:25:00+01:00"
  },
  {
    id: "p-2",
    matchId: "m-2",
    userId: "u-bytex",
    marketType: "Over/Under",
    selection: "Mais de 2.5 golos",
    odds: 1.85,
    stake: 1,
    bookmaker: "Betclic",
    reason: "Ambas as equipas chegam fortes no ataque e costumam abrir o jogo cedo.",
    status: "pending",
    profit: 0,
    createdAt: "2026-05-05T10:10:00+01:00"
  },
  {
    id: "p-3",
    matchId: "m-1",
    userId: "u-grilo",
    marketType: "1X2",
    selection: "Borneo Samarinda vence",
    odds: 2.35,
    stake: 1,
    bookmaker: "Manual",
    reason: "Linha caseira interessante e bom momento ofensivo.",
    status: "won",
    profit: 1.35,
    createdAt: "2026-05-04T11:30:00+01:00"
  }
];

export const initialVotes: Vote[] = [
  { pickId: "p-1", userId: "u-bytex", type: "strong" },
  { pickId: "p-1", userId: "u-grilo", type: "trust" },
  { pickId: "p-2", userId: "u-xico", type: "trust" },
  { pickId: "p-2", userId: "u-grilo", type: "doubt" }
];
