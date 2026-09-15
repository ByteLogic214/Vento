//@card/react
// Panel de selección y análisis para montecarlo_orchestrator.

function Widget({ board, state, themeVariables }) {
  state = state || {};
  var primary = (themeVariables && themeVariables.tokens && themeVariables.tokens.colorPrimary) || '#e11d48';
  var cards = (board && board.cards) || [];
  var fixtureAction = cards.find(function (card) { return card.name === 'seleccionar_partidos_diarios'; });
  var analysisAction = cards.find(function (card) { return card.name === 'obtener_datos_partido'; });
  var rawFixtures = state.seleccionar_partidos_diarios;
  var rawAnalysis = state.obtener_datos_partido;

  function unpack(value) {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (error) { return value; }
    }
    return value;
  }

  function fixtureRows(value) {
    value = unpack(value);
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    return value.matches || value.data || value.items || value.results || [];
  }

  function labelOf(row, keys, fallback) {
    for (var i = 0; i < keys.length; i++) if (row && row[keys[i]] != null) return String(row[keys[i]]);
    return fallback;
  }

  var fixtures = fixtureRows(rawFixtures);
  var leagues = fixtures.reduce(function (all, item) {
    var league = labelOf(item, ['campeonato', 'competition', 'league', 'tournament'], 'Sin competición');
    return all.indexOf(league) === -1 ? all.concat([league]) : all;
  }, []);
  var selectedLeague = state.__ui_league || 'Todas';
  var selectedMatch = state.__ui_match || null;
  var visibleFixtures = fixtures.filter(function (item) {
    return selectedLeague === 'Todas' || labelOf(item, ['campeonato', 'competition', 'league', 'tournament'], 'Sin competición') === selectedLeague;
  });
  var analysis = unpack(rawAnalysis);

  function chooseLeague(league) {
    if (board && board.setState) board.setState('__ui_league', league);
  }
  function chooseMatch(id) {
    if (board && board.setState) board.setState('__ui_match', id);
    if (analysisAction) execute_action(analysisAction.name, { match_id: String(id) });
  }
  function refreshFixtures() {
    if (fixtureAction) execute_action(fixtureAction.name, { date: new Date().toISOString().slice(0, 10) });
  }
  function pct(value) {
    var n = Number(value);
    return isFinite(n) ? (n <= 1 ? n * 100 : n).toFixed(1) + '%' : '—';
  }

  var homeName = analysis && analysis.match && analysis.match.home ? analysis.match.home.name : null;
  var awayName = analysis && analysis.match && analysis.match.away ? analysis.match.away.name : null;
  var market = analysis && analysis.market ? analysis.market : null;
  var implied = market && (market.normalized_market_probability || market.implied_probability);

  return (
    <YStack f={1} bg="$background" gap="$4" p="$4" overflow="scroll">
      <XStack ai="center" jc="space-between" gap="$3" flexWrap="wrap">
        <YStack gap="$1">
          <XStack ai="center" gap="$2"><Icon name="activity" size={23} color={primary} /><Text fontSize={24} fontWeight="800" color="$color12">Match Centre</Text></XStack>
          <Text fontSize={12} color="$color10">Análisis pre-partido · Montecarlo · TheStatsAPI</Text>
        </YStack>
        <Button bg={primary} color="white" onPress={refreshFixtures}><Icon name="refresh-cw" size={16} color="white" /><Text color="white">Cargar jornada</Text></Button>
      </XStack>

      <YStack bg="$backgroundHover" p="$3" br="$5" gap="$2">
        <Text fontSize={11} fontWeight="700" color="$color10" letterSpacing={0.7}>COMPETICIONES</Text>
        <XStack gap="$2" flexWrap="wrap">
          {['Todas'].concat(leagues).map(function (league) {
            var active = selectedLeague === league;
            return <Button key={league} size="$2" bg={active ? primary : '$background'} borderWidth={1} borderColor={active ? primary : '$borderColor'} onPress={function () { chooseLeague(league); }}><Text color={active ? 'white' : '$color11'}>{league}</Text></Button>;
          })}
        </XStack>
        {fixtures.length === 0 && <Text fontSize={12} color="$color9">Pulsa «Cargar jornada» para consultar los partidos disponibles.</Text>}
      </YStack>

      <XStack gap="$4" flexWrap="wrap" ai="flex-start">
        <YStack f={1} minWidth={300} gap="$2">
          <XStack jc="space-between" ai="center"><Text fontSize={15} fontWeight="700">Partidos de hoy</Text><Text fontSize={12} color="$color10">{visibleFixtures.length} encuentros</Text></XStack>
          {visibleFixtures.map(function (match) {
            var id = labelOf(match, ['match_id', 'id'], '');
            var home = labelOf(match, ['local', 'home', 'home_team'], 'Local');
            var away = labelOf(match, ['visitante', 'away', 'away_team'], 'Visitante');
            var time = labelOf(match, ['hora', 'time', 'kickoff'], '—');
            var active = String(selectedMatch) === String(id);
            return <Button key={id} unstyled onPress={function () { chooseMatch(id); }}><XStack ai="center" gap="$3" p="$3" br="$4" bg={active ? '$backgroundHover' : '$background'} borderWidth={1} borderColor={active ? primary : '$borderColor'}><Text w={46} fontSize={12} color={primary} fontWeight="700">{time}</Text><YStack f={1} gap="$1"><Text fontSize={14} fontWeight="700">{home}</Text><Text fontSize={14} fontWeight="700">{away}</Text></YStack><Icon name="chevron-right" size={18} color="$color9" /></XStack></Button>;
          })}
        </YStack>

        <YStack f={1} minWidth={300} bg="$backgroundHover" p="$4" br="$5" gap="$4">
          <XStack ai="center" gap="$2"><Icon name="bar-chart-3" size={19} color={primary} /><Text fontSize={15} fontWeight="700">Centro de predicción</Text></XStack>
          {!analysis || typeof analysis !== 'object' ? <YStack py="$7" ai="center" gap="$2"><Icon name="mouse-pointer-click" size={28} color="$color9" /><Text color="$color10">Selecciona un partido para cargar sus datos.</Text></YStack> : <YStack gap="$4">
            <YStack ai="center" gap="$1"><Text fontSize={16} fontWeight="800">{homeName || 'Local'} <Text color="$color9">vs</Text> {awayName || 'Visitante'}</Text><Text fontSize={11} color="$color10">Datos de mercado y rendimiento disponibles</Text></YStack>
            <XStack gap="$2" flexWrap="wrap">
              {[['1', implied && implied.home], ['X', implied && implied.draw], ['2', implied && implied.away]].map(function (item) { return <YStack key={item[0]} f={1} minWidth={70} p="$3" br="$4" bg="$background" ai="center"><Text fontSize={11} color="$color10">{item[0]}</Text><Text fontSize={20} fontWeight="800" color={primary}>{pct(item[1])}</Text></YStack>; })}
            </XStack>
            <Text fontSize={12} color="$color10">El detalle unificado queda disponible para el motor de simulación al seleccionar el encuentro.</Text>
          </YStack>}
        </YStack>
      </XStack>
    </YStack>
  );
}

