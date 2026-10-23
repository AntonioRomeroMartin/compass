# goals — app de objetivos (PWA)

Repo **público**: solo código. Nunca añadas datos personales, categorías u objetivos
reales, tokens, rutas locales ni nombres de repos privados (tampoco en tests ni docs).
Los datos de cada usuario viven en su propio repo privado.

## Reglas
- Nombres de archivos y carpetas SIEMPRE en inglés.
- HTML + JS sin build, con `// @ts-check` y tipos JSDoc. Ningún script ni recurso de terceros
  (la CSP de `index.html` solo permite `'self'` y `https://api.github.com`).
- Estructura: `lib/` (lógica compartida por app y CLI: `period.js`, `goals.js`, `github.js`), `app/` (PWA; `index.html`
  y `sw.js` en la raíz), `cli/` (`compass.mjs` + `repo.mjs`: git sobre un checkout local, mismas operaciones que la app).
  Los periodos se calculan en la `timeZone` del archivo de datos.
- Esquema del JSON: ver `lib/goals.js` (tipos `Goal` y `GoalsDoc`). Commits de datos con prefijo `goals:`.
- Lógica nueva, en `lib/` y usada por los dos lados; nunca duplicada entre app y CLI.
- Antes de subir: `node --test tests/`. Si cambia la lista `SHELL` de `sw.js`, sube `VERSION`.

## Guardar el progreso
Sobre la marcha, sin esperar al final (la sesión puede cerrarse sin aviso): tras cada cambio
importante, actualiza `progress.md` (fecha, qué se hizo, siguiente paso) y haz commit y push a `main`.
