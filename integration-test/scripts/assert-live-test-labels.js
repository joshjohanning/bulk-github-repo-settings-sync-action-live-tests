import { createHash } from 'crypto';
import * as fs from 'fs';

import { assert, createOctokit, getRequiredEnv, info, listLabels, readIntegrationConfig } from './helpers.js';

const MANAGED_PREFIX = 'live-';

function generatedColor(name) {
  return createHash('sha256').update(name.toLowerCase()).digest('hex').slice(0, 6);
}

const BASELINES = JSON.parse(fs.readFileSync('integration-test/baselines/labels.json', 'utf8'));

const FILE_RESULT = {
  created: ['live-global-inline', 'live-precedence', 'live-file-new'],
  updated: ['live-file-update', 'live-file-keep-description', 'live-file-clear-description'],
  unchanged: 1
};

const FILE_SYNCED_STATE = [
  { name: 'LIVE-FILE-UPDATE', color: 'a1b2c3', description: 'Updated from labels file' },
  { name: 'live-file-keep-description', color: 'd4c5f9', description: 'Preserved description' },
  { name: 'live-file-clear-description', color: '333333', description: '' },
  { name: 'live-file-unchanged', color: '444444', description: 'Already up to date' },
  { name: 'live-unmanaged', color: '555555', description: 'Unmanaged label' },
  { name: 'live-file-new', color: '0e8a16', description: 'Created from labels file' },
  { name: 'live-precedence', color: 'fbca04', description: 'File entry wins over inline name' },
  { name: 'live-global-inline', color: generatedColor('live-global-inline'), description: '' }
];

const INLINE_SYNCED_STATE = [
  ...BASELINES.inline,
  { name: 'live-inline-new', color: generatedColor('live-inline-new'), description: '' },
  { name: 'live-inline, comma', color: generatedColor('live-inline, comma'), description: '' }
];

const SCENARIOS = {
  'dry-run': {
    counts: { updated: 1, changed: 1, unchanged: 0 },
    repos: {
      'it-labels-dry-run-a': {
        status: 'would-update',
        ...FILE_RESULT,
        state: BASELINES.file
      }
    }
  },
  apply: {
    counts: { updated: 2, changed: 2, unchanged: 0 },
    repos: {
      'it-labels-inline-a': {
        status: 'updated',
        created: ['live-inline-new', 'live-inline, comma'],
        updated: [],
        unchanged: 1,
        state: INLINE_SYNCED_STATE
      },
      'it-labels-file-a': {
        status: 'updated',
        ...FILE_RESULT,
        state: FILE_SYNCED_STATE
      }
    }
  },
  unchanged: {
    counts: { updated: 2, changed: 0, unchanged: 2 },
    repos: {
      'it-labels-inline-a': { status: 'unchanged', created: [], updated: [], unchanged: 3, state: INLINE_SYNCED_STATE },
      'it-labels-file-a': { status: 'unchanged', created: [], updated: [], unchanged: 7, state: FILE_SYNCED_STATE }
    }
  }
};

function assertCount(name, expected) {
  const actual = Number.parseInt(process.env[name], 10);
  assert(actual === expected, `${name} should equal ${expected}, got: ${process.env[name]}`);
}

function sortStrings(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function assertSameNames(actual, expected, message) {
  assert(
    JSON.stringify(sortStrings(actual || [])) === JSON.stringify(sortStrings(expected)),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

async function assertLabelState(octokit, repoFullName, expectedLabels) {
  const managed = (await listLabels(octokit, repoFullName)).filter(label =>
    label.name.toLowerCase().startsWith(MANAGED_PREFIX)
  );
  assertSameNames(
    managed.map(label => label.name),
    expectedLabels.map(label => label.name),
    `${repoFullName} managed label names (case-sensitive)`
  );

  for (const expected of expectedLabels) {
    const actual = managed.find(label => label.name === expected.name);
    assert(
      actual.color.toLowerCase() === expected.color.toLowerCase(),
      `${repoFullName} label "${expected.name}" color should be ${expected.color}, got ${actual.color}`
    );
    assert(
      (actual.description ?? '') === expected.description,
      `${repoFullName} label "${expected.name}" description should be "${expected.description}", got "${actual.description}"`
    );
  }
}

async function main() {
  try {
    const scenarioName = getRequiredEnv('LABELS_SCENARIO');
    const scenario = SCENARIOS[scenarioName];
    assert(scenario, `Unknown LABELS_SCENARIO: ${scenarioName}`);

    const { repos } = readIntegrationConfig();
    const expectedRepoNames = Object.keys(scenario.repos);
    assertSameNames(
      repos.map(repoConfig => repoConfig.repo.split('/')[1]),
      expectedRepoNames,
      `${scenarioName} config repositories`
    );

    assertCount('ACTION_UPDATED_REPOSITORIES', scenario.counts.updated);
    assertCount('ACTION_CHANGED_REPOSITORIES', scenario.counts.changed);
    assertCount('ACTION_PENDING_REPOSITORIES', 0);
    assertCount('ACTION_UNCHANGED_REPOSITORIES', scenario.counts.unchanged);
    assertCount('ACTION_FAILED_REPOSITORIES', 0);
    assertCount('ACTION_WARNING_REPOSITORIES', 0);

    const results = JSON.parse(process.env.ACTION_RESULTS || '[]');
    assert(results.length === repos.length, 'results output should include every configured repository');
    const resultsByRepo = new Map(results.map(result => [result.repository, result]));
    const octokit = createOctokit();

    for (const repoConfig of repos) {
      const repoFullName = repoConfig.repo;
      const expected = scenario.repos[repoFullName.split('/')[1]];
      const result = resultsByRepo.get(repoFullName);
      assert(result, `Missing result entry for ${repoFullName}`);
      assert(result.success === true, `${repoFullName} result should be successful`);
      assert(result.hasWarnings === false, `${repoFullName} should not have warnings`);

      const sync = result.labelsSync;
      assert(sync?.success === true, `${repoFullName} labels sync should be successful`);
      assert(sync.labels === expected.status, `${repoFullName} labels should be ${expected.status}, got ${sync.labels}`);
      assert(sync.dryRun === (scenarioName === 'dry-run'), `${repoFullName} labels dryRun flag is incorrect`);
      assertSameNames(sync.created, expected.created, `${repoFullName} created labels`);
      assertSameNames(sync.updated, expected.updated, `${repoFullName} updated labels`);
      assert(
        sync.unchanged === expected.unchanged,
        `${repoFullName} unchanged label count should be ${expected.unchanged}, got ${sync.unchanged}`
      );

      const labelSubResults = (result.subResults || []).filter(subResult => subResult.kind === 'labels-sync');
      if (expected.status === 'unchanged') {
        assert(labelSubResults.length === 0, `${repoFullName} should not include a labels-sync sub-result`);
      } else {
        assert(
          labelSubResults.length === 1 && labelSubResults[0].status === 'changed',
          `${repoFullName} should include one changed labels-sync sub-result`
        );
      }

      await assertLabelState(octokit, repoFullName, expected.state);
    }

    info(`Live labels ${scenarioName} assertions passed.`);
  } catch (error) {
    process.stderr.write(`Live labels assertion failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

await main();
