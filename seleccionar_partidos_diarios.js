const apiKey = await context.keys.getKey({ key: 'STATS_API_KEY' });
if (!apiKey) throw new Error('STATS_API_KEY no está configurada en Vento Keys.');

const requestedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(params.date || ''))
  ? String(params.date)
  : new Date().toISOString().slice(0, 10);

// v2 avoids a previous cache created with the obsolete `date` query parameter.
const cacheKey = `montecarlo:daily-fixtures:v3:${requestedDate}`;
const now = Date.now();
const ttlMs = 20 * 60 * 1000;
const cached = await context.boards.getVar(cacheKey);
if (cached?.expires_at_ms > now && Array.isArray(cached.data)) return cached.data;

const response = await fetch(
  `https://api.thestatsapi.com/api/football/matches?date_from=${encodeURIComponent(requestedDate)}&date_to=${encodeURIComponent(requestedDate)}&per_page=100&utc_offset=%2B00%3A00`,
  { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }
);
if (!response.ok) throw new Error(`TheStatsAPI respondió HTTP ${response.status}`);

const payload = await response.json();
const records = Array.isArray(payload) ? payload : (payload?.data || payload?.matches || []);
const value = records
  .filter((match) => String(match?.utc_date || '').slice(0, 10) === requestedDate)
  .map((match) => ({
    match_id: match?.id ?? match?.match_id ?? null,
    campeonato: match?.competition?.name ?? match?.competition_name ?? match?.competition ?? match?.competition_id ?? 'Competición no publicada',
    local: match?.home_team?.name ?? match?.home?.name ?? null,
    visitante: match?.away_team?.name ?? match?.away?.name ?? null,
    hora: match?.utc_date ?? match?.kickoff_utc ?? match?.kickoff ?? null
  }))
  .filter((match) => match.match_id !== null)
  .map((match) => ({ ...match, match_id: String(match.match_id) }));

await context.boards.setVar(cacheKey, { expires_at_ms: now + ttlMs, data: value });
return value;

