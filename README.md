# Montecarlo — exportación para GitHub

Exportación del código disponible en la red Vento `montecarlo`, preparada el 15 de septiembre de 2026.

## Contenido

- `pages/`: páginas HTML publicadas y su hoja de estilos.
- `vento/actions/*.json`: definiciones completas y restaurables de las cinco acciones del nodo `montecarlo_orchestrator`.
- `vento/actions/*.js`: copia legible del `rulesCode` de cada acción.
- `vento/node/ui.jsx`: interfaz del nodo.
- `vento/node/automation.js`: automatización actual del nodo (desactivada en la exportación original).
- `.github/workflows/montecarlo-ci.yml`: validación, prueba manual de la API y creación automática de un ZIP como artefacto.

## Secretos

El repositorio no contiene claves. El código usa el nombre `STATS_API_KEY`.

En GitHub, abre **Settings → Secrets and variables → Actions → New repository secret**, crea `STATS_API_KEY` y pega allí la clave de TheStatsAPI. Después ejecuta manualmente el workflow **Montecarlo CI**, activa `check_api` y GitHub comprobará la credencial con una sola petición sin imprimirla.

En Vento, la misma clave debe existir en **Keys** con el nombre `STATS_API_KEY`. Las acciones la leen en tiempo de ejecución mediante `context.keys.getKey(...)`.

## Uso en GitHub

1. Descomprime este ZIP en la raíz de un repositorio.
2. Confirma y sube los archivos.
3. GitHub Actions validará automáticamente los JSON, el JavaScript de las acciones y la presencia de las páginas.
4. Cada ejecución correcta publicará un artefacto descargable llamado `montecarlo-source`.

La prueba de TheStatsAPI es manual para evitar consumo periódico involuntario.

## Restauración en Vento

Las definiciones JSON son la fuente restaurable. En un nodo existente llamado `montecarlo_orchestrator`, cada acción puede cargarse con:

```bash
vento actions add montecarlo_orchestrator -f vento/actions/seleccionar_partidos_diarios.json
vento actions add montecarlo_orchestrator -f vento/actions/obtener_datos_partido.json
vento actions add montecarlo_orchestrator -f vento/actions/proyectar_partido.json
vento actions add montecarlo_orchestrator -f vento/actions/analizar_tendencias_partido.json
vento actions add montecarlo_orchestrator -f vento/actions/actualizar_partido_en_vivo.json
vento nodes ui set montecarlo_orchestrator vento/node/ui.jsx
vento nodes automation set montecarlo_orchestrator vento/node/automation.js
```

Si el nodo no existe, créalo primero desde la plantilla de nodo personalizado disponible en la red de destino. Publica después los archivos de `pages/` mediante la superficie de Páginas de Vento.

## Límite de ejecución fuera de Vento

Las páginas llaman rutas autenticadas del nodo Vento y las acciones usan el runtime de tarjetas (`params`, `context` y caché de board). Guardarlas en GitHub conserva y versiona el código, pero GitHub Pages por sí solo no sustituye ese backend.

