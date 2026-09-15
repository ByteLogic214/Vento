const matchId = String(params.match_id || '').trim();
if (!matchId) throw new Error('match_id es obligatorio.');

const cacheKey = `montecarlo:match-features:v4:${matchId}`;
const now = Date.now();
const cached = await context.boards.getVar(cacheKey);
if (cached?.expires_at_ms > now && cached?.data) {
  return { ...cached.data, cache: { hit: true, expires_at: new Date(cached.expires_at_ms).toISOString() } };
}

const apiKey = await context.keys.getKey({ key: 'STATS_API_KEY' });
if (!apiKey) throw new Error('STATS_API_KEY no está configurada en Vento Keys.');
const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
// Algunos recursos (stats, alineaciones u odds) aún no existen para un partido futuro.
// Un 404 significa «no publicado», no un fallo del selector.
const api = async (path) => {
  const response = await fetch(`https://api.thestatsapi.com/api${path}`, { headers });
  if (response.status >= 400 && response.status < 500) return null;
  if (!response.ok) throw new Error(`TheStatsAPI ${path}: HTTP ${response.status}`);
  return response.json();
};
const unwrap = (value) => value?.data ?? value;
const rows = (value) => Array.isArray(value) ? value : (Array.isArray(value?.data) ? value.data : []);
const pick = (source, keys) => { for (const key of keys) if (source?.[key] !== undefined && source?.[key] !== null) return source[key]; return null; };
const num = (value) => value === null || value === undefined || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
const metric = (source, keys) => num(pick(source, keys));
const matchKey = (match) => pick(match, ['match_id', 'id']);
const teamKey = (team) => pick(team, ['team_id', 'id']);
const dateOf = (match) => String(pick(match, ['kickoff_utc', 'kickoff', 'start_time']) || '');
const finished = (match) => ['finished', 'completed', 'ft', 'full_time'].includes(String(match?.status || '').toLowerCase());

const match = unwrap(await api(`/football/matches/${encodeURIComponent(matchId)}`));
if (!match || typeof match !== 'object') throw new Error('TheStatsAPI no devolvió el partido solicitado.');
const home = match.home ?? match.home_team ?? null;
const away = match.away ?? match.away_team ?? null;
const competitionId = pick(match, ['competition_id', 'league_id']) ?? pick(match.competition, ['id']);
const season = pick(match, ['season', 'season_id']) ?? pick(match.competition, ['season']);
if (!competitionId || !season || !teamKey(home) || !teamKey(away)) throw new Error('El partido no contiene los identificadores necesarios para consultar forma real.');

const fixtureQuery = `competition_id=${encodeURIComponent(competitionId)}&season=${encodeURIComponent(season)}`;
const [currentStatsResponse, lineupsResponse, oddsResponse, homeFixturesResponse, awayFixturesResponse, playerStatsResponse] = await Promise.all([
  api(`/football/matches/${encodeURIComponent(matchId)}/stats`),
  api(`/football/matches/${encodeURIComponent(matchId)}/lineups`),
  api(`/football/matches/${encodeURIComponent(matchId)}/odds`),
  api(`/football/matches?team_id=${encodeURIComponent(teamKey(home))}`),
  api(`/football/matches?team_id=${encodeURIComponent(teamKey(away))}`),
  api(`/football/players/stats?${fixtureQuery}`)
]);
const allFixtures = [...new Map([...rows(unwrap(homeFixturesResponse)), ...rows(unwrap(awayFixturesResponse))].map((fixture) => [String(matchKey(fixture)), fixture])).values()];
const targetKickoff = dateOf(match);
const historyFor = (teamId) => allFixtures.filter((fixture) => String(matchKey(fixture)) !== matchId).filter(finished).filter((fixture) => targetKickoff ? dateOf(fixture) < targetKickoff : true).filter((fixture) => String(teamKey(fixture.home ?? fixture.home_team ?? {})) === String(teamId) || String(teamKey(fixture.away ?? fixture.away_team ?? {})) === String(teamId)).sort((a, b) => dateOf(b).localeCompare(dateOf(a))).slice(0, 5);
const homeHistory = historyFor(teamKey(home));
const awayHistory = historyFor(teamKey(away));
const uniqueHistory = [...new Map([...homeHistory, ...awayHistory].map((fixture) => [String(matchKey(fixture)), fixture])).values()];
const historicStats = await Promise.all(uniqueHistory.map(async (fixture) => ({ id: String(matchKey(fixture)), stats: unwrap(await api(`/football/matches/${encodeURIComponent(matchKey(fixture))}/stats`)) })));
const statsByMatch = Object.fromEntries(historicStats.map((entry) => [entry.id, entry.stats]));
const sideStats = (stats, side) => stats?.[side] ?? stats?.[`${side}_team`] ?? null;
const sampleFor = (fixture, teamId) => { const isHome = String(teamKey(fixture.home ?? fixture.home_team ?? {})) === String(teamId); const own = sideStats(statsByMatch[String(matchKey(fixture))], isHome ? 'home' : 'away'); const rival = sideStats(statsByMatch[String(matchKey(fixture))], isHome ? 'away' : 'home'); return { goals_scored: metric(own, ['goals', 'goals_scored', 'goals_for']), goals_conceded: metric(rival, ['goals', 'goals_scored', 'goals_for']), shots_on_target: metric(own, ['shots_on_target', 'shotsOnTarget']), xg: metric(own, ['xg', 'expected_goals', 'expectedGoals']) }; };
const average = (samples, field) => { const values = samples.map((sample) => sample[field]).filter((value) => value !== null); return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null; };
const form = (fixtures, teamId) => { const samples = fixtures.map((fixture) => sampleFor(fixture, teamId)); return { matches_used: samples.length, goals_scored_avg: average(samples, 'goals_scored'), goals_conceded_avg: average(samples, 'goals_conceded'), shots_on_target_avg: average(samples, 'shots_on_target'), xg_avg: average(samples, 'xg') }; };

const lineup = unwrap(lineupsResponse);
const lineupRows = (side) => { const section = lineup?.[side] ?? lineup?.[`${side}_team`] ?? null; if (Array.isArray(section)) return section; if (Array.isArray(section?.players)) return section.players; return rows(lineup).filter((row) => String(row?.side || '').toLowerCase() === side); };
const playerStats = rows(unwrap(playerStatsResponse));
const playerIndex = Object.fromEntries(playerStats.map((player) => [String(pick(player, ['player_id', 'id'])), player]));
const lineStrength = (side) => { const buckets = { defense: [], midfield: [], attack: [] }; for (const entry of lineupRows(side)) { const embedded = entry?.player ?? entry; const player = playerIndex[String(pick(entry, ['player_id', 'id']) ?? pick(embedded, ['player_id', 'id']))] ?? embedded; const position = String(pick(entry, ['position', 'position_code']) ?? pick(player, ['position', 'position_code']) ?? '').toLowerCase(); const line = /def|back/.test(position) ? 'defense' : /mid|wing/.test(position) ? 'midfield' : /for|attack|strik/.test(position) ? 'attack' : null; if (!line) continue; buckets[line].push({ goals: metric(player, ['goals']), key_passes: metric(player, ['key_passes', 'keyPasses']), shots: metric(player, ['shots', 'total_shots']), xg: metric(player, ['xg', 'expected_goals', 'expectedGoals']) }); } return Object.fromEntries(Object.entries(buckets).map(([line, players]) => [line, { players_used: players.length, goals_avg: average(players, 'goals'), key_passes_avg: average(players, 'key_passes'), shots_avg: average(players, 'shots'), xg_avg: average(players, 'xg') }])); };

const result = { match_id: matchId, fetched_at: new Date(now).toISOString(), match: { competition_id: competitionId, season, kickoff: dateOf(match) || null, home: { id: teamKey(home), name: pick(home, ['name', 'team_name']), recent_form: form(homeHistory, teamKey(home)), line_strength: lineStrength('home') }, away: { id: teamKey(away), name: pick(away, ['name', 'team_name']), recent_form: form(awayHistory, teamKey(away)), line_strength: lineStrength('away') } }, market: unwrap(oddsResponse), current_match_stats: unwrap(currentStatsResponse), data_quality: { historical_matches_home: homeHistory.length, historical_matches_away: awayHistory.length, lineups_available: lineupRows('home').length + lineupRows('away').length > 0, player_stats_records: playerStats.length, missing_values_are_null: true }, availability: { current_stats_published: currentStatsResponse !== null, lineups_published: lineupsResponse !== null, odds_published: oddsResponse !== null }, cache: { hit: false, expires_at: null } };
const ttlMs = finished(match) ? 30 * 24 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
result.cache.expires_at = new Date(now + ttlMs).toISOString();
await context.boards.setVar(cacheKey, { expires_at_ms: now + ttlMs, data: result });
return result;

