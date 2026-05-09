const apiFootballUrl = "https://v3.football.api-sports.io/odds";

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSelection(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (["home", "1"].includes(normalized)) return "Casa vence";
  if (["draw", "x"].includes(normalized)) return "Empate";
  if (["away", "2"].includes(normalized)) return "Fora vence";
  return String(value ?? "");
}

function normalizeDoubleChance(value) {
  const normalized = String(value ?? "").toLowerCase().replace(/\s+/g, "");
  if (["home/draw", "1/x", "1x"].includes(normalized)) return "Casa ou empate";
  if (["home/away", "1/2", "12"].includes(normalized)) return "Casa ou fora";
  if (["draw/away", "x/2", "x2"].includes(normalized)) return "Empate ou fora";
  return String(value ?? "");
}

function normalizeOverUnder(value, suffix = "golos") {
  const text = String(value ?? "");
  const normalized = text.toLowerCase();
  const line = text.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(",", ".");
  if (!line) return text;
  if (normalized.includes("over") || normalized.includes("mais")) return `Mais de ${line} ${suffix}`;
  if (normalized.includes("under") || normalized.includes("menos")) return `Menos de ${line} ${suffix}`;
  return text;
}

function normalizeBothTeamsScore(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (["yes", "sim"].includes(normalized)) return "Ambas marcam: Sim";
  if (["no", "nao", "não"].includes(normalized)) return "Ambas marcam: Não";
  return String(value ?? "");
}

function normalizeHandicap(value) {
  const text = String(value ?? "");
  return text
    .replace(/\bhome\b/i, "Casa")
    .replace(/\baway\b/i, "Fora")
    .replace(/\bdraw\b/i, "Empate")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHalfFull(value) {
  const text = String(value ?? "");
  const parts = text.split("/").map((part) => normalizeSelection(part.trim()));
  return parts.length === 2 ? `${parts[0]}/${parts[1]}` : normalizeSelection(text);
}

function mapBetToMarket(betName, rawValue) {
  const name = String(betName ?? "").toLowerCase();

  if (name === "match winner" || name === "1x2" || name === "fulltime result") {
    return { marketType: "1X2", selection: normalizeSelection(rawValue) };
  }
  if (name.includes("double chance")) {
    return { marketType: "Dupla chance", selection: normalizeDoubleChance(rawValue) };
  }
  if (name.includes("both teams") || name.includes("btts")) {
    return { marketType: "Ambas marcam", selection: normalizeBothTeamsScore(rawValue) };
  }
  if (name.includes("over/under") || name.includes("over under") || name.includes("total goals") || name === "goals over/under") {
    return { marketType: "Over/Under", selection: normalizeOverUnder(rawValue) };
  }
  if (name.includes("corners")) {
    return { marketType: "Cantos", selection: normalizeOverUnder(rawValue, "cantos") };
  }
  if (name.includes("cards") || name.includes("booking")) {
    return { marketType: "Cartoes", selection: normalizeOverUnder(rawValue, "cartoes") };
  }
  if (name.includes("correct score") || name.includes("exact score")) {
    return { marketType: "Resultado correto", selection: String(rawValue ?? "") };
  }
  if (name.includes("half time/full time") || name.includes("halftime/fulltime") || name.includes("ht/ft")) {
    return { marketType: "Intervalo/Final", selection: normalizeHalfFull(rawValue) };
  }
  if (name.includes("handicap")) {
    return { marketType: "Handicap", selection: normalizeHandicap(rawValue) };
  }
  if (name.includes("scorer")) {
    return { marketType: "Marcador", selection: String(rawValue ?? "") };
  }

  return { marketType: "Outro", selection: `${betName}: ${rawValue}` };
}

function dedupeBestOdds(odds) {
  const bestBySelection = new Map();
  for (const odd of odds) {
    const key = `${odd.matchId}|${odd.marketType}|${odd.selection}`;
    const current = bestBySelection.get(key);
    if (!current || odd.odds > current.odds) bestBySelection.set(key, odd);
  }
  return Array.from(bestBySelection.values()).map((odd) => ({
    ...odd,
    id: `${odd.matchId}-${slugify(odd.marketType)}-${slugify(odd.selection)}`
  }));
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

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
    const rawOdds = (data.response ?? []).flatMap((event) => {
      const fixtureId = event.fixture?.id;
      if (!fixtureId) return [];

      return (event.bookmakers ?? []).flatMap((bookmaker) =>
        (bookmaker.bets ?? []).flatMap((bet) =>
          (bet.values ?? []).map((value) => {
            const mapped = mapBetToMarket(bet.name, value.value);
            if (!mapped) return null;
            return {
              id: "",
              matchId: `api-football-${fixtureId}`,
              marketType: mapped.marketType,
              selection: mapped.selection,
              odds: Number(value.odd),
              bookmaker: bookmaker.name ?? "API-Football",
              fetchedAt
            };
          })
        )
      ).filter((odd) => odd && Number.isFinite(odd.odds) && odd.odds > 1 && odd.selection);
    });
    const odds = dedupeBestOdds(rawOdds);

    response.status(200).json({ odds });
  } catch (error) {
    response.status(500).json({ odds: [], error: error instanceof Error ? error.message : "Unknown error" });
  }
}
