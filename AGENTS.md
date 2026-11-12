# Milonga Studio development guidance

These instructions apply throughout this repository.

## Explain the code and the reasoning

- Explain changes in enough detail that the repository owner can understand
  exactly what the code does, what changed, and why the change is needed.
- Describe the affected behavior and how the implementation produces it. For
  behavior changes, include a concrete before-and-after example when helpful.
- Document non-obvious algorithms, data transformations, assumptions, units,
  coordinate conventions, and dance-model decisions close to the relevant code.
  Explain both the mechanism and the reason for choosing it.
- Use the existing codebase as a rough guide to the level of explanation. In
  particular, the dance model and simulation modules include detailed comments
  about their behavior and modeling assumptions. Keep those comments accurate
  when changing the implementation.
- State uncertainties and limitations explicitly. Distinguish confirmed dance
  rules from provisional modeling choices, and explain material tradeoffs.
- Keep explanations concrete and relevant; comments should add understanding
  beyond restating individual statements in the code.

## Naming and formatting

- Follow the project's ESLint configuration in `config/eslint.config.mjs` and
  Prettier configuration in `config/.prettierrc`.
- Use `npm run lint` and `npm run format:check` to check those conventions.
- Follow nearby code for naming, file organization, and conventions that the
  tools do not enforce. Prefer descriptive names consistent with the existing
  domain types and terminology.

## Pull requests and handoff

- Use the GitHub connector connection named `stamps9k-agent` for repository
  writes and pull requests. Verify the authenticated account; do not use the
  owner's main `stamps9k` account.
- Work on a task branch and open a pull request for the owner's review. Leave
  merging and repository ruleset configuration to the owner unless requested.
- Write the PR title and description around the final change. Explain the
  problem, the resulting behavior, the implementation, and why that approach
  was chosen. Identify affected files or modules when that helps review.
- Ensure the git commit messages also clearly document the problem, the change
  and why the approach was taken. This should be done in a similar manner to the
  PR guidelines.
- Describe validation performed and its results, including relevant tests and
  any remaining risks or limitations. Do not claim checks passed unless verified.
- Run the existing test suite with `npm test` for code changes, along with
  applicable lint, formatting, and build checks. Add or update meaningful tests
  when behavior changes warrant them. Documentation-only changes need formatting
  validation; do not add tests that only mirror documentation or implementation.
- Confirm the PR's required GitHub Actions checks pass before handing it over
  as ready for review. If a check fails or cannot run, report the specific
  blocker and keep the PR marked as not ready.
