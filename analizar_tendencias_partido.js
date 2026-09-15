const matchId = String(params.match_id || '').trim();
if (!matchId) throw new Error('match_id es obligatorio.');
const cacheKey = `montecarlo:real-trends:v2:${matchId}`;
const now = Date.now();
const cached = await context.boards.getVar(cacheKey);
if (cached?.expires_at_ms > now) return { ...cached.data, cache: { hit: true, expires_at: new Date(cached.expires_at_ms).toISOString() } };

const apiKey = await context.keys.getKey({ key: 'STATS_API_KEY' });
if (!apiKey) throw new Error('STATS_API_KEY no está configurada en Vento Keys.');
const api = async path => {
  const r = await fetch(`https://api.thestatsapi.com/api${path}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
  if (r.status >= 400 && r.status < 500) return null;
  if (!r.ok) throw new Error(`TheStatsAPI ${path}: HTTP ${r.status}`);
  return r.json();
};
const unwrap = p => p?.data ?? p;
const rows = p => Array.isArray(p) ? p : (Array.isArray(p?.data) ? p.data : []);
const pick = (o, keys) => { for (const k of keys) if (o?.[k] != null) return o[k]; return null; };
const num = v => v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
const metric = (o, names) => num(pick(o, names));
const id = x => pick(x, ['id', 'match_id', 'team_id']);
const team = (m, side) => m?.[side] ?? m?.[`${side}_team`] ?? {};
const date = m => String(pick(m, ['utc_date', 'kickoff_utc', 'kickoff', 'start_time']) || '');
const isFinished = m => ['finished', 'completed', 'ft', 'full_time'].includes(String(m?.status || '').toLowerCase());
const avg = values => { const x = values.filter(v => v != null); return x.length ? x.reduce((a,b) => a+b,0) / x.length : null; };
const pct = values => { const x = values.filter(v => v != null); return x.length ? 100 * x.reduce((a,b) => a+b,0) / x.length : null; };
const round = v => v == null ? null : Math.round(v * 10000) / 10000;

const match = unwrap(await api(`/football/matches/${encodeURIComponent(matchId)}`));
if (!match || typeof match !== 'object') throw new Error('TheStatsAPI no devolvió el partido solicitado.');
const home = team(match, 'home'), away = team(match, 'away');
const homeId = id(home), awayId = id(away), kickoff = date(match);
if (!homeId || !awayId) throw new Error('El partido no contiene identificadores de ambos equipos.');
const [homeList, awayList] = await Promise.all([
  api(`/football/matches?team_id=${encodeURIComponent(homeId)}&per_page=50`),
  api(`/football/matches?team_id=${encodeURIComponent(awayId)}&per_page=50`)
]);
const past = list => rows(unwrap(list)).filter(m => String(id(m)) !== matchId && isFinished(m) && (!kickoff || date(m) < kickoff));
const homePast = past(homeList), awayPast = past(awayList);
const recent = (list, teamId) => list.filter(m => String(id(team(m,'home'))) === String(teamId) || String(id(team(m,'away'))) === String(teamId)).sort((a,b) => date(b).localeCompare(date(a))).slice(0,5);
const homeFive = recent(homePast, homeId), awayFive = recent(awayPast, awayId);
const h2h = [...new Map([...homePast, ...awayPast].map(m => [String(id(m)),m])).values()]
  .filter(m => [String(id(team(m,'home'))),String(id(team(m,'away')))].includes(String(homeId)) && [String(id(team(m,'home'))),String(id(team(m,'away')))].includes(String(awayId)))
  .sort((a,b) => date(b).localeCompare(date(a))).slice(0,5);
const unique = [...new Map([...homeFive,...awayFive,...h2h].map(m => [String(id(m)),m])).values()];
const statsEntries = await Promise.all(unique.map(async m => [String(id(m)), unwrap(await api(`/football/matches/${encodeURIComponent(id(m))}/stats`))]));
const stats = Object.fromEntries(statsEntries);
const sideStats = (m, teamId) => { const side = String(id(team(m,'home'))) === String(teamId) ? 'home' : 'away'; const root = stats[String(id(m))] || {}; return { own: root?.[side] ?? root?.[`${side}_team`] ?? null, rival: root?.[side === 'home' ? 'away' : 'home'] ?? root?.[side === 'home' ? 'away_team' : 'home_team'] ?? null }; };
const sample = (m, teamId) => { const {own,rival} = sideStats(m,teamId); const gf = metric(own,['goals','goals_scored','goals_for']); const ga = metric(rival,['goals','goals_scored','goals_for']); return {
  goals_for: gf, goals_against: ga,
  xg_for: metric(own,['xg','expected_goals','expectedGoals']), xg_against: metric(rival,['xg','expected_goals','expectedGoals']),
  corners_for: metric(own,['corners','corner_kicks','cornerKicks']), corners_against: metric(rival,['corners','corner_kicks','cornerKicks']),
  shots_on_target_for: metric(own,['shots_on_target','shotsOnTarget']), shots_on_target_against: metric(rival,['shots_on_target','shotsOnTarget']),
  btts: gf != null && ga != null ? (gf > 0 && ga > 0 ? 1 : 0) : null,
  over_2_5: gf != null && ga != null ? (gf + ga > 2.5 ? 1 : 0) : null
}; };
const aggregate = (fixtures, teamId) => { const s = fixtures.map(m => sample(m,teamId)); const field = k => avg(s.map(x => x[k])); return { matches_used:s.length, goals_for_avg:round(field('goals_for')), goals_against_avg:round(field('goals_against')), xg_for_avg:round(field('xg_for')), xg_against_avg:round(field('xg_against')), corners_for_avg:round(field('corners_for')), corners_against_avg:round(field('corners_against')), shots_on_target_for_avg:round(field('shots_on_target_for')), shots_on_target_against_avg:round(field('shots_on_target_against')), btts_percent:round(pct(s.map(x => x.btts))), over_2_5_percent:round(pct(s.map(x => x.over_2_5))) }; };
const hf = aggregate(homeFive,homeId), af = aggregate(awayFive,awayId);
const hHome = aggregate(h2h,homeId), hAway = aggregate(h2h,awayId);
const pair = (a,b) => a == null || b == null ? null : round((a+b)/2);
const estimate = {
  lambda_home_xg: pair(hf.xg_for_avg, af.xg_against_avg),
  lambda_away_xg: pair(af.xg_for_avg, hf.xg_against_avg),
  expected_corners_home: pair(hf.corners_for_avg, af.corners_against_avg),
  expected_corners_away: pair(af.corners_for_avg, hf.corners_against_avg),
  expected_shots_on_target_home: pair(hf.shots_on_target_for_avg, af.shots_on_target_against_avg),
  expected_shots_on_target_away: pair(af.shots_on_target_for_avg, hf.shots_on_target_against_avg),
  btts_percent: pair(hf.btts_percent, af.btts_percent),
  over_2_5_percent: pair(hf.over_2_5_percent, af.over_2_5_percent)
};
const result = { match_id:matchId, generated_at:new Date(now).toISOString(), methodology:'Promedios emparejados de los últimos cinco partidos finalizados por equipo; H2H se publica aparte. Cada valor nulo significa que TheStatsAPI no publicó esa estadística.', match:{home:{id:homeId,name:pick(home,['name','team_name'])},away:{id:awayId,name:pick(away,['name','team_name'])},kickoff:kickoff||null}, recent_form:{home:hf,away:af}, head_to_head:{matches_used:h2h.length,home:hHome,away:hAway}, estimate, cache:{hit:false,expires_at:new Date(now + 6*60*60*1000).toISOString()} };
await context.boards.setVar(cacheKey,{expires_at_ms:now+6*60*60*1000,data:result});
return result;

