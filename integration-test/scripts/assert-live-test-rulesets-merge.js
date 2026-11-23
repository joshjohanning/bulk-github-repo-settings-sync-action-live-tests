import { assert, createOctokit, getRequiredEnv, getRulesetByName, info, listRulesets } from './helpers.js';

const BASELINE_RULESET = 'Integration Merge Baseline';
const SPECIFIC_RULESET = 'Integration Merge Specific';

function assertCount(name, expected) {
  const actual = Number.parseInt(process.env[name], 10);
  assert(actual === expected, `${name} should equal ${expected}, got: ${process.env[name]}`);
}

async function main() {
  try {
    const repo = getRequiredEnv('INTEGRATION_REPOSITORY');
    const scenarioName = getRequiredEnv('RULESETS_MERGE_SCENARIO');
    assert(['apply', 'unchanged'].includes(scenarioName), `Unknown RULESETS_MERGE_SCENARIO: ${scenarioName}`);
    const apply = scenarioName === 'apply';

    assertCount('ACTION_UPDATED_REPOSITORIES', 1);
    assertCount('ACTION_CHANGED_REPOSITORIES', apply ? 1 : 0);
    assertCount('ACTION_PENDING_REPOSITORIES', 0);
    assertCount('ACTION_UNCHANGED_REPOSITORIES', apply ? 0 : 1);
    assertCount('ACTION_FAILED_REPOSITORIES', 0);
    assertCount('ACTION_WARNING_REPOSITORIES', 0);

    const results = JSON.parse(process.env.ACTION_RESULTS || '[]');
    assert(results.length === 1, 'overlapping rules should produce exactly one repository result');
    const [result] = results;
    assert(result.repository === repo, `results should contain ${repo}`);
    assert(result.success === true, `${repo} result should be successful`);
    assert(result.hasWarnings === false, `${repo} should not have warnings`);

    // A duplicate path that was not deduplicated would fail with a duplicate
    // ruleset-name error, and a non-additive merge would drop the baseline file.
    const sync = result.rulesetSync;
    assert(sync?.success === true, `${repo} ruleset sync should be successful`);
    const rulesetSubResults = (result.subResults || []).filter(subResult => subResult.kind.startsWith('ruleset-'));
    if (apply) {
      assert(sync.ruleset === 'created', `${repo} ruleset sync should report created, got ${sync.ruleset}`);
      assert(
        JSON.stringify(rulesetSubResults.map(subResult => [subResult.kind, subResult.status, subResult.rulesetName])) ===
          JSON.stringify([
            ['ruleset-create', 'changed', BASELINE_RULESET],
            ['ruleset-create', 'changed', SPECIFIC_RULESET]
          ]),
        `${repo} should create both merged rulesets once in configured order, got ${JSON.stringify(rulesetSubResults)}`
      );
    } else {
      assert(sync.ruleset === 'unchanged', `${repo} ruleset sync should report unchanged, got ${sync.ruleset}`);
      assert(
        sync.message === 'All 2 ruleset(s) are already up to date',
        `${repo} should compare both merged rulesets, got: ${sync.message}`
      );
      assert(rulesetSubResults.length === 0, `${repo} should not report ruleset sub-results`);
    }

    const octokit = createOctokit();
    const rulesets = await listRulesets(octokit, repo);
    for (const name of [BASELINE_RULESET, SPECIFIC_RULESET]) {
      assert(
        rulesets.filter(ruleset => ruleset.name === name).length === 1,
        `${repo} should have exactly one "${name}" ruleset`
      );
    }

    const baseline = await getRulesetByName(octokit, repo, BASELINE_RULESET);
    assert(
      baseline.rules?.some(rule => rule.type === 'deletion'),
      `${repo} baseline ruleset should include the deletion rule`
    );
    const specific = await getRulesetByName(octokit, repo, SPECIFIC_RULESET);
    assert(
      specific.rules?.some(rule => rule.type === 'non_fast_forward') &&
        specific.conditions?.ref_name?.include?.includes('refs/heads/release/*'),
      `${repo} specific ruleset should target release branches with the non_fast_forward rule`
    );

    info(`Live ruleset-file merge ${scenarioName} assertions passed`);
  } catch (error) {
    console.error(`Live ruleset-file merge assertion failed: ${error.message}`);
    process.exit(1);
  }
}

await main();
