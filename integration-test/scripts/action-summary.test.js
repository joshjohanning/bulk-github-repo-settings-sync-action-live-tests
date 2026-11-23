import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertRulesetSummary } from './assert-action-summary.js';

const capture = fileURLToPath(new URL('./capture-action-summary.cjs', import.meta.url));
const operations = ['update "Managed" (ID: 1)', 'create "New"', 'delete "Obsolete" (ID: 2)'];
const details = 'rulesets: update "Managed" (ID: 1); rulesets: create "New"; rulesets: delete "Obsolete" (ID: 2)';
const row = content => `<tr><td>org/repo</td><td>Changed</td><td>${content}</td></tr>`;

test('captures the completed summary without modifying the runner file', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'action-summary-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const source = path.join(directory, 'runner-summary');
  const destination = path.join(directory, 'captured-summary');
  fs.writeFileSync(source, '');
  const result = spawnSync(process.execPath, ['--require', capture, '-e', `
    require('node:fs').promises.appendFile(process.env.GITHUB_STEP_SUMMARY, ${JSON.stringify(row(details))});
  `], {
    env: { ...process.env, GITHUB_STEP_SUMMARY: source, ACTION_SUMMARY_CAPTURE_PATH: destination },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(destination, 'utf8'), row(details));
  assert.equal(fs.readFileSync(source, 'utf8'), row(details));
  assertRulesetSummary(fs.readFileSync(destination, 'utf8'), 'org/repo', operations);
});

test('missing runner summary fails capture rather than fabricating a summary', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'action-summary-'));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const destination = path.join(directory, 'captured-summary');
  const result = spawnSync(process.execPath, ['--require', capture, '-e', ''], {
    env: {
      ...process.env,
      GITHUB_STEP_SUMMARY: path.join(directory, 'missing'),
      ACTION_SUMMARY_CAPTURE_PATH: destination
    },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(destination), false);
});

test('rejects missing prefixes, missing operations, and details from another repository', () => {
  for (const summary of [
    row(operations.join('; ')),
    row('rulesets: create "New"'),
    row('No changes needed') + row(details).replace('org/repo', 'org/other'),
    row(details) + row(details),
    ''
  ]) {
    assert.throws(() => assertRulesetSummary(summary, 'org/repo', operations));
  }
});
