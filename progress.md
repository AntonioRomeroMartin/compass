# Progreso — goals

## Estado actual
- Versión 1.7: código en `lib/` + `app/` y CLI `compass` (primer paso hacia compass, dashboard de varios ámbitos; el diseño vive fuera de este repo).

## Sesiones (más reciente arriba)
- 2026-10-23 · v1.7: `js/` → `lib/` (period, goals —antes store—, github) y `app/` (app.js, styles.css); `period.js` ya no es CLI. Nueva CLI `cli/compass.mjs` (`today`, `goals`, `goal add|inc|set|done|sub|edit|archive`, `period`) sobre un checkout git local, con config en `~/.config/compass/config.json`; si el push choca, deshace su commit y reaplica las operaciones. `sw.js` v4. 25 pruebas (4 de CLI con repos git temporales, incluida una carrera entre dos clones) + app comprobada en el navegador (carga, estilos y caché v4). Siguiente: renombrar el repo a `compass` y empezar el módulo de tareas.
- 2026-09-29 · v1.6: sub-objetivos opcionales (`subgoals: [{id, title, done: [claves de periodo]}]`). Se editan en el formulario (Enter añade otro) y se marcan en la tarjeta (“Sub-goals · 1 of 3”); en hábitos se desmarcan al cambiar de periodo. Operaciones sueltas `addSub`/`editSub`/`toggleSub`/`removeSub` para no pisar cambios de otro dispositivo. Independientes de “Mark as done”. 21 pruebas de lógica + prueba en navegador con API simulada. Siguiente: probar con datos reales; valorar si completar todos los sub-objetivos debe marcar el objetivo.
- 2026-09-29 · v1.5: campos opcionales `location` (chip 📍 en la tarjeta) y `notes` (texto de varias líneas bajo los chips) en el formulario de objetivo. Nueva prueba de lógica (19). Siguiente: probar en el navegador con datos reales.
- 2026-09-29 · v1.4: el plazo es cuándo caduca. Objetivos de una vez (`repeat:false`, `period`) que al caducar pasan a Past con ✓/✗ y % de cumplimiento; casilla Repeat para hábitos; selector Active/Past/Archived. 18 pruebas de lógica + 9 en navegador.
- 2026-09-28 · v1.3: prefijo de commits `goals:`; archivo de datos por defecto `goals.json` (también en el CLI de `period.js`).
- 2026-09-28 · v1.2: interfaz, errores, README y cuerpo de los commits en inglés (se mantiene el prefijo `objetivos:`); archivo por defecto `goals.json`.
- 2026-09-28 · v1.1: sin datos por defecto (usuario, repo, categorías, zona horaria); zona horaria en el archivo de datos; gestión de categorías (añadir/quitar); creación del archivo si no existe; README para otros usuarios.
- 2026-09-28 · v1: vistas por plazo y categoría, filtro, metas por periodo, archivar/borrar, guardado agrupado (2 s), resolución de conflictos, modo sin conexión de solo lectura, PWA.
