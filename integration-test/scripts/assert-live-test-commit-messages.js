import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import { assert, createOctokit, getIntegrationRepositoriesFile, getRepository, info, readIntegrationConfig } from './helpers.js';

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

function getRepoKey(repoFullName) {
  return repoFullName.split('/')[1];
}

function readAssertionsConfig() {
  const configPath = path.resolve(getIntegrationRepositoriesFile());
  const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
  const assertions = config?.assertions;
  assert(assertions && typeof assertions === 'object', `Missing assertions in ${configPath}`);
  return {
    path: configPath,
    assertions
  };
}

function normalizeChanges(changes = []) {
  return Object.fromEntries(
    changes.map(change => [
      change.setting,
      {
        from: change.from,
        to: change.to
      }
    ])
  );
}

function normalizeSubResults(subResults = []) {
  return subResults.map(subResult => ({
    kind: subResult.kind,
    status: subResult.status
  }));
}

function normalizeResult(result) {
  return {
    success: result.success,
    hasWarnings: result.hasWarnings,
    changes: normalizeChanges(result.changes),
    subResults: normalizeSubResults(result.subResults)
  };
}

function normalizeRepository(repository) {
  return {
    allow_squash_merge: repository.allow_squash_merge,
    allow_merge_commit: repository.allow_merge_commit,
    squash_merge_commit_title: repository.squash_merge_commit_title,
    squash_merge_commit_message: repository.squash_merge_commit_message,
    merge_commit_title: repository.merge_commit_title,
    merge_commit_message: repository.merge_commit_message
  };
}

async function collectActual(octokit, repos) {
  const results = parseResultsOutput();
  const resultsByRepo = new Map(results.map(result => [result.repository, result]));
  const actualRepos = {};

  for (const repoConfig of repos) {
    const repoFullName = repoConfig.repo;
    const repoKey = getRepoKey(repoFullName);
    const result = resultsByRepo.get(repoFullName);
    assert(result, `Missing result entry for ${repoFullName}`);
    const repository = await getRepository(octokit, repoFullName);

    actualRepos[repoKey] = {
      repository: normalizeRepository(repository),
      result: normalizeResult(result)
    };
  }

  return {
    repositoryCount: repos.length,
    resultCount: results.length,
    counts: {
      'updated-repositories': parseIntegerOutput('ACTION_UPDATED_REPOSITORIES'),
      'changed-repositories': parseIntegerOutput('ACTION_CHANGED_REPOSITORIES'),
      'unchanged-repositories': parseIntegerOutput('ACTION_UNCHANGED_REPOSITORIES'),
      'failed-repositories': parseIntegerOutput('ACTION_FAILED_REPOSITORIES'),
      'warning-repositories': parseIntegerOutput('ACTION_WARNING_REPOSITORIES')
    },
    repos: actualRepos
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectSubsetMismatches(expected, actual, path, mismatches) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      mismatches.push({
        path,
        message: `${path} should be an array`,
        expected,
        actual
      });
      return;
    }

    expected.forEach((expectedItem, index) => {
      const matchedActualIndex = actual.findIndex(actualItem => {
        const nestedMismatches = [];
        collectSubsetMismatches(expectedItem, actualItem, `${path}[${index}]`, nestedMismatches);
        return nestedMismatches.length === 0;
      });

      if (matchedActualIndex === -1) {
        mismatches.push({
          path: `${path}[${index}]`,
          message: `${path}[${index}] was not found in actual array`,
          expected: expectedItem,
          actual: null
        });
      }
    });
    return;
  }

  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) {
      mismatches.push({
        path,
        message: `${path} should be an object`,
        expected,
        actual
      });
      return;
    }

    for (const [key, expectedValue] of Object.entries(expected)) {
      if (!(key in actual)) {
        mismatches.push({
          path: `${path}.${key}`,
          message: `${path}.${key} is missing`,
          expected: expectedValue,
          actual: undefined
        });
        continue;
      }
      collectSubsetMismatches(expectedValue, actual[key], `${path}.${key}`, mismatches);
    }
    return;
  }

  if (actual !== expected) {
    mismatches.push({
      path,
      message: `${path} expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`,
      expected,
      actual
    });
  }
}

function renderUnifiedDiff(mismatches) {
  const lines = ['--- expected', '+++ actual'];

  for (const mismatch of mismatches) {
    lines.push(`- ${mismatch.path}: ${JSON.stringify(mismatch.expected)}`);
    lines.push(`+ ${mismatch.path}: ${JSON.stringify(mismatch.actual)}`);
  }

  return lines.join('\n');
}

function failWithDiff(assertionsPath, expected, actual, mismatches) {
  const renderedMismatches = mismatches.map(mismatch => `- ${mismatch.message}`).join('\n');
  throw new Error(
    [
      `Commit message assertions failed for ${assertionsPath}:`,
      renderedMismatches,
      '',
      'Subset diff:',
      renderUnifiedDiff(mismatches),
      '',
      'Expected subset:',
      JSON.stringify(expected, null, 2),
      '',
      'Actual normalized state:',
      JSON.stringify(actual, null, 2)
    ].join('\n')
  );
}

async function main() {
  try {
    const octokit = createOctokit();
    const { repos } = readIntegrationConfig();
    const { path: assertionsPath, assertions: expected } = readAssertionsConfig();
    const actual = await collectActual(octokit, repos);

    assert(
      repos.length === Object.keys(expected.repos || {}).length,
      `${assertionsPath} repo and assertion counts should match`
    );

    const mismatches = [];
    collectSubsetMismatches(expected, actual, 'assertions', mismatches);

    if (mismatches.length > 0) {
      failWithDiff(assertionsPath, expected, actual, mismatches);
    }

    info(`Commit message assertions passed for ${assertionsPath}.`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

await main();
