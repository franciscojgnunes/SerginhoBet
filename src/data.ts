import type { Match, Pick, User, Vote } from "./types";

export const users: User[] = [
  { id: "u-serginho", displayName: "SerginhoEsteves", role: "streamer", avatarColor: "#b7ff34" },
  { id: "u-xico", displayName: "Chicão", role: "viewer", avatarColor: "#00a85a" },
  { id: "u-bytex", displayName: "Gaxolas", role: "mod", avatarColor: "#16d782" },
  { id: "u-grilo", displayName: "Lazy", role: "viewer", avatarColor: "#064e3b" }
];

export const fallbackMatches: Match[] = [];

export const initialPicks: Pick[] = [
  {
    id: "p-1",
    matchId: "seed-1",
    userId: "u-xico",
    marketType: "1X2",
    selection: "Casa vence",
    odds: 2.1,
    stake: 1,
    bookmaker: "Betano",
    reason: "Pick inicial para testar a votacao quando houver jogos carregados.",
    status: "pending",
    profit: 0,
    createdAt: "2026-05-05T09:25:00+01:00"
  },
  {
    id: "p-2",
    matchId: "seed-2",
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
    matchId: "seed-1",
    userId: "u-grilo",
    marketType: "1X2",
    selection: "Casa vence",
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
