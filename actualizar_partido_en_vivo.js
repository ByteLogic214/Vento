const matchId = String(params.match_id || '').trim();
if (!matchId) throw new Error('match_id es obligatorio.');

const apiKey = await context.keys.getKey({ key: 'STATS_API_KEY' });
if (!apiKey) throw new Error('STATS_API_KEY no está configurada en Vento Keys.');
const api = async (path) => {
  const response = await fetch(`https://api.thestatsapi.com/api${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`TheStatsAPI ${path}: HTTP ${response.status}`);
  const payload = await response.json();
  return payload?.data ?? payload;
};
const pick = (object, keys) => {
  for (const key of keys) if (object?.[key] != null) return object[key];
  return null;
};
const number = value => value === null || value === undefined || value === ''
  ? null
  : (Number.isFinite(Number(value)) ? Number(value) : null);
const team = (match, side) => match?.[side] ?? match?.[`${side}_team`] ?? {};
const compactStats = raw => ({
  goals: number(pick(raw, ['goals', 'goals_scored', 'goals_for'])),
  xg: number(pick(raw, ['xg', 'expected_goals', 'expectedGoals'])),
  corners: number(pick(raw, ['corners', 'corner_kicks', 'cornerKicks'])),
  shots_on_target: number(pick(raw, ['shots_on_target', 'shotsOnTarget']))
});
const statusClass = status => {
  const value = String(status || '').toLowerCase();
  if (['live', 'in_play', 'inplay', '1h', '2h', 'ht'].includes(value)) return 'live';
  if (['finished', 'completed', 'ft', 'full_time'].includes(value)) return 'finished';
  return 'upcoming';
};
const odds1x2 = odds => {
  const bookmakers = Array.isArray(odds?.bookmakers) ? odds.bookmakers : [];
  for (const bookmaker of bookmakers) {
    const market = bookmaker?.markets?.match_odds;
    const home = number(market?.home?.last_seen);
    const draw = number(market?.draw?.last_seen);
    const away = number(market?.away?.last_seen);
    if (home > 1 && draw > 1 && away > 1) {
      const total = 1 / home + 1 / draw + 1 / away;
      return {
        bookmaker: bookmaker.bookmaker || null,
        odds: { home, draw, away },
        probability_percent: {
          home: Math.round((100 / home / total) * 10000) / 10000,
          draw: Math.round((100 / draw / total) * 10000) / 10000,
          away: Math.round((100 / away / total) * 10000) / 10000
        }
      };
    }
  }
  return null;
};

const match = await api(`/football/matches/${encodeURIComponent(matchId)}`);
if (!match || typeof match !== 'object') throw new Error('TheStatsAPI no devolvió el partido solicitado.');
const kind = statusClass(match.status);
const [stats, odds] = await Promise.all([
  api(`/football/matches/${encodeURIComponent(matchId)}/stats`),
  api(`/football/matches/${encodeURIComponent(matchId)}/odds`)
]);
return {
  match_id: matchId,
  fetched_at: new Date().toISOString(),
  status: kind,
  provider_status: match.status ?? null,
  minute: pick(match, ['minute', 'elapsed', 'clock']),
  kickoff: pick(match, ['utc_date', 'kickoff_utc', 'kickoff', 'start_time']),
  home: { name: pick(team(match, 'home'), ['name', 'team_name']), stats: compactStats(stats?.home ?? stats?.home_team) },
  away: { name: pick(team(match, 'away'), ['name', 'team_name']), stats: compactStats(stats?.away ?? stats?.away_team) },
  market_1x2: odds1x2(odds),
  availability: { live_stats_published: Boolean(stats), live_odds_published: Boolean(odds) },
  source: 'TheStatsAPI · consulta actual'
};

