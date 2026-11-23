const fs = require('node:fs');

const source = process.env.GITHUB_STEP_SUMMARY;
const destination = process.env.ACTION_SUMMARY_CAPTURE_PATH;
if (!source || !destination) {
  throw new Error('Summary capture requires GITHUB_STEP_SUMMARY and ACTION_SUMMARY_CAPTURE_PATH');
}

// The runner removes the per-step file after the action exits. Copy it first,
// without redirecting the toolkit's writes or changing the runner's upload.
process.on('exit', () => {
  fs.copyFileSync(source, destination);
});
