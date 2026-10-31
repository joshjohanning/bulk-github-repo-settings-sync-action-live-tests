import * as fs from 'fs';

import { assert, createOctokit, getFileContent, listOpenPullRequestsForBranch } from './helpers.js';

function parseIntegerOutput(name, expected) {
  const value = Number.parseInt(process.env[name], 10);
  assert(value === expected, `${name} should equal ${expected}, got: ${process.env[name]}`);
}

async function main() {
  try {
    const repo = process.env.INTEGRATION_REPOSITORY;
    assert(repo, 'Missing INTEGRATION_REPOSITORY');
    parseIntegerOutput('ACTION_UPDATED_REPOSITORIES', 1);
    parseIntegerOutput('ACTION_CHANGED_REPOSITORIES', 1);
    parseIntegerOutput('ACTION_PENDING_REPOSITORIES', 0);
    parseIntegerOutput('ACTION_UNCHANGED_REPOSITORIES', 0);
    parseIntegerOutput('ACTION_FAILED_REPOSITORIES', 0);
    parseIntegerOutput('ACTION_WARNING_REPOSITORIES', 0);

    const [result] = JSON.parse(process.env.ACTION_RESULTS || '[]');
    assert(result?.repository === repo, 'results should contain the direct file-sync repository');
    assert(result.success === true, `${repo} should be successful`);
    assert(result.hasWarnings === false, `${repo} should not have warnings`);

    const octokit = createOctokit();
    const pulls = await listOpenPullRequestsForBranch(octokit, repo, 'file-sync');
    assert(pulls.length === 1, `${repo} should have one open file-sync PR`);
    assert(pulls[0].title === 'chore: sync renovate.json', `${repo} PR should use the target filename as its title`);
    assert(
      (await getFileContent(octokit, repo, 'renovate.json', 'file-sync')) ===
        fs.readFileSync('integration-test/sources/renovate.json', 'utf8'),
      `${repo} renovate.json should match the direct source`
    );

    const [sync] = result.fileSync || [];
    assert(sync?.success === true, `${repo} file sync should be successful`);
    assert(sync?.fileSync === 'created', `${repo} file sync should create a PR`);
    assert(sync.prNumber === pulls[0].number, `${repo} result should report the created PR`);
    assert(
      result.subResults?.some(subResult => subResult.kind === 'file-sync' && subResult.status === 'changed'),
      `${repo} should include a changed file-sync sub-result`
    );
  } catch (error) {
    console.error(`Live direct file-sync assertion failed: ${error.message}`);
    process.exitCode = 1;
  }
}

await main();
