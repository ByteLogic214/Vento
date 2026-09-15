const matchId = String(params.match_id || '').trim();
if (!matchId) throw new Error('match_id es obligatorio.');

const now = Date.now();
const cacheKey = `montecarlo:market-projection:v1:${matchId}`;
const cached = await context.boards.getVar(cacheKey);
if (cached?.expires_at_ms > now && cached?.data) {
  return { ...cached.data, cache: { hit: true, expires_at: new Date(cached.expires_at_ms).toISOString() } };
}

const apiKey = await context.keys.getKey({ key: 'STATS_API_KEY' });
if (!apiKey) throw new Error('STATS_API_KEY no está configurada en Vento Keys.');
const response = await fetch(`https://api.thestatsapi.com/api/football/matches/${encodeURIComponent(matchId)}/odds`, {
  headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
});
if (response.status === 404) {
  return { match_id: matchId, available: false, reason: 'TheStatsAPI aún no ha publicado cuotas prepartido para este encuentro.', source: 'TheStatsAPI' };
}
if (!response.ok) throw new Error(`TheStatsAPI respondió HTTP ${response.status} al consultar cuotas.`);

const payload = await response.json();
const root = payload?.data ?? payload;
const bookmakers = Array.isArray(root?.bookmakers) ? root.bookmakers : [];
const finiteOdd = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 1 ? n : null;
};
const pickMarket = (marketName, outcome) => {
  for (const bookmaker of bookmakers) {
    const value = bookmaker?.markets?.[marketName]?.[outcome]?.last_seen;
    const odd = finiteOdd(value);
    if (odd) return { bookmaker: bookmaker.bookmaker || null, odd };
  }
  return null;
};
const home = pickMarket('match_odds', 'home');
const draw = pickMarket('match_odds', 'draw');
const away = pickMarket('match_odds', 'away');
const entries = { home, draw, away };
const impliedTotal = Object.values(entries).reduce((sum, entry) => sum + (entry ? 1 / entry.odd : 0), 0);
const probability = (entry) => entry && impliedTotal ? Math.round((1000000 * (1 / entry.odd) / impliedTotal)) / 10000 : null;

const over = pickMarket('match_total_goals', '2.5')?.over || null;
const under = pickMarket('match_total_goals', '2.5')?.under || null;
const totalGoalMarket = bookmakers.map((bookmaker) => bookmaker?.markets?.match_total_goals?.['2.5']).find(Boolean) || null;
const overOdd = finiteOdd(totalGoalMarket?.over?.last_seen);
const underOdd = finiteOdd(totalGoalMarket?.under?.last_seen);
const totalImplied = (overOdd ? 1 / overOdd : 0) + (underOdd ? 1 / underOdd : 0);
const totalProbability = (odd) => odd && totalImplied ? Math.round((1000000 * (1 / odd) / totalImplied)) / 10000 : null;

const result = {
  match_id: matchId,
  available: Boolean(impliedTotal),
  source: 'TheStatsAPI · cuotas prepartido publicadas',
  methodology: 'Probabilidades implícitas normalizadas desde cuotas decimales reales; sin datos sintéticos ni simulaciones.',
  market_1x2_percent: { home: probability(home), draw: probability(draw), away: probability(away) },
  odds_1x2: { home: home?.odd ?? null, draw: draw?.odd ?? null, away: away?.odd ?? null },
  bookmaker: home?.bookmaker || draw?.bookmaker || away?.bookmaker || null,
  over_under_2_5_percent: { over_2_5: totalProbability(overOdd), under_2_5: totalProbability(underOdd) },
  data_quality: { odds_available: Boolean(impliedTotal), over_under_2_5_available: Boolean(totalImplied) },
  cache: { hit: false, expires_at: new Date(now + 20 * 60 * 1000).toISOString() }
};
await context.boards.setVar(cacheKey, { expires_at_ms: now + 20 * 60 * 1000, data: result });
return result;

