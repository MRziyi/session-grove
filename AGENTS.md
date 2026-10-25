# Release policy

- Accumulate small fixes under `Unreleased` in `CHANGELOG.md`.
- Keep `package.json` at the last published version while fixes accumulate. A commit or push does not constitute a release.
- Bump the patch version, create versioned release notes and tag a release only when the user explicitly requests a version release. Batch pending fixes into that release.
- Do not push local review/fix work unless the user requests a push. Do not rewrite published history or remove remote tags/releases without explicit authorization.
- Before a requested release, run the appropriate unit and browser checks, verify the release scope, and wait for cross-platform CI before reporting publication as complete.

# UI and documentation

- Keep the two product READMEs focused on purpose, features and getting started. Put workflow explanations in the application's Information guide and maintenance details in the relevant guide under `docs/`.
- Do not add permanent explanatory notes to ordinary screens. Show controls, selections, progress and actionable state; use Information for general explanations.
- Use `docs/README.md` as the documentation index. Update an existing guide instead of adding version-specific handoffs, duplicate design stubs or new validation diaries. Keep private test evidence outside Git.
- Preserve release notes and attribution. Link historical validation evidence to its original release tag rather than presenting it as current behavior.
