# Live Integration Tests

Live integration tests for [`joshjohanning/bulk-github-repo-settings-sync-action`](https://github.com/joshjohanning/bulk-github-repo-settings-sync-action).

These tests run against real repositories in a dedicated disposable test organization, verifying both action outputs and resulting GitHub state.

> Adapted from Wuodan's live test harness ([PR #123](https://github.com/joshjohanning/bulk-github-repo-settings-sync-action/pull/123), [PR #124](https://github.com/joshjohanning/bulk-github-repo-settings-sync-action/pull/124)).

## How it works

1. **Prepare** — Creates/resets ~30 repos in the test org to known baseline states
2. **Run** — Runs the action against those repos (dry-run first, then for real)
3. **Assert** — Verifies the action outputs and actual GitHub state via API

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
- Variable `APP_CLIENT_ID` — the GitHub App client ID
- Secret `APP_PRIVATE_KEY` — the App private key

### Required Permissions

- **Administration**: Read & write (create repos, settings, topics)
- **Contents**: Read & write (create/update/delete files)
- **Pull requests**: Read & write (PR-based file sync)
- **Workflows**: Read & write (sync `.github/workflows/`)
- **Custom properties** (org-level): Admin (repo selection tests)

### Repository Configuration

- Variable `LIVE_TEST_ORG` — name of the test organization

## Cleanup

Use the **Delete Live Integration Test Repositories** workflow to remove all repos from the test org. Triple-guarded with confirmation inputs.
