import { assert, createOctokit, getRepository, getRequiredEnv, getTopics, info } from './helpers.js';

function parseIntegerOutput(name) {
  const value = process.env[name];
  assert(value !== undefined, `Missing action output env: ${name}`);
  const parsed = Number.parseInt(value, 10);
  assert(Number.isInteger(parsed), `Expected integer in ${name}, got: ${value}`);
  return parsed;
}

function parseResultsOutput() {
  const raw = process.env.ACTION_RESULTS;
  assert(raw, 'Missing ACTION_RESULTS output');
  return JSON.parse(raw);
}

function sortStrings(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function assertTopics(topics, expectedTopics, repoFullName) {
  assert(
    JSON.stringify(sortStrings(topics)) === JSON.stringify(sortStrings(expectedTopics)),
    `${repoFullName} topics should equal ${expectedTopics.join(', ')}`
  );
}

function assertVisibility(repository, expectedVisibility, repoFullName) {
  assert(repository.visibility === expectedVisibility, `${repoFullName} should be ${expectedVisibility}`);
}

function getScenarioConfig(org) {
  return {
    'selection-list': {
      description: 'Explicit repository list selects only the named public repositories.',
      selectedRepos: [`${org}/it-select-list-a`, `${org}/it-select-list-b`],
      untouchedRepos: [`${org}/it-select-list-c`],
      expectedTopics: ['selection-list'],
      expectExactCounts: true,
      expectedUpdated: 2,
      expectedChanged: 2,
      expectedUnchanged: 0
    },
    'selection-all': {
      description: 'Owner-wide all-repositories selection includes the dedicated public repositories.',
      selectedRepos: [`${org}/it-select-all-a`, `${org}/it-select-all-b`, `${org}/it-select-all-c`],
      untouchedRepos: [],
      expectedTopics: ['selection-all'],
      expectExactCounts: false
    },
    'selection-custom-property': {
      description: 'Custom-property selection applies to the two matching public repositories and leaves the control repository untouched.',
      selectedRepos: [`${org}/it-select-prop-a`, `${org}/it-select-prop-b`],
      untouchedRepos: [`${org}/it-select-prop-c`],
      expectedTopics: ['selection-custom-property'],
      expectExactCounts: true,
      expectedUpdated: 2,
      expectedChanged: 2,
      expectedUnchanged: 0
    },
    'selection-custom-property-private': {
      description: 'Custom-property selection includes both a public and a private matching repository, while leaving a non-matching private repository untouched.',
      selectedRepos: [
        `${org}/it-select-prop-public-selected-a`,
        `${org}/it-select-prop-private-selected-b`
      ],
      untouchedRepos: [`${org}/it-select-prop-private-ignored-c`],
      expectedTopics: ['selection-custom-property-private'],
      visibilityExpectations: {
        [`${org}/it-select-prop-public-selected-a`]: 'public',
        [`${org}/it-select-prop-private-selected-b`]: 'private',
        [`${org}/it-select-prop-private-ignored-c`]: 'private'
      },
      expectExactCounts: true,
      expectedUpdated: 2,
      expectedChanged: 2,
      expectedUnchanged: 0
    },
    'selection-rules-repos': {
      description: 'Rules-based repo-name selection applies layered settings to the named repositories only.',
      selectedRepos: [`${org}/it-select-rules-a`, `${org}/it-select-rules-b`],
      untouchedRepos: [`${org}/it-select-rules-c`],
      expectExactCounts: true,
      expectedUpdated: 2,
      expectedChanged: 2,
      expectedUnchanged: 0
    },
    'selection-rules-all-and-property': {
      description: 'Rules combine all-repository selection with custom-property overrides.',
      selectedRepos: [`${org}/it-select-rules-all-a`, `${org}/it-select-rules-all-b`, `${org}/it-select-rules-all-c`],
      untouchedRepos: [],
      expectExactCounts: false
    },
    'selection-rules-fork': {
      description: 'Rules can target forked repositories only.',
      selectedRepos: [`${org}/it-select-rules-fork-a`, `${org}/it-select-rules-fork-b`],
      untouchedRepos: [`${org}/it-select-rules-fork-c`],
      expectExactCounts: false
    },
    'selection-rules-visibility': {
      description: 'Rules can target private repositories by visibility.',
      selectedRepos: [`${org}/it-select-rules-visibility-b`, `${org}/it-select-rules-visibility-c`],
      untouchedRepos: [`${org}/it-select-rules-visibility-a`],
      expectExactCounts: false
    }
  };
}

async function assertResultPresence(resultsByRepo, repos) {
  for (const repoFullName of repos) {
    const result = resultsByRepo.get(repoFullName);
    assert(result, `Missing result entry for ${repoFullName}`);
    assert(result.success === true, `${repoFullName} result should be successful`);
    assert(result.hasWarnings === false, `${repoFullName} should not have warnings`);
  }
}

async function main() {
  try {
    const octokit = createOctokit();
    const org = getRequiredEnv('LIVE_TEST_ORG');
    const scenarioName = getRequiredEnv('SELECTION_SCENARIO');
    const scenario = getScenarioConfig(org)[scenarioName];
    assert(scenario, `Unknown repo selection scenario: ${scenarioName}`);
    info(`Scenario ${scenarioName}: ${scenario.description}`);

    const results = parseResultsOutput();
    const resultsByRepo = new Map(results.map(result => [result.repository, result]));

    assert(parseIntegerOutput('ACTION_FAILED_REPOSITORIES') === 0, 'failed-repositories should equal 0');
    assert(parseIntegerOutput('ACTION_WARNING_REPOSITORIES') === 0, 'warning-repositories should equal 0');

    if (scenario.expectExactCounts) {
      assert(
        parseIntegerOutput('ACTION_UPDATED_REPOSITORIES') === scenario.expectedUpdated,
        `updated-repositories should equal ${scenario.expectedUpdated}`
      );
      assert(
        parseIntegerOutput('ACTION_CHANGED_REPOSITORIES') === scenario.expectedChanged,
        `changed-repositories should equal ${scenario.expectedChanged}`
      );
      assert(
        parseIntegerOutput('ACTION_UNCHANGED_REPOSITORIES') === scenario.expectedUnchanged,
        `unchanged-repositories should equal ${scenario.expectedUnchanged}`
      );
      assert(
        results.length === scenario.expectedUpdated,
        `results output should include ${scenario.expectedUpdated} repositories`
      );
    } else {
      assert(
        parseIntegerOutput('ACTION_UPDATED_REPOSITORIES') >= scenario.selectedRepos.length,
        'updated-repositories should include the dedicated selection repos'
      );
      assert(
        parseIntegerOutput('ACTION_CHANGED_REPOSITORIES') >= scenario.selectedRepos.length,
        'changed-repositories should include the dedicated selection repos'
      );
    }

    await assertResultPresence(resultsByRepo, scenario.selectedRepos);

    if (scenarioName === 'selection-list') {
      for (const repoFullName of scenario.selectedRepos) {
        const topics = await getTopics(octokit, repoFullName);
        assertTopics(topics, scenario.expectedTopics, repoFullName);
      }
      for (const repoFullName of scenario.untouchedRepos) {
        const topics = await getTopics(octokit, repoFullName);
        assertTopics(topics, [], repoFullName);
      }
    } else if (scenarioName === 'selection-all') {
      for (const repoFullName of scenario.selectedRepos) {
        const topics = await getTopics(octokit, repoFullName);
        assertTopics(topics, scenario.expectedTopics, repoFullName);
      }
    } else if (scenarioName === 'selection-rules-repos') {
      const repoA = `${org}/it-select-rules-a`;
      const repoB = `${org}/it-select-rules-b`;
      const repoC = `${org}/it-select-rules-c`;

      assertTopics(await getTopics(octokit, repoA), ['selection-rules-base'], repoA);
      assertTopics(await getTopics(octokit, repoB), ['selection-rules-override'], repoB);
      assertTopics(await getTopics(octokit, repoC), [], repoC);

      const repositoryA = await getRepository(octokit, repoA);
      const repositoryB = await getRepository(octokit, repoB);
      const repositoryC = await getRepository(octokit, repoC);

      assert(repositoryA.allow_update_branch === true, `${repoA} should have update branch enabled`);
      assert(repositoryA.delete_branch_on_merge === false, `${repoA} should keep delete-branch-on-merge disabled`);
      assert(repositoryB.allow_update_branch === true, `${repoB} should have update branch enabled`);
      assert(repositoryB.delete_branch_on_merge === true, `${repoB} should have delete-branch-on-merge enabled`);
      assert(repositoryC.allow_update_branch === false, `${repoC} should keep update branch disabled`);
      assert(repositoryC.delete_branch_on_merge === false, `${repoC} should keep delete-branch-on-merge disabled`);
    } else if (scenarioName === 'selection-rules-all-and-property') {
      const repoA = `${org}/it-select-rules-all-a`;
      const repoB = `${org}/it-select-rules-all-b`;
      const repoC = `${org}/it-select-rules-all-c`;

      assertTopics(await getTopics(octokit, repoA), ['selection-rules-all', 'selection-rules-property'], repoA);
      assertTopics(await getTopics(octokit, repoB), ['selection-rules-all', 'selection-rules-property'], repoB);
      assertTopics(await getTopics(octokit, repoC), ['selection-rules-all'], repoC);

      const repositoryA = await getRepository(octokit, repoA);
      const repositoryB = await getRepository(octokit, repoB);
      const repositoryC = await getRepository(octokit, repoC);

      assert(repositoryA.allow_auto_merge === true, `${repoA} should have auto-merge enabled`);
      assert(repositoryB.allow_auto_merge === true, `${repoB} should have auto-merge enabled`);
      assert(repositoryC.allow_auto_merge === false, `${repoC} should keep auto-merge disabled`);
    } else if (scenarioName === 'selection-rules-fork') {
      const repoA = `${org}/it-select-rules-fork-a`;
      const repoB = `${org}/it-select-rules-fork-b`;
      const repoC = `${org}/it-select-rules-fork-c`;

      assertTopics(await getTopics(octokit, repoA), ['selection-rules-fork'], repoA);
      assertTopics(await getTopics(octokit, repoB), ['selection-rules-fork'], repoB);
      assertTopics(await getTopics(octokit, repoC), ['selection-rules-all'], repoC);

      const repositoryA = await getRepository(octokit, repoA);
      const repositoryB = await getRepository(octokit, repoB);
      const repositoryC = await getRepository(octokit, repoC);

      assert(repositoryA.fork === true, `${repoA} should be a fork`);
      assert(repositoryB.fork === true, `${repoB} should be a fork`);
      assert(repositoryC.fork === false, `${repoC} should not be a fork`);

      assert(repositoryA.allow_update_branch === true, `${repoA} should have update branch enabled`);
      assert(repositoryB.allow_update_branch === true, `${repoB} should have update branch enabled`);
      assert(repositoryC.allow_update_branch === false, `${repoC} should keep update branch disabled`);
    } else if (scenarioName === 'selection-rules-visibility') {
      const repoA = `${org}/it-select-rules-visibility-a`;
      const repoB = `${org}/it-select-rules-visibility-b`;
      const repoC = `${org}/it-select-rules-visibility-c`;

      assertTopics(await getTopics(octokit, repoA), ['selection-rules-all'], repoA);
      assertTopics(await getTopics(octokit, repoB), ['selection-rules-visibility'], repoB);
      assertTopics(await getTopics(octokit, repoC), ['selection-rules-visibility'], repoC);

      const repositoryA = await getRepository(octokit, repoA);
      const repositoryB = await getRepository(octokit, repoB);
      const repositoryC = await getRepository(octokit, repoC);

      assert(repositoryA.visibility === 'public', `${repoA} should be public`);
      assert(repositoryB.visibility === 'private', `${repoB} should be private`);
      assert(repositoryC.visibility === 'private', `${repoC} should be private`);

      assert(repositoryA.allow_update_branch === false, `${repoA} should keep update branch disabled`);
      assert(repositoryB.allow_update_branch === true, `${repoB} should have update branch enabled`);
      assert(repositoryC.allow_update_branch === true, `${repoC} should have update branch enabled`);
    } else if (scenarioName === 'selection-custom-property') {
      for (const repoFullName of scenario.selectedRepos) {
        const topics = await getTopics(octokit, repoFullName);
        assertTopics(topics, scenario.expectedTopics, repoFullName);
      }
      for (const repoFullName of scenario.untouchedRepos) {
        const topics = await getTopics(octokit, repoFullName);
        assertTopics(topics, [], repoFullName);
      }
    } else if (scenarioName === 'selection-custom-property-private') {
      const repoA = `${org}/it-select-prop-public-selected-a`;
      const repoB = `${org}/it-select-prop-private-selected-b`;
      const repoC = `${org}/it-select-prop-private-ignored-c`;

      assertTopics(await getTopics(octokit, repoA), scenario.expectedTopics, repoA);
      assertTopics(await getTopics(octokit, repoB), scenario.expectedTopics, repoB);
      assertTopics(await getTopics(octokit, repoC), [], repoC);

      const repositoryA = await getRepository(octokit, repoA);
      const repositoryB = await getRepository(octokit, repoB);
      const repositoryC = await getRepository(octokit, repoC);

      assertVisibility(repositoryA, scenario.visibilityExpectations[repoA], repoA);
      assertVisibility(repositoryB, scenario.visibilityExpectations[repoB], repoB);
      assertVisibility(repositoryC, scenario.visibilityExpectations[repoC], repoC);
    } else {
      throw new Error(`No repo selection assertions configured for ${scenarioName}`);
    }

    info(`Repo selection assertions passed for ${scenarioName}.`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

await main();
