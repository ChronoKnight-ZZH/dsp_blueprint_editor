# AGENTS.md

Dyson Sphere Program (DSP) blueprint editor/parser. Vue 3 + Three.js, TypeScript, Vue CLI 5 (webpack 5). One `src/` tree builds **two** deliverables: the SPA (`src/main.ts` → `App.vue` → `dist/`) and a headless embeddable library (`src/lib/index.ts` → `BlueprintViewer` → `dist-lib/`).

## Commands (run from repo root)

- `yarn install` — use yarn 1.x (`yarn.lock` is what CI uses; `package-lock.json` also exists). `postinstall` runs `patch-package`, but there is no `patches/`, so it is a no-op.
- `yarn serve` — dev server; open `http://localhost:8080/dsp_blueprint_editor/` (`PUBLIC_PATH` prefix is required).
- `yarn build` — SPA to `dist/`. It first runs `scripts/generate-update-log.js`, which reads the newest version section of `CHANGELOG.md` and rewrites the tracked `public/update-log.json`. A malformed CHANGELOG aborts the build. Type errors fail the build; there is no separate typecheck script and no `vue-tsc`.
- `yarn build:lib` — library to `dist-lib/` (UMD + ESM, both with three inlined). Requires `public/basis/` (KTX2 transcoder).
- `yarn jest` — one-shot full test run. **Do not use `yarn test:unit` for a one-shot: it is `jest --watchAll` and never exits.** Single spec: `yarn jest tests/unit/blueprint/stats.spec.ts`.
- `yarn test:preview` — one-shot run of `tests/unit/preview`.
- `yarn lint` — ESLint; **auto-fixes by default**. Add `--no-fix` to only report.
- `yarn cli blueprint.txt -o out.json` — blueprint string → JSON (ts-node + `tsconfig-paths`, needed for `@/` aliases). Reads stdin when no file argument.
- `yarn release` is currently broken: its `standard-version` config exists, but the package is not installed.

## Test gotchas

- `tests/unit/preview/fixture.spec.ts` needs the gitignored `scripts/lib-build/preview-fixture.json`. When absent it **fails at module load instead of skipping**; generate it with `node scripts/preview/build-fixture.mjs` (which needs the gitignored `data/preview-delta-*.json`).
- `tests/unit/preview/replay.spec.ts` is skipped unless `PREVIEW_REPLAY=1` (PowerShell: `$env:PREVIEW_REPLAY=1; yarn jest tests/unit/preview/replay.spec.ts`).
- Baseline as of 2026-11-27 on branch `models_editing_mode`: the full suite is green (517 tests, `preview/replay.spec.ts` skipped without the env flag). The old 2026-11-25 note about `preview/projector.spec.ts` and `lib/buildBuildings.spec.ts` is fixed — a failure there now means your change broke it; still verify with `git stash` when unsure.
- `tests/tools/*.txt` are game-exported samples used by `blueprint/beltPorts.spec.ts` and `blueprint/stationPort.spec.ts`. They are not fixtures for the parser itself; keep the ones the specs read, or the specs fail at module load (ENOENT).

## Architecture notes

- Editor 3D scene is assembled in `src/components/BlueprintEditor.vue`; the library's scene is assembled in `src/lib/core/RenderCore.ts`. Shared rendering changes must work for both paths.
- Shared kernel: `src/blueprint/` (parser + commands; `reform.ts` is the one Three.js-backed file), `src/data/`, `src/models/`, `src/lib/core/`, plus the scene folders `src/planet/`, `src/icon/`, `src/Animation/`, `src/render/`. The undo/redo queue lives in `src/render/command.ts` (not at `src/command.ts` anymore; older docs still say that).
- `src/lib/**` must stay Vue-free and SPA-free (no `App.vue`, `components/`, `i18n.ts`, `main.ts`) so `yarn build:lib` keeps working.
- `src/blueprint/parser.ts` must keep **byte-level round-trip** for v1/v2 blueprints, including unknown fields (`v2ExtraPose`, `content`, `extraBytes`, `tailExtraBytes`). Tests decompress and compare bodies byte-for-byte; never drop bytes you don't understand.
- Model/data tables are test-pinned: every `src/assets/icons/models/*.glb` needs a `modelMaterialTuning` entry, and `modelTransform`/`buildingMeta` keys must stay in sync. Adding/removing a `.glb` means updating those tables and possibly the structural specs.
- Build-time globals (`VERSION`, `__DSP_TRANSCODER_BASE__`, `__DSP_MODEL_BYTES__`, `__DSP_MODEL_CACHE_ENABLED__`, `__DSP_LIB_ASSET_INVENTORY__`, `__DSP_LIB_MODULE_URL__`) are injected by `vue.config.js`, `scripts/lib-build/build.js`, and `jest.config.js`. Code reading them only works under those builds or Jest.
- `@lib/asset-resolver` has three implementations: webpack (`assetResolver.webpack.ts`, editor), runtime (`assetResolver.ts`, lib), and runtime again in Jest. Any asset-path change must work in all three; `scripts/lib-build/assetInventory.js` drives the lib/Jest inventory.
- `PUBLIC_PATH` in `vue.config.js` is hardcoded (`/dsp_blueprint_editor/`) and drives the deploy path, dev URL, and KTX2 transcoder URL.
- Both library bundles inline three; `scripts/lib-build/build.js` is authoritative. The comment in `src/lib/index.ts` claiming ESM externalizes three is wrong.
- `config/persistence.config.js` is the only switch for model-cache persistence (`web`/`lib`); changes require rebuilding that target.

## Generated files — do not hand-edit

- `dist/`, `dist-lib/`, `cli/`, `public/update-log.json` — rebuild instead.
- `src/data/{itemsData,recipesData,midi,techIconsData,signalIconsData,color}.ts` and the name tables in `src/locales/{zh,en}.json` are generated from game protoset exports (`src/data/gen*.py`, `i18n.py`). The generator inputs are not in the repo, so they cannot be regenerated here.
- `src/models/textureManifest.ts` is generated and intentionally empty: GLB textures are embedded KTX2. Don't reintroduce external PNG channel maps (it adds ~200 MB to `dist-lib`).

## Docs and conventions

- `docs/CODE_WIKI.md` is the detailed reference (binary format, build wiring, runtime flow), but it predates the `src/` folder refactor — verify paths against code. `docs/wiki/*` and `README.md` are older still and describe removed features (photo→blueprint, per-cell reform editing, placement/deletion modes).
- `.codex/skills/dsp_blueprint_editor/SKILL.md` has the longer layering/naming/comment rules; treat it as intent only — it still assumes `src/command.ts` and proposes non-existent `src/composables/` and `src/types/`.
- Comments in this repo are Chinese and explain responsibility, call sites, and boundaries (why), not what the code does. Follow the surrounding style; don't add English-only boilerplate.
- Filename casing is not enforced (camelCase is most common, class-per-file uses PascalCase); match the folder you are editing. Vue components are `PascalCase.vue`.
- UI strings live in `src/locales/zh.json` + `en.json` (keep both key sets in sync) and in SFC `<i18n>` blocks; `yarn i18n:report` reports gaps.
- Commits follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:` …). Only CI is `.github/workflows/gh-pages.yml`: push to `master` → Node 20 → `yarn install && yarn build` → deploy `dist/` to GitHub Pages. CI runs no tests or lint.
