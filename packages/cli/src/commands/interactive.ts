/**
 * chronicle init (default command)
 *
 * Prints a welcome + NEXT_STEPS that guide the user's Claude Code
 * through onboarding conversationally.
 */

import { printNextSteps } from '../output.js';

export async function interactiveInit(): Promise<void> {
  console.log(`
┌──────────────────────────────────────────────────────┐
│  Chronicle                                            │
│  Describe any world. Watch AI play it out.            │
└──────────────────────────────────────────────────────┘

Chronicle runs AI-agent social simulations configured entirely in
natural language. You describe a scenario; we compile it into a live,
persistent world with characters, rules, and unfolding drama.

To create your first world, describe what you want to simulate.
Examples:
  • "8 survivors on a desert island, one is a murderer"
  • "5 founders, 180-day runway, disagreements on the product direction"
  • "A dinner party where each guest has a secret"
  • "Make me something weird"
`);

  printNextSteps([
    `ask_user "What scenario would you like to simulate? (one sentence is enough)"`,
    `then_call "chronicle create-world --desc '<user's answer>'"`,
    `mention "User can also pick a preset: chronicle create-world --desc 'Use the Dinner Party preset'"`,
  ]);
}
