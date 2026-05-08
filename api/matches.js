const apiFootballUrl = "https://v3.football.api-sports.io/fixtures";

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
    const upstream = await fetch(`${apiFootballUrl}?date=${day}&timezone=Europe/Lisbon`, {
      headers: { "x-apisports-key": apiKey }
    });
    if (!upstream.ok) {
      response.status(upstream.status).json({ response: [], error: "Matches provider failed" });
      return;
    }

    const data = await upstream.json();
    response.status(200).json({ response: data.response ?? [] });
  } catch (error) {
    response.status(500).json({ response: [], error: error instanceof Error ? error.message : "Unknown error" });
  }
}
