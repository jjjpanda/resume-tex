import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(root, 'resume.tex');
const bankPath = resolve(root, 'bullets.json');
const block = /^([ \t]*% bullets: ([a-z0-9-]+)[ \t]*\r?\n)\\begin\{highlights\}\r?\n[\s\S]*?\\end\{highlights\}/gm;
const normalize = (text) => text.normalize('NFKC').toLowerCase()
  .replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateBank(bank) {
  check(Array.isArray(bank?.bullets) && bank.bullets.length > 0, 'The bank must contain a nonempty bullets array.');
  const ids = new Set();
  for (const bullet of bank.bullets) {
    check(nonempty(bullet?.id) && !ids.has(bullet.id), `Invalid or duplicate bullet id: ${bullet?.id}`);
    ids.add(bullet.id);
    check(nonempty(bullet.role), `Missing role for ${bullet.id}.`);
    check(nonempty(bullet.text), `Missing text for ${bullet.id}.`);
    check(Array.isArray(bullet.keywords) && bullet.keywords.every(nonempty),
      `keywords must be an array of nonempty strings for ${bullet.id}.`);
  }
}

function containsPhrase(description, phrase) {
  const escaped = normalize(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_+#&])${escaped}(?![\\p{L}\\p{N}_+#&])`, 'u').test(description);
}

export function recommend(bank, jobDescription) {
  validateBank(bank);
  check(nonempty(jobDescription), 'The job description is empty.');
  const description = normalize(jobDescription);
  const aliases = new Map(Object.entries(bank.aliases ?? {}).map(([keyword, values]) => [normalize(keyword), values]));
  const matches = (keyword) => [keyword, ...(aliases.get(normalize(keyword)) ?? [])]
    .some((phrase) => containsPhrase(description, phrase));
  const roles = {};
  for (const { id, role, text, keywords, default: selected = true } of bank.bullets) {
    (roles[role] ??= []).push({ id, text, selected, matchedKeywords: [...new Set(keywords)].filter(matches) });
  }
  for (const bullets of Object.values(roles)) {
    bullets.sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length);
  }
  return { jobDescription: jobDescription.trim(), roles };
}

export function escapeLatex(text) {
  const escapes = {
    '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}',
    '%': '\\%', '&': '\\&', '$': '\\$', '#': '\\#', '_': '\\_',
    '~': '\\textasciitilde{}', '^': '\\textasciicircum{}',
  };
  return text.replace(/\s+/g, ' ').trim().replace(/[\\{}%&$#_~^]/g, (char) => escapes[char]);
}

export function render(template, application) {
  const roles = application?.roles;
  check(roles && typeof roles === 'object' && !Array.isArray(roles), 'The application must contain a roles object.');
  const newline = template.includes('\r\n') ? '\r\n' : '\n';
  const seen = new Set();
  const output = template.replace(block, (original, marker, role) => {
    seen.add(role);
    if (!(role in roles)) return original;
    check(Array.isArray(roles[role]), `Bullets for ${role} must be an array.`);
    const items = roles[role].filter((bullet) => bullet?.selected !== false).map((bullet) => {
      check(nonempty(bullet?.text), `Missing bullet text in ${role}.`);
      return `\\item ${escapeLatex(bullet.text)}`;
    });
    return items.length === 0 ? marker.trimEnd() :
      `${marker}\\begin{highlights}${newline}${items.join(newline)}${newline}\\end{highlights}`;
  });
  const unknown = Object.keys(roles).filter((role) => !seen.has(role));
  check(unknown.length === 0, `resume.tex has no "% bullets: ${unknown[0]}" block.`);
  return output;
}

async function readJson(path) {
  try {
    return JSON.parse((await readFile(path, 'utf8')).replace(/^﻿/, ''));
  } catch (error) {
    throw new Error(`Could not read JSON at ${path}: ${error.message}`);
  }
}

const usage = `Usage:
  node tailor.js recommend --out applications/NAME.json [--job job.txt]   (or pipe the job description)
  node tailor.js render --application applications/NAME.json [--out build/NAME/resume.tex]

Or render and build in one step: .\\build.ps1 -Application NAME -Preview`;

async function main() {
  const { values, positionals: [command, ...extra] } = parseArgs({
    allowPositionals: true,
    options: {
      job: { type: 'string' }, out: { type: 'string' },
      application: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || !command) return console.log(usage);
  check(extra.length === 0 && ['recommend', 'render'].includes(command), `Unknown command.\n\n${usage}`);

  if (command === 'recommend') {
    check(extname(values.out ?? '').toLowerCase() === '.json', 'recommend requires --out NAME.json.');
    check(values.job || !process.stdin.isTTY, 'Provide --job job.txt or pipe in a job description.');
    const jobDescription = values.job ? await readFile(values.job, 'utf8') : await new Response(process.stdin).text();
    const application = recommend(await readJson(bankPath), jobDescription);
    const out = resolve(values.out);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(application, null, 2) + '\n', { flag: 'wx' });
    for (const [role, bullets] of Object.entries(application.roles)) {
      console.log(`\n${role}`);
      bullets.forEach((bullet, index) => console.log(
        `  ${index + 1}. ${bullet.selected ? '' : '(off) '}${bullet.id} [${bullet.matchedKeywords.join(', ') || 'no matches'}]`));
    }
    return console.log(`\nSaved ${out}. Edit it, then render.`);
  }

  check(nonempty(values.application), 'render requires --application NAME.json.');
  const applicationPath = resolve(values.application);
  const out = resolve(values.out ?? resolve(root, 'build', basename(applicationPath, extname(applicationPath)), 'resume.tex'));
  check(extname(out).toLowerCase() === '.tex', '--out must be a .tex file.');
  check(out.toLowerCase() !== templatePath.toLowerCase(), 'Choose an output other than the baseline resume.tex.');
  const output = render(await readFile(templatePath, 'utf8'), await readJson(applicationPath));
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
