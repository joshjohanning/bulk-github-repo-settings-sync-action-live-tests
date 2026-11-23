import assert from 'node:assert/strict';

export function assertRulesetSummary(summary, repository, operations) {
  const rows = [...summary.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const matches = rows
    .map(row => [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1]))
    .filter(cells => cells[0] === repository);
  assert.equal(matches.length, 1, `${repository} should have exactly one rendered summary row`);
  assert.equal(matches[0].length, 3, `${repository} summary should include a Details cell`);
  assert.equal(
    matches[0][2],
    operations.map(operation => `rulesets: ${operation}`).join('; '),
    `${repository} rendered summary should contain every prefixed ruleset operation in order`
  );
}
