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
    { id: 'react-short', role: 'current', text: 'React UI.', keywords: ['React'], default: false },
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
const ids = (bullets) => bullets.map((bullet) => bullet.id);

test('ranks within each role by distinct matches and preserves ties', () => {
  const { roles } = recommend(bank, 'React, JENKINS, continuous integration, CI/CD.');
  assert.deepEqual(Object.keys(roles), ['current', 'previous']);
  assert.deepEqual(ids(roles.current), ['delivery', 'react', 'react-short', 'monitoring']);
  assert.deepEqual(roles.current[0].matchedKeywords, ['Jenkins', 'CI/CD']);
  assert.deepEqual(ids(recommend(bank, 'React and monitoring').roles.current), ['react', 'monitoring', 'react-short', 'delivery']);
  assert.deepEqual(ids(recommend(bank, 'Nothing relevant').roles.current), ['react', 'delivery', 'monitoring', 'react-short']);
});

test('selects bullets unless the bank marks them default: false', () => {
  const { roles } = recommend(bank, 'React');
  assert.deepEqual(roles.current.filter((bullet) => !bullet.selected).map((bullet) => bullet.id), ['react-short']);
});

test('counts repeated words and multiple aliases only once per keyword', () => {
  const { roles } = recommend(bank, 'Jenkins Jenkins CI/CD continuous integration continuous delivery');
  assert.deepEqual(roles.current[0].matchedKeywords, ['Jenkins', 'CI/CD']);
});

test('matches whole phrases without substring or R&D false positives', () => {
  const specialBank = { bullets: [{ id: 'languages', role: 'current', text: 'Languages',
    keywords: ['Java', 'JavaScript', 'R', 'C', 'C++', 'C#', 'Node.js', 'blue-green', 'full stack'] }] };
  const { roles } = recommend(specialBank, 'R&D: JavaScript, C++, C#, Node.js; blue–green and FULL\nSTACK.');
  assert.deepEqual(roles.current[0].matchedKeywords, ['JavaScript', 'C++', 'C#', 'Node.js', 'blue-green', 'full stack']);
});

test('renders array order, edits, selection, and custom bullets in template positions', () => {
  const application = recommend(bank, 'Jenkins');
  const [delivery, ...rest] = application.roles.current;
  delivery.selected = false;
  application.roles = { previous: application.roles.previous,
    current: [{ text: 'Custom: saved 20% & used C#.' }, ...rest, delivery] };
  const output = render(template, application);
  assert.ok(output.indexOf('Custom: saved 20\\% \\& used C\\#.') < output.indexOf('Built a React UI.'));
  assert.ok(!output.includes('Improved Jenkins') && !output.includes('\\item React UI.'));
  assert.ok(output.indexOf('Current role') < output.indexOf('Previous role'));
  assert.ok(output.endsWith('Education stays here\n'));
});

test('keeps template bullets for omitted roles and removes empty lists', () => {
  const output = render(template.replace(/\n/g, '\r\n'), { roles: { current: [] } });
  assert.equal((output.match(/\\begin\{highlights\}/g) ?? []).length, 1);
  assert.ok(output.includes('\\item Previous default\r\n'));
});

test('escapes plain text instead of allowing LaTeX commands', () => {
  assert.equal(escapeLatex('50% & C# $1_a {b} ~ ^ \\input{x}\nnext'),
    '50\\% \\& C\\# \\$1\\_a \\{b\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}input\\{x\\} next');
});

test('rejects invalid input', () => {
  assert.throws(() => recommend(bank, ' \n '), /description is empty/);
  assert.throws(() => recommend({ bullets: [...bank.bullets, bank.bullets[0]] }, 'React'), /duplicate bullet id/);
  assert.throws(() => render(template, { roles: [] }), /roles object/);
  assert.throws(() => render(template, { roles: { typo: [] } }), /no "% bullets: typo" block/);
  assert.throws(() => render(template, { roles: { current: [{ text: ' ' }] } }), /Missing bullet text/);
});

test('the real bank matches the baseline resume.tex', async () => {
  const realBank = JSON.parse(await readFile(join(root, 'bullets.json'), 'utf8'));
  const realTemplate = await readFile(join(root, 'resume.tex'), 'utf8');
  const output = render(realTemplate, recommend(realBank, 'An unmatched description'));
  assert.equal(output.replaceAll('\\textasciitilde{}', '\\textasciitilde'), realTemplate);
});

test('CLI recommends from stdin or file, renders, and refuses overwrites', async (t) => {
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
  const original = await readFile(applicationPath, 'utf8');
  const application = JSON.parse(original);
  assert.equal(application.roles['jpmc-associate'][0].id, 'jenkins-deployments');
  assert.equal(cli(['recommend', '--out', applicationPath], 'React').status, 1);
  assert.equal(await readFile(applicationPath, 'utf8'), original);
  application.roles['jpmc-associate'][0].text = 'My edited bullet with 20%.';
  await writeFile(applicationPath, JSON.stringify(application));
  const outputPath = join(dir, 'nested with spaces', 'resume.tex');
  const rendered = cli(['render', '--application', applicationPath, '--out', outputPath]);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.ok((await readFile(outputPath, 'utf8')).includes('My edited bullet with 20\\%.'));
  assert.equal(cli(['render', '--application', applicationPath, '--out', join(root, 'resume.tex')]).status, 1);
  const jobPath = join(dir, 'job.txt');
  await writeFile(jobPath, 'React');
  assert.equal(cli(['recommend', '--job', jobPath, '--out', join(dir, 'from-file.json')]).status, 0);
  assert.equal(cli(['recommend', '--out', join(dir, 'blank.json')], '  ').status, 1);
});
