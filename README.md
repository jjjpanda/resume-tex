# Resume

One-page resume in LaTeX. `resume.tex` for the baseline content and `resume.sty` for layout.

Requires XeLaTeX, Leelawadee UI, and `pdfinfo`; previews also need `pdftoppm`.

```powershell
.\build.ps1          # Build
.\build.ps1 -Preview # Build with PNG preview
.\test-build.ps1     # Run checks
```

Output: `resume.pdf`. Builds fail unless the PDF is exactly one page.

**Tailor bullets to a job description**

Requires Node.js 20+. No packages to install, LLM, or server required.

1. Copy a job description, then create an application file:

   ```powershell
   Get-Clipboard | node tailor.js recommend --out applications/acme-backend.json
   ```

   Or use a text file:

   ```powershell
   node tailor.js recommend --job job.txt --out applications/acme-backend.json
   ```

2. Open `applications/acme-backend.json`. Each bullet has its text, matched keywords,
   `recommendedOrder` (1 = first within its role), and `selected: true`.
   Edit the text, set `selected` to `false` to exclude a bullet, or move entries in
   the `bullets` array to set your final order. `recommendedOrder` keeps the initial
   recommendation; changing that number alone does not reorder the export.

3. Export and build:

   ```powershell
   node tailor.js render --application applications/acme-backend.json
   .\build.ps1 -Source build/acme-backend/resume.tex -OutputDirectory build/acme-backend -Preview
   ```

   Output: `build/acme-backend/resume.pdf` and `resume-preview.png`.
   The baseline `resume.tex` is not overwritten. Re-run render and build after edits.
   If the result exceeds one page, shorten or deselect bullets in the application JSON.

**Bullet bank and ordering**

`bullets.json` contains 15 starting bullets from the current resume. Add variants
with a unique `id`, an existing `role`, plain `text`, and a `keywords` array:

```json
{
  "id": "jenkins-deployments-short",
  "role": "jpmc-associate",
  "text": "Improved Jenkins CI/CD across 15 microservices with blue-green deployments.",
  "keywords": ["Jenkins", "CI/CD", "microservices", "blue-green"]
}
```

Matching ignores case, normalizes whitespace and dash styles, and uses complete
words or phrases (`Java` does not match `JavaScript`). The bank's `aliases` object
maps a keyword to alternative phrases, such as `continuous integration` for `CI/CD`.
Each keyword contributes at most one match, regardless of repetitions or aliases.
More distinct matches rank a bullet higher; ties use its order in the bank.
All bullets start selected, including unmatched bullets and newly added variants:
review the selection before building. This is a keyword count, not an ATS score.

Roles and projects keep their template positions. `% bullets: role-id` comments
in `resume.tex` mark the highlight lists replaced during export. To add a new role,
add its heading and marked list to the template as well as its bullets to the bank.
An empty selection removes the list but keeps the role heading. Education, skills,
and other unmarked content stay as written in the template.

The baseline and bullet bank start with the same wording but are edited separately:
update the bank for future recommendations, and `resume.tex` for the untailored PDF.
Existing application files keep their saved text. Use a new output filename to get
fresh recommendations; `recommend` refuses to overwrite saved applications.
Application JSON files are ignored by Git because they contain job descriptions and
personal edits. Back them up separately if needed.

```powershell
npm test              # Keyword, ordering, export, and CLI checks
.\test-build.ps1      # PDF build and one-page enforcement checks
node tailor.js --help # All command options
```
