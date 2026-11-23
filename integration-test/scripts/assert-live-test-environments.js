import {
  assert,
  createOctokit,
  getRequiredEnv,
  info,
  listEnvironments,
  readIntegrationConfig
} from './helpers.js';

const REVIEWER_LOGIN = 'joshjohanning';

const INLINE_SYNCED_STATE = {
  // Inline names are create-only, so the baseline wait timer is preserved.
  'live-existing': { wait_timer: 5, prevent_self_review: false, reviewers: [] },
  'live-staging': { wait_timer: 0, prevent_self_review: false, reviewers: [] }
};

const FILE_BASELINE_STATE = {
  'live-review': { wait_timer: 0, prevent_self_review: false, reviewers: [] },
  'live-unmanaged-file': { wait_timer: 0, prevent_self_review: false, reviewers: [] }
};

const FILE_SYNCED_STATE = {
  'live-inline': { wait_timer: 0, prevent_self_review: false, reviewers: [] },
  'live-new': { wait_timer: 1, prevent_self_review: false, reviewers: [] },
  'live-review': { wait_timer: 2, prevent_self_review: true, reviewers: [`User:${REVIEWER_LOGIN}`] }
};

const SCENARIOS = {
  'dry-run': {
    counts: { updated: 1, changed: 1, unchanged: 0 },
    repos: {
      'it-environments-dry-run-a': {
        status: 'would-update',
        created: ['live-inline', 'live-new'],
        updated: ['live-review'],
        deleted: ['live-unmanaged-file'],
        unchanged: 0,
        state: FILE_BASELINE_STATE
      }
    }
  },
  apply: {
    counts: { updated: 2, changed: 2, unchanged: 0 },
    repos: {
      'it-environments-inline-a': {
        status: 'updated',
        created: ['live-staging'],
        updated: [],
        deleted: ['live-unmanaged-inline'],
        unchanged: 1,
        state: INLINE_SYNCED_STATE
      },
      'it-environments-file-a': {
        status: 'updated',
        created: ['live-inline', 'live-new'],
        updated: ['live-review'],
        deleted: ['live-unmanaged-file'],
        unchanged: 0,
        state: FILE_SYNCED_STATE
      }
    }
  },
  unchanged: {
    counts: { updated: 2, changed: 0, unchanged: 2 },
    repos: {
      'it-environments-inline-a': { status: 'unchanged', unchanged: 2, state: INLINE_SYNCED_STATE },
      'it-environments-file-a': { status: 'unchanged', unchanged: 3, state: FILE_SYNCED_STATE }
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

function normalizeEnvironment(environment) {
  const normalized = { wait_timer: 0, prevent_self_review: false, reviewers: [] };
  for (const rule of environment.protection_rules || []) {
    if (rule.type === 'wait_timer') {
      normalized.wait_timer = rule.wait_timer ?? 0;
    } else if (rule.type === 'required_reviewers') {
      normalized.prevent_self_review = rule.prevent_self_review ?? false;
      normalized.reviewers = (rule.reviewers || []).map(
        reviewer => `${reviewer.type}:${reviewer.reviewer?.login ?? reviewer.reviewer?.slug}`
      );
    }
  }
  return normalized;
}

async function assertEnvironmentState(octokit, repoFullName, expectedState) {
  const environments = await listEnvironments(octokit, repoFullName);
  assertSameNames(
    environments.map(environment => environment.name),
    Object.keys(expectedState),
    `${repoFullName} environment names`
  );

  for (const environment of environments) {
    const actual = normalizeEnvironment(environment);
    const expected = expectedState[environment.name];
    assert(
      actual.wait_timer === expected.wait_timer,
      `${repoFullName} environment "${environment.name}" wait_timer should be ${expected.wait_timer}, got ${actual.wait_timer}`
    );
    assert(
      actual.prevent_self_review === expected.prevent_self_review,
      `${repoFullName} environment "${environment.name}" prevent_self_review should be ${expected.prevent_self_review}, got ${actual.prevent_self_review}`
    );
    assertSameNames(actual.reviewers, expected.reviewers, `${repoFullName} environment "${environment.name}" reviewers`);
  }
}

function assertSyncResult(repoFullName, result, scenarioName, expected) {
  const sync = result.environmentsSync;
  const dryRun = scenarioName === 'dry-run';
  assert(sync?.success === true, `${repoFullName} environments sync should be successful`);
  assert(
    sync.environments === expected.status,
    `${repoFullName} environments should be ${expected.status}, got ${sync.environments}`
  );
  assert(sync.dryRun === dryRun, `${repoFullName} environments dryRun flag is incorrect`);
  assert(
    sync.environmentsUnchanged === expected.unchanged,
    `${repoFullName} environmentsUnchanged should be ${expected.unchanged}, got ${sync.environmentsUnchanged}`
  );

  const subResults = (result.subResults || []).filter(subResult => subResult.kind === 'environments-sync');
  if (expected.status === 'unchanged') {
    assert(subResults.length === 0, `${repoFullName} should not report an environments-sync sub-result`);
    return;
  }

  const prefix = dryRun ? 'environmentsWould' : 'environments';
  assertSameNames(sync[`${prefix}Create`] ?? sync[`${prefix}Created`], expected.created, `${repoFullName} created`);
  assertSameNames(sync[`${prefix}Update`] ?? sync[`${prefix}Updated`], expected.updated, `${repoFullName} updated`);
  assertSameNames(sync[`${prefix}Delete`] ?? sync[`${prefix}Deleted`], expected.deleted, `${repoFullName} deleted`);
  assert(
    subResults.length === 1 && subResults[0].status === 'changed',
    `${repoFullName} should report one changed environments-sync sub-result`
  );
}

async function main() {
  try {
    const scenarioName = getRequiredEnv('ENVIRONMENTS_SCENARIO');
    const scenario = SCENARIOS[scenarioName];
    assert(scenario, `Unknown ENVIRONMENTS_SCENARIO: ${scenarioName}`);

    const { repos } = readIntegrationConfig();
    assertSameNames(
      repos.map(repoConfig => repoConfig.repo.split('/')[1]),
      Object.keys(scenario.repos),
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

      assertSyncResult(repoFullName, result, scenarioName, expected);
      await assertEnvironmentState(octokit, repoFullName, expected.state);
    }

    info(`Live environments ${scenarioName} assertions passed`);
  } catch (error) {
    console.error(`Live environments assertion failed: ${error.message}`);
    process.exit(1);
  }
}

await main();
