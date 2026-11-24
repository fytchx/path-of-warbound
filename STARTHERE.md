# STARTHERE — MANDATORY AI DEVELOPMENT & SAFETY PROTOCOL

> **STOP AND READ THIS ENTIRE FILE BEFORE READING CODE, MODIFYING FILES, OR EXECUTING COMMANDS.**
> Every AI assistant (GitHub Copilot, Claude, Google AI Studio, CLI agents) operating in this repository MUST obey these rules without exception.

---

## 1. CRITICAL GIT & REPOSITORY SAFETY RULES (HARD STOPS)

1. **NEVER COMMIT OR PUSH WITHOUT EXPLICIT PERMISSION:**
   - You are strictly forbidden from running `git commit`, `git push`, `git merge`, `git rebase`, `git reset --hard`, or `git push --force` automatically.
   - Before any commit or push, you **MUST** stop, present a clear bulleted summary of every changed/created file and what it does, and ask the repository owner for explicit confirmation.
2. **NO DESTRUCTIVE FILE OPERATIONS:**
   - Never delete existing engine modules, JSON data files, or documentation without explicit user approval.
3. **SMALL, ATOMIC CHANGES ONLY:**
   - Complete one scoped task at a time. Do not rewrite unrelated files or refactor working systems unless specifically instructed in `docs/ACTIVE_INSTRUCTIONS.md`.

---

## 2. ACTIVE DEVELOPMENT ROUTER (EDIT THIS SECTION AS VERSIONS CHANGE)

> **Maintainer Note:** Update the fields below whenever advancing phases or versions. AI assistants must treat this block as the single source of truth for what to build right now.

* **ACTIVE VERSION:** `v0.1 — Core Playable Slice`
* **CURRENT PHASE:** `v0.1 Tier 1 → Tier 2 Onboarding Loop, Combat Feel & Repo Cleanup`
* **PRIMARY INSTRUCTION FILE:** `docs/ACTIVE_INSTRUCTIONS.md`
* **REFERENCE SPECS:** `docs/GAME_DESIGN_BIBLE.md` | `docs/DATA_SCHEMAS.md`

### Phase Checklist
- [x] **Phase 1:** Pure headless stat aggregator (`Base -> Flat -> Increased -> More -> 2-Pass DAG Convert`), radial skill tree BFS/Tarjan engine, utility-scored combat tick loop, and CLI balance simulator.
- [x] **Phase 2:** JSON data registries (`gems`, `items`, `affixes`, `skill_tree`, `zones`, `doctrines`, `progression`) + build-time schema validator.
- [x] **Phase 3:** Mobile-portrait UI (`390px` target width) — Combat Arena screen, `Weapon + Offhand + 3x3` Equipment Altar, translucent Stats/Item popups, and Radial Constellation Skill Tree canvas.
- [x] **Phase 4:** Local save serialization, offline progress calculator, Tier 1 → Tier 2 progressive onboarding loop, combat game-feel polish, and `v0.1` verification.

---

## 3. ARCHITECTURAL GUARDRAILS (ANTI-BLOAT & ANTI-RESTART)

To prevent the architectural sprawl that stalled previous prototypes, enforce these 5 rules on every line of code:

1. **Strict Headless Separation (`src/engine/`):**
   - Everything inside `src/engine/` must be **100% pure, deterministic TypeScript** with **zero** DOM, React, HTML, or CSS dependencies.
   - The combat engine and stat pipeline must run identically inside a Node/CLI headless test runner and inside the mobile web UI.
2. **Data-Driven Everything (`src/data/`):**
   - Never hardcode skill damage, gem scaling, item affixes, zone stats, or tree nodes inside `src/engine/` or `src/ui/`.
   - All game content lives in validated JSON files governed by `docs/DATA_SCHEMAS.md`.
3. **Enforce the One-Way Math Pipeline:**
   - All stats must compute from scratch as pure functions following:
     `Base -> Flat -> Increased (additive) -> More (multiplicative) -> Pass 1 Attribute/Defense Conversions -> Pass 2 Forward-Only School Conversions (Physical -> Fire -> Frost -> Lightning -> Void)`.
   - Never introduce circular stat dependencies or mutating state shortcuts.
4. **Mobile-Portrait First (`390px` Width):**
   - All UI work targets a `390px` vertical mobile viewport first. Do not spend effort on desktop multi-column layouts.
   - Minimum interactive tap target is `44px × 44px`. Detailed stats and item cards render in dismissible translucent overlays (`tap outside to close`).
5. **Strict Scope Firewall (Park Future Features):**
   - Do **NOT** scaffold or implement `v0.2+` features during `v0.1` unless `ACTIVE VERSION` above is updated.
   - **Explicitly Parked for Future Versions:** Online leaderboards, backend auth/databases, War-Orders (Maps), Endless Survival Mode, PvP Arena, and Group Content.

---

## 4. MANDATORY AI WORKFLOW ON EVERY SESSION

Whenever you begin a task in this repository, follow this exact sequence:

1. **Read Context:** Read `STARTHERE.md` and the current `docs/ACTIVE_INSTRUCTIONS.md`.
2. **Verify Scope:** Confirm that the requested task matches the `ACTIVE VERSION` and `CURRENT PHASE` listed in Section 2. If a prompt asks for something out-of-scope or ambiguous, flag it briefly before writing code.
3. **Plan Briefly:** State which files you will create or touch before modifying code.
4. **Build & Validate:** Write clean, modular, strictly typed code and run unit/schema tests to verify zero regressions.
5. **Stop Before Git:** Summarize your changes clearly and **wait for explicit user approval** before running any `git commit` or `git push`.
