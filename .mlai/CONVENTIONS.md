# Conventions

## Guards (added after a mistake repeated)
- Before calling UI work done, render it in the browser at 390px and 1280px and check overflow, clipped text, overlap and contrast.

## Art and assets
- Never modify, rename, delete or regenerate files in `assets/` or `warbound-sprite.svg`.
- All art is referenced by `AssetId` keys declared in `assets/manifest.json`; no hardcoded image paths.

## Engine purity
- `src/engine/` stays pure TypeScript: no DOM, `window`, CSS or browser globals.
- Content numbers live in `src/data/*.json`; engine files hold formulas only.

## Verification guard
- Report a test, build or fix as passing only after running it in the same session and quoting the exact command output. Otherwise prefix the claim with `Not verified:`.

## Handover
- Every task ends with the 6-section handover rundown defined in `docs/ACTIVE_INSTRUCTIONS.md`.

## Git
- After the Phase 2 checkpoint push (2026-11-25), never run `git commit` or `git push` without explicit user approval for that exact action.
