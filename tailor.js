import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(root, 'resume.tex');
const defaultBankPath = resolve(root, 'bullets.json');
const normalize = (text) => text.normalize('NFKC').toLowerCase()
  .replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const validId = (value) => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateBank(bank) {
  requireValue(bank && Array.isArray(bank.bullets) && bank.bullets.length > 0,
    'The bank must contain a nonempty bullets array.');
  requireValue(bank.aliases && typeof bank.aliases === 'object' && !Array.isArray(bank.aliases),
    'The bank must contain an aliases object ({} is fine).');
  const ids = new Set();
  for (const bullet of bank.bullets) {
    requireValue(bullet && validId(bullet.id) && !ids.has(bullet.id),
      `Invalid or duplicate bullet id: ${bullet?.id}`);
    ids.add(bullet.id);
    requireValue(validId(bullet.role), `Invalid role for ${bullet.id}.`);
    requireValue(nonempty(bullet.text), `Missing text for ${bullet.id}.`);
    requireValue(Array.isArray(bullet.keywords) && bullet.keywords.every(nonempty),
      `keywords must be an array of nonempty strings for ${bullet.id}.`);
    requireValue(new Set(bullet.keywords.map(normalize)).size === bullet.keywords.length,
      `Duplicate keywords for ${bullet.id}.`);
  }
  const aliasKeys = new Set();
  for (const [keyword, aliases] of Object.entries(bank.aliases)) {
    requireValue(nonempty(keyword) && !aliasKeys.has(normalize(keyword)),
      `Invalid or duplicate alias keyword: ${keyword}`);
    aliasKeys.add(normalize(keyword));
    requireValue(Array.isArray(aliases) && aliases.every(nonempty),
      `Aliases for ${keyword} must be an array of nonempty strings.`);
  }
}

function containsPhrase(description, phrase) {
  const escaped = normalize(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Literal phrases, with boundaries that distinguish Java/JavaScript and C/C++/C#.
  return new RegExp(`(?<![\\p{L}\\p{N}_+#])${escaped}(?![\\p{L}\\p{N}_+#])`, 'u')
    .test(description);
}

export function recommend(bank, jobDescription) {
  validateBank(bank);
  requireValue(nonempty(jobDescription), 'The job description is empty.');
  const description = normalize(jobDescription);
  const aliases = new Map(Object.entries(bank.aliases).map(([key, values]) => [normalize(key), values]));
  const roles = new Map();
  for (const bullet of bank.bullets) {
    const matchedKeywords = bullet.keywords.filter((keyword) =>
      [keyword, ...(aliases.get(normalize(keyword)) ?? [])]
        .some((phrase) => containsPhrase(description, phrase)));
    if (!roles.has(bullet.role)) roles.set(bullet.role, []);
    roles.get(bullet.role).push({
      id: bullet.id,
      text: bullet.text,
      selected: true,
      matchedKeywords,
    });
  }
  return {
    jobDescription: jobDescription.trim(),
    roles: [...roles].map(([role, bullets]) => ({
      role,
      bullets: bullets
        .sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length)
        .map((bullet, index) => ({ ...bullet, recommendedOrder: index + 1 })),
    })),
  };
}

export function escapeLatex(text) {
  const escapes = {
    '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}',
    '%': '\\%', '&': '\\&', '$': '\\$', '#': '\\#', '_': '\\_',
    '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
  };
  return text.replace(/\s+/g, ' ').trim().replace(/[\\{}%&$#_~^]/g, (char) => escapes[char]);
}

export function render(template, bank, application) {
  validateBank(bank);
  requireValue(application && Array.isArray(application.roles), 'The application must contain a roles array.');
  const bankById = new Map(bank.bullets.map((bullet) => [bullet.id, bullet]));
  const expectedRoles = new Set(bank.bullets.map((bullet) => bullet.role));
  const roles = new Map();
  const ids = new Set();
  for (const group of application.roles) {
    requireValue(group && expectedRoles.has(group.role) && !roles.has(group.role),
      `Unknown or duplicate application role: ${group?.role}`);
    requireValue(Array.isArray(group.bullets), `Missing bullets array for ${group.role}.`);
    for (const bullet of group.bullets) {
      const original = bankById.get(bullet?.id);
      requireValue(original && original.role === group.role && !ids.has(bullet.id),
        `Unknown, duplicate, or misplaced bullet: ${bullet?.id}`);
      ids.add(bullet.id);
      requireValue(typeof bullet.selected === 'boolean', `selected must be true or false for ${bullet.id}.`);
      requireValue(nonempty(bullet.text), `Missing text for ${bullet.id}.`);
    }
    roles.set(group.role, group.bullets);
  }
  for (const role of expectedRoles) {
    requireValue(roles.has(role), `Missing application role: ${role}. Use an empty bullets array to omit its bullets.`);
  }

  const seen = new Set();
  const newline = template.includes('\r\n') ? '\r\n' : '\n';
  const output = template.replace(
    /^([ \t]*% bullets: ([a-z0-9-]+)[ \t]*\r?\n)\\begin\{highlights\}\r?\n[\s\S]*?\\end\{highlights\}/gm,
    (_block, marker, role) => {
      requireValue(roles.has(role) && !seen.has(role), `Unknown or duplicate template role: ${role}`);
      seen.add(role);
      // Array order is the user's final order; recommendedOrder is informational.
      const items = roles.get(role).filter((bullet) => bullet.selected)
        .map((bullet) => `\\item ${escapeLatex(bullet.text)}`);
      return items.length === 0 ? marker.trimEnd() :
        `${marker}\\begin{highlights}${newline}${items.join(newline)}${newline}\\end{highlights}`;
    },
  );
  for (const role of expectedRoles) {
    requireValue(seen.has(role), `Missing template block: % bullets: ${role}`);
  }
  return output;
}

async function readJson(path) {
  try {
    return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`Could not read JSON at ${path}: ${error.message}`);
  }
}

const usage = `Keyword-based resume tailoring (Node.js 20+, no dependencies)

Recommend bullets and their order:
  node tailor.js recommend --job job.txt --out applications/company-role.json
  Get-Clipboard | node tailor.js recommend --out applications/company-role.json

Edit the application JSON: change text, set selected to false, or move bullets
within their array. recommendedOrder records the original suggestion.

Export the edited selection:
  node tailor.js render --application applications/company-role.json
  .\\build.ps1 -Source build/company-role/resume.tex -OutputDirectory build/company-role -Preview

Options:
  --bank PATH    Use a different bullet bank (default: bullets.json beside this script)
  --out PATH     New application JSON for recommend; output .tex for render
  --help         Show this help

No bullets are automatically excluded. Roles keep their position in resume.tex.
Existing application JSON files are never overwritten by recommend.
`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      job: { type: 'string' }, out: { type: 'string' },
      application: { type: 'string' }, bank: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(usage);
    return;
  }
  requireValue(positionals.length === 1 && ['recommend', 'render'].includes(positionals[0]),
    'Use recommend or render. Run node tailor.js --help for usage.');
  const command = positionals[0];
  const bankPath = resolve(values.bank ?? defaultBankPath);
  const bank = await readJson(bankPath);
  if (command === 'recommend') {
    requireValue(!values.application, '--application is only used with render.');
    requireValue(nonempty(values.out), 'recommend requires --out applications/company-role.json.');
    requireValue(extname(values.out).toLowerCase() === '.json', '--out must be a .json file.');
    requireValue(values.job || !process.stdin.isTTY, 'Provide --job job.txt or pipe in a job description.');
    const jobDescription = values.job ? await readFile(values.job, 'utf8') :
      await new Response(process.stdin).text();
    const application = recommend(bank, jobDescription);
    const out = resolve(values.out);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(application, null, 2) + '\n', { flag: 'wx' });
    for (const group of application.roles) {
      console.log(`\n${group.role}`);
      for (const bullet of group.bullets) {
        console.log(`  ${bullet.recommendedOrder}. ${bullet.id} [${bullet.matchedKeywords.join(', ') || 'no matches'}]`);
      }
    }
    console.log(`\nSaved ${out}. Edit text, selection, or array order, then run render.`);
    return;
  }
  requireValue(!values.job, '--job is only used with recommend.');
  requireValue(nonempty(values.application), 'render requires --application applications/company-role.json.');
  const applicationPath = resolve(values.application);
  const name = basename(applicationPath, extname(applicationPath)).replace(/[^a-zA-Z0-9_-]/g, '-') || 'application';
  const out = resolve(values.out ?? resolve(root, 'build', name, 'resume.tex'));
  requireValue(extname(out).toLowerCase() === '.tex', '--out must be a .tex file.');
  requireValue(out.toLowerCase() !== templatePath.toLowerCase(), 'Choose an output other than the baseline resume.tex.');
  const application = await readJson(applicationPath);
  const template = await readFile(templatePath, 'utf8');
  const output = render(template, bank, application);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, output);
  console.log(`Rendered ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
