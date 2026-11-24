# Resume

One-page XeLaTeX resume. Content: `resume.tex`. Layout: `resume.sty`. Output: `resume.pdf`.

Requires XeLaTeX, Leelawadee UI, and Poppler (`pdfinfo`, `pdftoppm`). Tailoring requires Node.js 20+.

```powershell
.\build.ps1 -Preview   # Build resume.pdf; fails unless exactly one page
npm test; .\test-build.ps1
```

## Tailor to a job

```powershell
Get-Clipboard | node tailor.js recommend --out applications/acme.json
.\build.ps1 -Application acme -Preview   # -> build/acme/resume.pdf
```

`recommend` ranks `bullets.json` by keyword matches. Edit `applications/acme.json`: reorder, rewrite, add `{ "text": "..." }` bullets, or set `"selected": false`. Roles you delete keep their `resume.tex` bullets.

## Extend

- **New bullet or variant:** add `{ id, role, text, keywords }` to `bullets.json`. Add `"default": false` for variants that should start unselected.
- **New role:** add a `% bullets: role-id` comment above its `highlights` list in `resume.tex`.
- **Synonyms:** add them to `aliases` in `bullets.json`.

`npm test` checks that the default bullets in `bullets.json` still match `resume.tex`.
