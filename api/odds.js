const apiFootballUrl = "https://v3.football.api-sports.io/odds";
const espnWorldCupUrl = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

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

function normalizeDecimal(value) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? Number(number.toFixed(1)) : null;
}

function extractDecimalLine(value, fallback) {
  const direct = normalizeDecimal(value);
  if (direct) return direct;
  const matched = String(value ?? "").match(/\d+(?:[.,]\d+)?/);
  return normalizeDecimal(matched?.[0] ?? fallback);
}

function americanToDecimal(value) {
  const number = Number(String(value ?? "").replace("+", ""));
  if (!Number.isFinite(number) || number === 0) return null;
  const decimal = number > 0 ? 1 + number / 100 : 1 + 100 / Math.abs(number);
  return Math.round(decimal * 100) / 100;
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
  const line = normalizeDecimal(text.match(/\d+(?:[.,]\d+)?/)?.[0]);
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

function normalizeCorrectScore(value) {
  const text = String(value ?? "").trim();
  const score = text.match(/(\d+)\D+(\d+)/);
  return score ? `${Number(score[1])}-${Number(score[2])}` : text;
}

function normalizeBetName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMainTotalGoalsMarket(name) {
  return [
    "goals over/under",
    "goal line",
    "total goals",
    "total",
    "over/under",
    "over under"
  ].includes(name);
}

function isMainCornersMarket(name) {
  return [
    "corners over under",
    "corners over/under",
    "total corners",
    "corners total"
  ].includes(name);
}

function isMainCardsMarket(name) {
  return [
    "cards over under",
    "cards over/under",
    "total cards",
    "booking points over under",
    "booking points over/under"
  ].includes(name);
}

function isHalfTimeResultMarket(name) {
  return [
    "1st half winner",
    "first half winner",
    "half time result",
    "halftime result",
    "half time winner",
    "ht result"
  ].includes(name);
}

function isHalfTimeGoalsMarket(name) {
  return [
    "1st half goals over/under",
    "first half goals over/under",
    "1st half over/under",
    "first half over/under",
    "1st half total goals",
    "first half total goals",
    "half time goals over/under",
    "halftime goals over/under"
  ].includes(name);
}

function mapBetToMarket(betName, rawValue) {
  const name = normalizeBetName(betName);

  if (name === "match winner" || name === "1x2" || name === "fulltime result") {
    return { marketType: "1X2", selection: normalizeSelection(rawValue) };
  }
  if (name.includes("double chance")) {
    return { marketType: "Dupla chance", selection: normalizeDoubleChance(rawValue) };
  }
  if (name.includes("both teams") || name.includes("btts")) {
    return { marketType: "Ambas marcam", selection: normalizeBothTeamsScore(rawValue) };
  }
  if (isMainTotalGoalsMarket(name)) {
    return { marketType: "Over/Under", selection: normalizeOverUnder(rawValue) };
  }
  if (isHalfTimeResultMarket(name)) {
    return { marketType: "Intervalo", selection: normalizeSelection(rawValue) };
  }
  if (isHalfTimeGoalsMarket(name)) {
    return { marketType: "Golos ao intervalo", selection: normalizeOverUnder(rawValue, "golos ao intervalo") };
  }
  if (isMainCornersMarket(name)) {
    return { marketType: "Cantos", selection: normalizeOverUnder(rawValue, "cantos") };
  }
  if (isMainCardsMarket(name)) {
    return { marketType: "Cartoes", selection: normalizeOverUnder(rawValue, "cartoes") };
  }
  if (name.includes("correct score") || name.includes("exact score")) {
    return { marketType: "Resultado correto", selection: normalizeCorrectScore(rawValue) };
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

  return null;
}

const allowedSelectionsByMarket = {
  "1X2": new Set(["Casa vence", "Empate", "Fora vence"]),
  "Dupla chance": new Set(["Casa ou empate", "Casa ou fora", "Empate ou fora"]),
  "Ambas marcam": new Set(["Ambas marcam: Sim", "Ambas marcam: Não"]),
  Intervalo: new Set(["Casa vence", "Empate", "Fora vence"]),
  "Over/Under": new Set([
    "Mais de 0.5 golos",
    "Mais de 1.5 golos",
    "Mais de 2.5 golos",
    "Mais de 3.5 golos",
    "Menos de 0.5 golos",
    "Menos de 1.5 golos",
    "Menos de 2.5 golos",
    "Menos de 3.5 golos"
  ]),
  "Golos ao intervalo": new Set([
    "Mais de 0.5 golos ao intervalo",
    "Mais de 1.5 golos ao intervalo",
    "Mais de 2.5 golos ao intervalo",
    "Menos de 0.5 golos ao intervalo",
    "Menos de 1.5 golos ao intervalo",
    "Menos de 2.5 golos ao intervalo"
  ]),
  "Resultado correto": new Set(["0-0", "1-0", "2-0", "2-1", "1-1", "0-1", "0-2", "1-2"]),
  "Intervalo/Final": new Set([
    "Casa vence/Casa vence",
    "Casa vence/Empate",
    "Casa vence/Fora vence",
    "Empate/Casa vence",
    "Empate/Empate",
    "Empate/Fora vence",
    "Fora vence/Casa vence",
    "Fora vence/Empate",
    "Fora vence/Fora vence"
  ]),
  Cartoes: new Set([
    "Mais de 3.5 cartoes",
    "Mais de 4.5 cartoes",
    "Mais de 5.5 cartoes",
    "Menos de 3.5 cartoes",
    "Menos de 4.5 cartoes",
    "Menos de 5.5 cartoes"
  ]),
  Cantos: new Set([
    "Mais de 8.5 cantos",
    "Mais de 9.5 cantos",
    "Mais de 10.5 cantos",
    "Menos de 8.5 cantos",
    "Menos de 9.5 cantos",
    "Menos de 10.5 cantos"
  ])
};

function isUsefulOdd(odd) {
  if (odd.marketType === "Handicap") {
    return /(?:Casa|Fora)\s+[+-](?:0\.5|1|1\.0|1\.5|2|2\.0)$/.test(odd.selection);
  }
  if (odd.marketType === "Marcador" || odd.marketType === "Outro") return false;
  const allowedSelections = allowedSelectionsByMarket[odd.marketType];
  return allowedSelections ? allowedSelections.has(odd.selection) : true;
}

function aggregateAverageOdds(odds) {
  const grouped = new Map();
  for (const odd of odds) {
    if (!isUsefulOdd(odd)) continue;
    const key = `${odd.matchId}|${odd.marketType}|${odd.selection}`;
    const current = grouped.get(key) ?? {
      ...odd,
      oddsTotal: 0,
      count: 0,
      bookmakers: new Set()
    };
    current.oddsTotal += odd.odds;
    current.count += 1;
    current.bookmakers.add(odd.bookmaker);
    grouped.set(key, current);
  }
  return Array.from(grouped.values()).map((odd) => {
    const average = odd.oddsTotal / odd.count;
    return {
      id: `${odd.matchId}-${slugify(odd.marketType)}-${slugify(odd.selection)}`,
      matchId: odd.matchId,
      marketType: odd.marketType,
      selection: odd.selection,
      odds: Math.round(average * 100) / 100,
      bookmaker: odd.count > 1 ? `Média API (${odd.count})` : odd.bookmaker,
      fetchedAt: odd.fetchedAt
    };
  });
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  const apiKey = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY;
  const day = request.query.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) {
    response.status(400).json({ odds: [], error: "Invalid date" });
    return;
  }

  try {
    const fetchedAt = new Date().toISOString();
    const [apiFootballOdds, espnWorldCupOdds] = await Promise.all([
      fetchApiFootballOdds(day, apiKey, fetchedAt),
      fetchEspnWorldCupOdds(day, fetchedAt)
    ]);
    const rawOdds = [...apiFootballOdds, ...espnWorldCupOdds];
    const odds = aggregateAverageOdds(rawOdds);

    response.status(200).json({ odds });
  } catch (error) {
    response.status(500).json({ odds: [], error: error instanceof Error ? error.message : "Unknown error" });
  }
}

async function fetchApiFootballOdds(day, apiKey, fetchedAt) {
  if (!apiKey) return [];
  try {
    const upstream = await fetch(`${apiFootballUrl}?date=${day}&timezone=Europe/Lisbon`, {
      headers: { "x-apisports-key": apiKey }
    });
    if (!upstream.ok) return [];

    const data = await upstream.json();
    return (data.response ?? []).flatMap((event) => {
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
  } catch {
    return [];
  }
}

async function fetchEspnWorldCupOdds(day, fetchedAt) {
  try {
    const upstream = await fetch(`${espnWorldCupUrl}?dates=${getEspnDateRangeForLocalDay(day)}&limit=200`);
    if (!upstream.ok) return [];
    const data = await upstream.json();
    return (data.events ?? []).flatMap((event) => mapEspnEventOdds(event, fetchedAt));
  } catch {
    return [];
  }
}

function mapEspnEventOdds(event, fetchedAt) {
  const odds = event.competitions?.[0]?.odds?.[0];
  if (!odds) return [];
  const matchId = `api-football-espn-world-${event.id}`;
  const bookmaker = `${odds.provider?.displayName ?? odds.provider?.name ?? "ESPN"} via ESPN`;
  const result = [];

  addEspnOdd(result, matchId, "1X2", "Casa vence", odds.moneyline?.home?.close?.odds, bookmaker, fetchedAt);
  addEspnOdd(result, matchId, "1X2", "Empate", odds.moneyline?.draw?.close?.odds ?? odds.drawOdds?.moneyLine, bookmaker, fetchedAt);
  addEspnOdd(result, matchId, "1X2", "Fora vence", odds.moneyline?.away?.close?.odds, bookmaker, fetchedAt);

  const overLine = extractDecimalLine(odds.total?.over?.close?.line, odds.overUnder);
  const underLine = extractDecimalLine(odds.total?.under?.close?.line, odds.overUnder);
  if (overLine) addEspnOdd(result, matchId, "Over/Under", `Mais de ${overLine} golos`, odds.total?.over?.close?.odds, bookmaker, fetchedAt);
  if (underLine) addEspnOdd(result, matchId, "Over/Under", `Menos de ${underLine} golos`, odds.total?.under?.close?.odds, bookmaker, fetchedAt);

  const homeSpreadLine = odds.pointSpread?.home?.close?.line;
  const awaySpreadLine = odds.pointSpread?.away?.close?.line;
  if (homeSpreadLine) addEspnOdd(result, matchId, "Handicap", `Casa ${homeSpreadLine}`, odds.pointSpread?.home?.close?.odds, bookmaker, fetchedAt);
  if (awaySpreadLine) addEspnOdd(result, matchId, "Handicap", `Fora ${awaySpreadLine}`, odds.pointSpread?.away?.close?.odds, bookmaker, fetchedAt);

  return result;
}

function addEspnOdd(target, matchId, marketType, selection, americanOdds, bookmaker, fetchedAt) {
  const odds = americanToDecimal(americanOdds);
  if (!odds || odds <= 1) return;
  target.push({
    id: "",
    matchId,
    marketType,
    selection,
    odds,
    bookmaker,
    fetchedAt
  });
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
