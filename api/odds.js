const apiFootballUrl = "https://v3.football.api-sports.io/odds";

function normalizeSelection(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (["home", "1"].includes(normalized)) return "Casa vence";
  if (["draw", "x"].includes(normalized)) return "Empate";
  if (["away", "2"].includes(normalized)) return "Fora vence";
  return String(value ?? "");
}

export default async function handler(request, response) {
  const apiKey = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY;
  if (!apiKey) {
    response.status(200).json({ odds: [], error: "API_FOOTBALL_KEY is not configured" });
    return;
  }

  const day = request.query.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) {
    response.status(400).json({ odds: [], error: "Invalid date" });
    return;
  }

  try {
    const upstream = await fetch(`${apiFootballUrl}?date=${day}&timezone=Europe/Lisbon`, {
      headers: { "x-apisports-key": apiKey }
    });
    if (!upstream.ok) {
      response.status(upstream.status).json({ odds: [], error: "Odds provider failed" });
      return;
    }

    const data = await upstream.json();
    const fetchedAt = new Date().toISOString();
    const odds = (data.response ?? []).flatMap((event) => {
      const fixtureId = event.fixture?.id;
      const bookmaker = event.bookmakers?.[0];
      const matchWinner = bookmaker?.bets?.find((bet) => {
        const name = String(bet.name ?? "").toLowerCase();
        return name === "match winner" || name === "1x2";
      });
      if (!fixtureId || !bookmaker || !matchWinner) return [];

      return (matchWinner.values ?? [])
        .map((odd) => ({
          id: `api-football-${fixtureId}-1x2-${normalizeSelection(odd.value).toLowerCase().replace(/\s+/g, "-")}`,
          matchId: `api-football-${fixtureId}`,
          marketType: "1X2",
          selection: normalizeSelection(odd.value),
          odds: Number(odd.odd),
          bookmaker: bookmaker.name ?? "API-Football",
          fetchedAt
        }))
        .filter((odd) => Number.isFinite(odd.odds) && odd.odds > 1);
    });

    response.status(200).json({ odds });
  } catch (error) {
    response.status(500).json({ odds: [], error: error instanceof Error ? error.message : "Unknown error" });
  }
}
