# Release policy

- Accumulate small fixes under `Unreleased` in `CHANGELOG.md`.
- Keep `package.json` at the last published version while fixes accumulate. A commit or push does not constitute a release.
- Bump the patch version, create versioned release notes and tag a release only when the user explicitly requests a version release. Batch pending fixes into that release.
- Do not push local review/fix work unless the user requests a push. Do not rewrite published history or remove remote tags/releases without explicit authorization.
- Before a requested release, run the appropriate unit and browser checks, verify the release scope, and wait for cross-platform CI before reporting publication as complete.
