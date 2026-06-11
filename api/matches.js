const apiFootballUrl = "https://v3.football.api-sports.io/fixtures";
const espnWorldCupUrl = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  const apiKey = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY;
  if (!apiKey) {
    response.status(200).json({ response: [], error: "API_FOOTBALL_KEY is not configured" });
    return;
  }

  const day = request.query.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) {
    response.status(400).json({ response: [], error: "Invalid date" });
    return;
  }

  try {
    const [upstream, espnWorldCup] = await Promise.all([
      fetch(`${apiFootballUrl}?date=${day}&timezone=Europe/Lisbon`, {
        headers: { "x-apisports-key": apiKey }
      }),
      fetch(`${espnWorldCupUrl}?dates=${getEspnDateRangeForLocalDay(day)}&limit=200`)
    ]);
    if (!upstream.ok && !espnWorldCup.ok) {
      response.status(upstream.status).json({ response: [], espnWorldCup: [], error: "Matches providers failed" });
      return;
    }

    const data = upstream.ok ? await upstream.json() : { response: [] };
    const espnData = espnWorldCup.ok ? await espnWorldCup.json() : { events: [] };
    response.status(200).json({
      response: data.response ?? [],
      espnWorldCup: espnData.events ?? []
    });
  } catch (error) {
    response.status(500).json({ response: [], espnWorldCup: [], error: error instanceof Error ? error.message : "Unknown error" });
  }
}

function getEspnDateRangeForLocalDay(day) {
  const current = new Date(`${day}T12:00:00Z`);
  const previous = new Date(current.getTime() - 24 * 60 * 60 * 1000);
  return `${formatEspnDateKey(previous)}-${formatEspnDateKey(current)}`;
}

function formatEspnDateKey(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("");
}
