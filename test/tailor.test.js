import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { recommend, render, escapeLatex } from '../tailor.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bank = {
  aliases: { 'CI/CD': ['continuous integration', 'continuous delivery'] },
  bullets: [
    { id: 'react', role: 'current', text: 'Built a React UI.', keywords: ['React'] },
    { id: 'delivery', role: 'current', text: 'Improved Jenkins CI/CD.', keywords: ['Jenkins', 'CI/CD'] },
    { id: 'monitoring', role: 'current', text: 'Added monitoring.', keywords: ['monitoring'] },
    { id: 'older', role: 'previous', text: 'Older work.', keywords: ['React', 'Jenkins', 'CI/CD'] },
  ],
};
const template = `Header
Current role
% bullets: current
\\begin{highlights}
\\item Current default
\\end{highlights}
Previous role
% bullets: previous
\\begin{highlights}
\\item Previous default
\\end{highlights}
Education stays here
`;

test('ranks within each role by distinct matches and preserves ties', () => {
  const result = recommend(bank, 'React, JENKINS, continuous integration, CI/CD.');
  assert.deepEqual(result.roles.map((group) => group.role), ['current', 'previous']);
  assert.deepEqual(result.roles[0].bullets.map((bullet) => bullet.id), ['delivery', 'react', 'monitoring']);
  assert.deepEqual(result.roles[0].bullets.map((bullet) => bullet.recommendedOrder), [1, 2, 3]);
  assert.deepEqual(result.roles[0].bullets[0].matchedKeywords, ['Jenkins', 'CI/CD']);
  assert.ok(result.roles.flatMap((group) => group.bullets).every((bullet) => bullet.selected));
  const tied = recommend(bank, 'React and monitoring');
  assert.deepEqual(tied.roles[0].bullets.map((bullet) => bullet.id), ['react', 'monitoring', 'delivery']);
  assert.deepEqual(recommend(bank, 'No relevant terms').roles[0].bullets.map((bullet) => bullet.id),
    ['react', 'delivery', 'monitoring']);
});

test('counts repeated words and multiple aliases only once per tag', () => {
  const result = recommend(bank, 'Jenkins Jenkins CI/CD continuous integration continuous delivery');
  assert.deepEqual(result.roles[0].bullets[0].matchedKeywords, ['Jenkins', 'CI/CD']);
});

test('matches literal phrases and punctuation without substring false positives', () => {
  const specialBank = {
    aliases: {},
    bullets: [{ id: 'languages', role: 'current', text: 'Languages',
      keywords: ['Java', 'JavaScript', 'R', 'C', 'C++', 'C#', 'Node.js', 'blue-green', 'full stack'] }],
  };
  const result = recommend(specialBank,
    'Recruiter: JavaScript, C++, C#, Node.js; blue–green and FULL\nSTACK.');
  assert.deepEqual(result.roles[0].bullets[0].matchedKeywords,
    ['JavaScript', 'C++', 'C#', 'Node.js', 'blue-green', 'full stack']);
});

test('renders manual order, edited text, and selection while keeping role positions', () => {
  const application = recommend(bank, 'Jenkins');
  const bullets = application.roles[0].bullets;
  const monitoring = bullets.find((bullet) => bullet.id === 'monitoring');
  monitoring.text = 'Saved 20% & used C#.';
  application.roles[0].bullets = [monitoring, ...bullets.filter((bullet) => bullet !== monitoring)];
  application.roles[0].bullets.find((bullet) => bullet.id === 'delivery').selected = false;
  application.roles.reverse(); // Template, not this array, determines chronology.
  const output = render(template, bank, application);
  assert.ok(output.indexOf('Saved 20\\% \\& used C\\#.') < output.indexOf('Built a React UI.'));
  assert.ok(!output.includes('Improved Jenkins'));
  assert.ok(output.indexOf('Current role') < output.indexOf('Previous role'));
  assert.ok(output.endsWith('Education stays here\n'));
});

test('omits empty highlight lists and handles CRLF templates', () => {
  const application = recommend(bank, 'React');
  application.roles[0].bullets.forEach((bullet) => { bullet.selected = false; });
  const output = render(template.replace(/\n/g, '\r\n'), bank, application);
  assert.equal((output.match(/\\begin\{highlights\}/g) ?? []).length, 1);
  assert.ok(output.includes('\\item Older work.\r\n'));
});

test('escapes plain text instead of allowing LaTeX commands from edited bullets', () => {
  assert.equal(escapeLatex('50% & C# $1_a {b} ~ ^ \\input{x}\nnext'),
    '50\\% \\& C\\# \\$1\\_a \\{b\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}input\\{x\\} next');
});

test('rejects empty descriptions and malformed or duplicated bank entries', () => {
  assert.throws(() => recommend(bank, ' \n '), /description is empty/);
  assert.throws(() => recommend({ ...bank, bullets: [...bank.bullets, bank.bullets[0]] }, 'React'), /duplicate bullet id/);
  const broken = structuredClone(bank);
  broken.bullets[0].keywords = ['React', 'react'];
  assert.throws(() => recommend(broken, 'React'), /Duplicate keywords/);
});

test('rejects missing template blocks and invalid application references', () => {
  const application = recommend(bank, 'React');
  assert.throws(() => render(template.replace('% bullets: current', '% removed'), bank, application),
    /Missing template block/);
  assert.throws(() => render(template + template, bank, application), /duplicate template role/);
  const wrongRole = structuredClone(application);
  wrongRole.roles[0].bullets.push(wrongRole.roles[1].bullets[0]);
  assert.throws(() => render(template, bank, wrongRole), /misplaced bullet/);
  const missing = structuredClone(application);
  missing.roles.pop();
  assert.throws(() => render(template, bank, missing), /Missing application role/);
  const duplicate = structuredClone(application);
  duplicate.roles[0].bullets.push(duplicate.roles[0].bullets[0]);
  assert.throws(() => render(template, bank, duplicate), /duplicate.*bullet/);
  const badSelection = structuredClone(application);
  badSelection.roles[0].bullets[0].selected = 'false';
  assert.throws(() => render(template, bank, badSelection), /selected must be/);
});

test('the real bank covers all seven template roles and preserves the baseline text', async () => {
  const realBank = JSON.parse(await readFile(join(root, 'bullets.json'), 'utf8'));
  const realTemplate = await readFile(join(root, 'resume.tex'), 'utf8');
  const application = recommend(realBank, 'An unmatched description');
  const output = render(realTemplate, realBank, application);
  // The only spelling difference is the explicit empty argument after a tilde command.
  assert.equal(output.replaceAll('\\textasciitilde{}', '\\textasciitilde'), realTemplate);
  assert.equal(application.roles.length, 7);
  assert.equal(realBank.bullets.length, 15);
});

test('CLI supports pasted input, saved edits, isolated export, and refuses overwrites', async (t) => {
  const buildRoot = resolve(root, 'build');
  await mkdir(buildRoot, { recursive: true });
  const dir = await mkdtemp(join(buildRoot, 'test-tailor-'));
  t.after(async () => {
    assert.ok(resolve(dir).startsWith(buildRoot + sep));
    await rm(dir, { recursive: true, force: true });
  });
  const cli = (args, input) => spawnSync(process.execPath, [join(root, 'tailor.js'), ...args],
    { cwd: dir, input, encoding: 'utf8', timeout: 10000 });
  const applicationPath = join(dir, 'application.json');
  const result = cli(['recommend', '--out', applicationPath], 'Jenkins continuous integration microservices');
  assert.equal(result.status, 0, result.stderr);
  const application = JSON.parse(await readFile(applicationPath, 'utf8'));
  assert.equal(application.roles[0].bullets[0].id, 'jenkins-deployments');
  const original = await readFile(applicationPath, 'utf8');
  assert.equal(cli(['recommend', '--out', applicationPath], 'React').status, 1);
  assert.equal(await readFile(applicationPath, 'utf8'), original);
  const outputPath = join(dir, 'nested with spaces', 'resume.tex');
  application.roles[0].bullets[0].text = 'My edited bullet with 20%.';
  await writeFile(applicationPath, JSON.stringify(application));
  const rendered = cli(['render', '--application', applicationPath, '--out', outputPath]);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.ok((await readFile(outputPath, 'utf8')).includes('My edited bullet with 20\\%.'));
  assert.equal(cli(['render', '--application', applicationPath, '--out', join(root, 'resume.tex')]).status, 1);
  const jobPath = join(dir, 'job.txt');
  await writeFile(jobPath, 'React');
  assert.equal(cli(['recommend', '--job', jobPath, '--out', join(dir, 'from-file.json')]).status, 0);
  assert.equal(cli(['recommend', '--out', join(dir, 'blank.json')], '  ').status, 1);
});
