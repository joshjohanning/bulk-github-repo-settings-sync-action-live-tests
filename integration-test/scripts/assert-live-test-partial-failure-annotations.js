import { assert, createOctokit, getRequiredEnv, info, sleep } from './helpers.js';

const FAILURE_SUMMARY_PATTERN = /^\d+ repositor(?:y|ies) failed to update$/;

// "Re-run failed jobs" reuses already-successful jobs from earlier attempts, so search back
// from the current attempt for the most recent execution of the job.
async function findJob(octokit, owner, repo, runId, currentAttempt, jobName) {
  for (let attempt = currentAttempt; attempt >= 1; attempt--) {
    const jobs = await octokit.paginate(octokit.rest.actions.listJobsForWorkflowRunAttempt, {
      owner,
      repo,
      run_id: runId,
      attempt_number: attempt,
      per_page: 100
    });
    const matches = jobs.filter(job => job.name === jobName);
    assert(matches.length <= 1, `Expected at most one ${jobName} job in run ${runId} attempt ${attempt}`);
    if (matches.length === 1) {
      return matches[0];
    }
  }
  throw new Error(`No ${jobName} job found in run ${runId} attempts 1-${currentAttempt}`);
}

async function listFailureSummaryAnnotations(octokit, owner, repo, checkRunId) {
  const annotations = await octokit.paginate(octokit.rest.checks.listAnnotations, {
    owner,
    repo,
    check_run_id: checkRunId,
    per_page: 100
  });
  return annotations
    .filter(annotation => annotation.annotation_level === 'failure')
    .map(annotation => annotation.message.trim())
    .filter(message => FAILURE_SUMMARY_PATTERN.test(message))
    .sort();
}

async function main() {
  try {
    const octokit = createOctokit();
    const [owner, repo] = getRequiredEnv('GITHUB_REPOSITORY').split('/');
    const runId = Number(getRequiredEnv('GITHUB_RUN_ID'));
    const attempt = Number(getRequiredEnv('GITHUB_RUN_ATTEMPT'));
    const jobName = getRequiredEnv('FAILURE_JOB_NAME');
    const expected = getRequiredEnv('EXPECTED_FAILURE_ANNOTATIONS')
      .split('\n')
      .map(message => message.trim())
      .filter(Boolean)
      .sort();

    const job = await findJob(octokit, owner, repo, runId, attempt, jobName);
    assert(job.status === 'completed', `${jobName} job should be completed, got: ${job.status}`);
    assert(job.conclusion === 'success', `${jobName} job should conclude successfully, got: ${job.conclusion}`);

    // Annotations can lag briefly behind job completion.
    let actual = [];
    const checkRunId = Number(job.check_run_url.split('/').pop());
    for (let poll = 1; poll <= 6; poll++) {
      actual = await listFailureSummaryAnnotations(octokit, owner, repo, checkRunId);
      if (JSON.stringify(actual) === JSON.stringify(expected)) {
        break;
      }
      await sleep(5000);
    }

    assert(
      JSON.stringify(actual) === JSON.stringify(expected),
      `${jobName} core.setFailed annotations should be ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`
    );

    info(`Live partial-failure annotation assertions passed: ${expected.join('; ')}`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

await main();
