import type { Match, Pick, User, Vote } from "./types";

export const users: User[] = [
  { id: "u-serginho", displayName: "SerginhoEsteves", role: "streamer", avatarColor: "#7c3aed" },
  { id: "u-xico", displayName: "Xico", role: "viewer", avatarColor: "#059669" },
  { id: "u-bytex", displayName: "Bytex", role: "mod", avatarColor: "#2563eb" },
  { id: "u-grilo", displayName: "Grilo", role: "viewer", avatarColor: "#dc2626" }
];

export const matches: Match[] = [
  {
    id: "m-1",
    competition: "Primeira Liga",
    homeTeam: "Sporting",
    awayTeam: "Porto",
    startsAt: "2026-05-05T20:15:00+01:00",
    status: "scheduled"
  },
  {
    id: "m-2",
    competition: "Primeira Liga",
    homeTeam: "Benfica",
    awayTeam: "Braga",
    startsAt: "2026-05-06T18:00:00+01:00",
    status: "scheduled"
  },
  {
    id: "m-3",
    competition: "Primeira Liga",
    homeTeam: "Vitoria SC",
    awayTeam: "Boavista",
    startsAt: "2026-05-06T20:30:00+01:00",
    status: "scheduled"
  },
  {
    id: "m-4",
    competition: "Primeira Liga",
    homeTeam: "Famalicao",
    awayTeam: "Casa Pia",
    startsAt: "2026-05-04T20:15:00+01:00",
    status: "finished",
    homeScore: 2,
    awayScore: 1
  }
];

export const initialPicks: Pick[] = [
  {
    id: "p-1",
    matchId: "m-1",
    userId: "u-xico",
    marketType: "1X2",
    selection: "Sporting vence",
    odds: 2.1,
    stake: 1,
    bookmaker: "Betano",
    reason: "Sporting em casa, intensidade alta e Porto com baixas no meio-campo.",
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
    matchId: "m-4",
    userId: "u-grilo",
    marketType: "1X2",
    selection: "Famalicao vence",
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
