# Live Integration Tests

Live integration tests for [`joshjohanning/bulk-github-repo-settings-sync-action`](https://github.com/joshjohanning/bulk-github-repo-settings-sync-action).

These tests run against real repositories in a dedicated disposable test organization, verifying both action outputs (including `pending-repositories`) and resulting GitHub state.

> Adapted from Wuodan's live test harness ([PR #123](https://github.com/joshjohanning/bulk-github-repo-settings-sync-action/pull/123), [PR #124](https://github.com/joshjohanning/bulk-github-repo-settings-sync-action/pull/124)).

## How it works

1. **Prepare** — Creates and resets configured test repositories
2. **Run** — Runs the action against those repos (dry-run first, then for real)
3. **Assert** — Verifies the action outputs and actual GitHub state via API

The main suite checks repository projects and wiki toggles, both GitHub Actions
workflow-permission fields and SHA-pinning states, plus environment deployment
policies with both branch and tag patterns.

Label-sync scenarios cover case-insensitive matching and duplicate names, plus
the multiword inline label `live-inline multiword`. Success fixtures avoid commas
in label names, which GitHub rejects with a label-name validation error.

The suite also runs dedicated dry-run, apply, and unchanged re-run scenarios for
environments. These cover create-only inline names, `environments-file` entries
that set `wait_timer`, user `reviewers`, and `prevent_self_review` and take
precedence over matching inline names, and `delete-unmanaged-environments`. A
rules-based scenario selects the same repository with two overlapping rules and
verifies that their `rulesets-file` values are merged additively and that the
equivalent path aliases are deduplicated.

The environment reviewer fixture uses the `joshjohanning` user, who must be able
to access the test organization's repositories. Update
`integration-test/sources/environments.yml` and
`integration-test/scripts/assert-live-test-environments.js` when using another
test organization.

## Usage

Go to **Actions → Live Integration Tests → Run workflow** and provide:

| Input | Description |
|-------|-------------|
| `repository` | Action repository to test (default: `joshjohanning/bulk-github-repo-settings-sync-action`) |
| `ref` | Branch, tag, or SHA from the action repo to test (default: `main`) |
| `pr` | PR number to test (overrides `ref`) |
| `suite` | `all`, `main`, `selection`, or `failure` |
| `prepare-only` | Only prepare repos, skip running tests |

### Examples

- Test main branch: leave defaults
- Test a PR: set `pr` to `123`
- Test a specific branch: set `ref` to `refactor/normalize-result-model`
- Test your fork: set `repository` to `owner/repo`

## Setup

### Test Organization

Create a dedicated GitHub organization for tests. Every repository in it should be considered temporary.

### Authentication

Create a GitHub App with the permissions listed below, installed on the test org only.

In this repository, set:
- Variable `LIVE_TEST_CLIENT_ID` — the GitHub App client ID
- Secret `LIVE_TEST_APP_PRIVATE_KEY` — the App private key

### Required Permissions

- **Administration**: Read & write (create repos, settings, topics, rulesets, environments)
- **Contents**: Read & write (create/update/delete files)
- **Pull requests**: Read & write (PR-based file sync, repository label sync)
- **Workflows**: Read & write (sync `.github/workflows/`)
- **Custom properties** (org-level): Admin (repo selection tests)

### Repository Configuration

- Variable `LIVE_TEST_ORG` — name of the test organization

## Cleanup

Use the **Delete Live Integration Test Repositories** workflow to remove all repos from the test org. Triple-guarded with confirmation inputs.
