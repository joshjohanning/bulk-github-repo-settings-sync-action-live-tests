import { assert } from './helpers.js';

function assertCount(name, expected) {
  const actual = Number.parseInt(process.env[name], 10);
  assert(actual === expected, `${name} should equal ${expected}, got: ${process.env[name]}`);
}

try {
  const repo = process.env.INTEGRATION_REPOSITORY;
  assert(repo, 'Missing INTEGRATION_REPOSITORY');
  assertCount('ACTION_UPDATED_REPOSITORIES', 1);
  assertCount('ACTION_CHANGED_REPOSITORIES', 0);
  assertCount('ACTION_PENDING_REPOSITORIES', 0);
  assertCount('ACTION_UNCHANGED_REPOSITORIES', 1);
  assertCount('ACTION_FAILED_REPOSITORIES', 0);
  assertCount('ACTION_WARNING_REPOSITORIES', 0);

  const [result] = JSON.parse(process.env.ACTION_RESULTS || '[]');
  assert(result?.repository === repo, 'results should contain the ruleset repository');
  assert(result.success === true, `${repo} should be successful`);
  assert(result.hasWarnings === false, `${repo} should not have warnings`);
  assert(result.rulesetSync?.ruleset === 'unchanged', `${repo} ruleset should be unchanged`);
  assert(
    !result.subResults?.some(subResult => subResult.kind === 'ruleset-update'),
    `${repo} should not include a ruleset-update sub-result`
  );
} catch (error) {
  console.error(`Live unchanged-ruleset assertion failed: ${error.message}`);
  process.exitCode = 1;
}
