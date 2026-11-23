import { assert, createOctokit, getRepository, getTopics, info, readIntegrationConfig } from './helpers.js';

const MISSING_REPO_MARKER = '/it-partial-missing-';
const SUCCESS_REPO_MARKER = '/it-partial-success-';

function parseIntegerOutput(name) {
  const value = process.env[name];
  assert(value !== undefined, `Missing action output env: ${name}`);
  const parsed = Number.parseInt(value, 10);
  assert(Number.isInteger(parsed), `Expected integer in ${name}, got: ${value}`);
  return parsed;
}

function parseTopics(value) {
  return String(value)
    .split(',')
    .map(topic => topic.trim())
    .filter(Boolean)
    .sort();
}

async function assertRepositoryMissing(octokit, repoFullName) {
  try {
    await getRepository(octokit, repoFullName);
  } catch (error) {
    if (error.status === 404) {
      return;
    }
    throw error;
  }
  throw new Error(`${repoFullName} should not exist`);
}

async function main() {
  try {
    const octokit = createOctokit();
    const { repos } = readIntegrationConfig();
    const outcome = process.env.ACTION_STEP_OUTCOME;
    const rawResults = process.env.ACTION_RESULTS;
    assert(rawResults, 'Missing ACTION_RESULTS output');
    const results = JSON.parse(rawResults);

    const successRepos = repos.filter(repoConfig => repoConfig.repo.includes(SUCCESS_REPO_MARKER));
    const missingRepos = repos.filter(repoConfig => repoConfig.repo.includes(MISSING_REPO_MARKER));
    assert(successRepos.length > 0, 'partial-failure config should include at least one successful repository');
    assert(missingRepos.length > 0, 'partial-failure config should include at least one failing repository');
    assert(
      successRepos.length + missingRepos.length === repos.length,
      'partial-failure config should only include it-partial-success-* and it-partial-missing-* repositories'
    );

    assert(outcome === 'failure', `action step outcome should be failure, got: ${outcome}`);
    assert(
      parseIntegerOutput('ACTION_FAILED_REPOSITORIES') === missingRepos.length,
      `failed-repositories should equal ${missingRepos.length}`
    );
    assert(
      parseIntegerOutput('ACTION_UPDATED_REPOSITORIES') === successRepos.length,
      `updated-repositories should equal ${successRepos.length}`
    );
    assert(
      parseIntegerOutput('ACTION_CHANGED_REPOSITORIES') === successRepos.length,
      `changed-repositories should equal ${successRepos.length}`
    );
    assert(parseIntegerOutput('ACTION_UNCHANGED_REPOSITORIES') === 0, 'unchanged-repositories should equal 0');
    assert(parseIntegerOutput('ACTION_PENDING_REPOSITORIES') === 0, 'pending-repositories should equal 0');
    assert(parseIntegerOutput('ACTION_WARNING_REPOSITORIES') === 0, 'warning-repositories should equal 0');
    assert(results.length === repos.length, 'results output should include every configured repository');

    const resultsByRepo = new Map(results.map(result => [result.repository, result]));

    for (const repoConfig of successRepos) {
      const repoFullName = repoConfig.repo;
      const result = resultsByRepo.get(repoFullName);
      assert(result, `Missing result entry for ${repoFullName}`);
      assert(result.success === true, `${repoFullName} result should be successful`);
      assert(result.hasWarnings === false, `${repoFullName} should not have warnings`);
      assert(
        result.subResults?.some(subResult => subResult.kind === 'topics' && subResult.status === 'changed'),
        `${repoFullName} should include a changed topics sub-result`
      );

      const expectedTopics = parseTopics(repoConfig.topics);
      const liveTopics = (await getTopics(octokit, repoFullName)).sort();
      assert(
        JSON.stringify(liveTopics) === JSON.stringify(expectedTopics),
        `${repoFullName} topics should be ${expectedTopics.join(', ')}, got: ${liveTopics.join(', ')}`
      );
    }

    for (const repoConfig of missingRepos) {
      const repoFullName = repoConfig.repo;
      const result = resultsByRepo.get(repoFullName);
      assert(result, `Missing result entry for ${repoFullName}`);
      assert(result.success === false, `${repoFullName} result should be a failure`);
      assert(
        result.error?.includes('Not Found'),
        `${repoFullName} should report a Not Found error, got: ${result.error}`
      );
      await assertRepositoryMissing(octokit, repoFullName);
    }

    info(`Live partial-failure assertions passed (${missingRepos.length} failed, ${successRepos.length} succeeded).`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

await main();
