/**
 * Shared CLI output helpers.
 *
 * The NEXT_STEPS block format is READ by Claude Code (or any AI agent)
 * to guide the user through multi-step workflows.
 */

export function printNextSteps(steps: string[]): void {
  console.log('');
  console.log('NEXT_STEPS');
  for (const step of steps) {
    console.log(`- ${step}`);
  }
  console.log('END_NEXT_STEPS');
}

export function printError(message: string, nextSteps: string[] = []): void {
  console.error(`\nERROR: ${message}`);
  if (nextSteps.length > 0) {
    printNextSteps(nextSteps);
  }
}

export function printData(label: string, data: unknown): void {
  console.log('');
  console.log(`[DATA:${label}]`);
  console.log(JSON.stringify(data, null, 2));
  console.log('[/DATA]');
}
