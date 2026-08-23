// Environment variables, read loudly.
//
// A deployed Lambda receives only the variables its own Terraform block
// declares. Locally every handler shares one process and therefore sees every
// variable that local/env.ts set. That asymmetry is the single most productive
// source of "works on my machine, broken in production" in this architecture,
// because the local run cannot distinguish a variable that was wired from one
// that merely happened to be lying around.
//
// So: no defaults here. A variable that is required for correctness throws at
// module load, which means a missing Terraform wire fails the very first
// request with the name of the variable in the message, rather than silently
// changing behaviour. `if (!VAR) return;` is the shape to avoid - it turns a
// forgotten wire into a feature that quietly does nothing.

// Every name any module actually asked for. Recorded rather than declared,
// because a handler "uses" a variable if anything it imports reads one - a
// shared helper, a notification module - and reading that off the import graph
// by hand is exactly the step people skip. src/routes.parity.test.ts imports
// each handler in isolation and compares this against what routes.ts promised.
const seen = new Set<string>();

export function requireEnv(name: string): string {
  seen.add(name);

  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is unset. Every variable a handler reads must be declared in ` +
        `backend/src/routes.ts (the env list for its route) so that ` +
        `modules/booking/lambda.tf passes it to the deployed function.`,
    );
  }

  return value;
}

/** Names requested through requireEnv since this module was loaded. */
export function readEnvNames(): string[] {
  return [...seen].sort();
}
