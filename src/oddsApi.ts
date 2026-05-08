import type { MatchOdd } from "./types";

type OddsResponse = {
  odds?: MatchOdd[];
};

export async function fetchTodayOdds(day: string) {
  const response = await fetch(`/api/odds?date=${day}`);
  if (!response.ok) return [];
  const data = (await response.json()) as OddsResponse;
  return data.odds ?? [];
}
