import { describe, expect, it } from "vitest";
import type { Match, Pick, Vote } from "./types";
import {
  buildMatchSlate,
  calculateBankroll,
  calculateProfit,
  filterMatchesForDay,
  scorePick,
  selectSlipPicks
} from "./domain";

const basePick: Pick = {
  id: "pick-1",
  matchId: "match-1",
  userId: "user-1",
  marketType: "1X2",
  selection: "Casa vence",
  odds: 2.5,
  stake: 1,
  bookmaker: "Manual",
  reason: "Bom momento em casa.",
  status: "pending",
  profit: 0,
  createdAt: "2026-05-05T10:00:00+01:00"
};

describe("PickRoom domain logic", () => {
  it("scores trust, doubt and strong votes with the expected weights", () => {
    const votes: Vote[] = [
      { pickId: "pick-1", userId: "u-1", type: "trust" },
      { pickId: "pick-1", userId: "u-2", type: "strong" },
      { pickId: "pick-1", userId: "u-3", type: "doubt" },
      { pickId: "pick-2", userId: "u-4", type: "strong" }
    ];

    expect(scorePick("pick-1", votes)).toBe(2);
  });

  it("calculates settlement profit in fictitious units", () => {
    expect(calculateProfit("won", 2, 2.25)).toBe(2.5);
    expect(calculateProfit("lost", 2, 2.25)).toBe(-2);
    expect(calculateProfit("void", 2, 2.25)).toBe(0);
    expect(calculateProfit("half_won", 2, 2.25)).toBe(1.25);
    expect(calculateProfit("half_lost", 2, 2.25)).toBe(-1);
  });

  it("selects the highest scored pending picks for a community slip", () => {
    const picks: Pick[] = [
      { ...basePick, id: "low" },
      { ...basePick, id: "high" },
      { ...basePick, id: "settled", status: "won" }
    ];
    const votes: Vote[] = [
      { pickId: "low", userId: "u-1", type: "trust" },
      { pickId: "high", userId: "u-1", type: "strong" },
      { pickId: "high", userId: "u-2", type: "trust" },
      { pickId: "settled", userId: "u-1", type: "strong" }
    ];

    expect(selectSlipPicks(picks, votes, 2).map((pick) => pick.id)).toEqual(["high", "low"]);
  });

  it("tracks community bankroll from published slip picks only", () => {
    const picks: Pick[] = [
      { ...basePick, id: "won", stake: 2, odds: 2.25, status: "won", profit: 2.5 },
      { ...basePick, id: "lost", stake: 1, odds: 1.8, status: "lost", profit: -1 },
      { ...basePick, id: "pending", status: "pending", profit: 0 }
    ];

    expect(calculateBankroll(100, picks, ["won", "lost", "pending"])).toEqual({
      initial: 100,
      current: 101.5,
      exposure: 1,
      settledProfit: 1.5,
      roi: 50
    });
  });

  it("tops up API matches with demo matches until the slate target is reached", () => {
    const apiMatch: Match = {
      id: "api-1",
      competition: "Real League",
      homeTeam: "Real A",
      awayTeam: "Real B",
      startsAt: "2026-05-05T12:00:00Z",
      status: "scheduled",
      source: "api"
    };
    const demoMatches: Match[] = [
      {
        id: "demo-1",
        competition: "Demo League",
        homeTeam: "Demo A",
        awayTeam: "Demo B",
        startsAt: "2026-05-05T14:00:00Z",
        status: "scheduled",
        source: "demo"
      },
      {
        id: "demo-2",
        competition: "Demo League",
        homeTeam: "Demo C",
        awayTeam: "Demo D",
        startsAt: "2026-05-05T16:00:00Z",
        status: "scheduled",
        source: "demo"
      }
    ];

    expect(buildMatchSlate([apiMatch], demoMatches, 3).map((match) => match.id)).toEqual([
      "api-1",
      "demo-1",
      "demo-2"
    ]);
  });

  it("filters the match slate to the selected tip day", () => {
    const matches: Match[] = [
      {
        id: "today",
        competition: "Liga",
        homeTeam: "Hoje A",
        awayTeam: "Hoje B",
        startsAt: "2026-05-05T23:30:00+01:00",
        status: "scheduled"
      },
      {
        id: "tomorrow",
        competition: "Liga",
        homeTeam: "Amanha A",
        awayTeam: "Amanha B",
        startsAt: "2026-05-06T00:30:00+01:00",
        status: "scheduled"
      }
    ];

    expect(filterMatchesForDay(matches, "2026-05-05").map((match) => match.id)).toEqual(["today"]);
  });
});
