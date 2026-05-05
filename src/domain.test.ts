import { describe, expect, it } from "vitest";
import type { Pick, Vote } from "./types";
import { calculateBankroll, calculateProfit, scorePick, selectSlipPicks } from "./domain";

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
});
