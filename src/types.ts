export type MatchStatus = "scheduled" | "live" | "finished";

export type MarketType =
  | "1X2"
  | "Dupla chance"
  | "Over/Under"
  | "BTTS"
  | "Handicap"
  | "Resultado correto"
  | "Intervalo/Final"
  | "Marcador"
  | "Cartoes"
  | "Cantos"
  | "Outro";

export type PickStatus = "pending" | "won" | "lost" | "void" | "half_won" | "half_lost";

export type VoteType = "trust" | "doubt" | "strong";

export type User = {
  id: string;
  displayName: string;
  role: "viewer" | "mod" | "streamer";
  avatarColor: string;
};

export type Match = {
  id: string;
  competition: string;
  country?: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: string;
  status: MatchStatus;
  homeScore?: number;
  awayScore?: number;
  homeLogoUrl?: string;
  awayLogoUrl?: string;
  homeRecord?: string;
  awayRecord?: string;
  venue?: string;
  source?: "api" | "demo";
};

export type Pick = {
  id: string;
  matchId: string;
  userId: string;
  marketType: MarketType;
  selection: string;
  odds: number;
  stake: number;
  bookmaker: string;
  reason: string;
  status: PickStatus;
  profit: number;
  createdAt: string;
};

export type Vote = {
  pickId: string;
  userId: string;
  type: VoteType;
};

export type DailySlip = {
  status: "draft" | "published";
  mode: "combined" | "multiples";
  combinedStake: number;
  multiplesStake: number;
  settlementStatus: PickStatus;
  profit: number;
  pickIds: string[];
  generatedAt: string;
};
