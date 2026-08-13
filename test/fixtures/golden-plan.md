# Widget Service: consolidate the CLI into the shared worker image (k8s queue/blob flow)

## TL;DR

> **Quick Summary**: `widget-service` (renamed from legacy-worker) becomes the ONE repo that builds THREE images from ONE binary via the release tool and — via a **coordinated parallel release** — ships the CLI + worker images, the deploy chart, and the disk-cache snapshots **in LOCKSTEP off a SINGLE git tag** `vX.Y.Z`. "Consolidation" here means *coordinated parallel release*, **NOT a physical monorepo of the services**. The CLI subcommand + runtime-free CLI image are already SHIPPED (T1–T8). This back-half BUILDS the NET-NEW worker image here (`Dockerfile.worker`, consuming the shared runtime via `FROM acme/base-runtime:2024-stable`), the lockstep single-tag release machinery, the deploy chart move + publish workflow, dual-image×dual-region disk snapshots, and infra tests — so everything is READY TO RECEIVE the future scheduler-decoupling work. **`acme/scheduler` stays UNTOUCHED by us; the shared runtime is NOT going away.**
>
> **Scope boundary (READ FIRST)**: The scheduler-decoupling itself (removing worker execution from `acme/scheduler` so it becomes **cron-only** scheduling with NO worker execution inside it) is a **SEPARATE, OUT-OF-SCOPE task, GATED on the migration of all jobs to the new platform**. This plan only builds the worker image + lockstep machinery HERE. We do NOT edit `acme/scheduler`, and we do NOT rebuild the shared runtime (we CONSUME it via `FROM`).
>
> **Deliverables**:
> - [SHIPPED T1–T8] `widget-service` (renamed): `cmd/cli.go` + `internal/cli/` + `Executor` interface (worker byte-identical); `Dockerfile.cli` (`node:22-slim` + npm/pnpm/yarn + **the CLI tool**, **NO runtime**) as release image #2.
> - **[NEW] `Dockerfile.worker` HERE** → `acme/worker:{{.Tag}}-prod-2024` (image #3): base-binary stage + `FROM acme/base-runtime:2024-stable` COPY `/opt/runtime` stage + CLI-tool stage + runtime apt libs + locale + `LD_LIBRARY_PATH` + hide-runtime-libstdc++; **runtime CONSUMED via FROM, not rebuilt**. Mirrors the scheduler Dockerfile's worker-specific stages.
> - **[NEW] Lockstep single-tag release**: one git tag `vX.Y.Z` → worker `vX.Y.Z-prod-2024` + cli `vX.Y.Z-prod-node22` + chart `X.Y.Z` + both disk snapshots tagged `vX.Y.Z`. **Both runners bump together (versions stay aligned).** Tag suffix `-legacy-` → **`-prod-`** for THIS repo's images. (T8's shipped cli tag `-legacy-node22` gets a follow-up rename to `-prod-node22` — tracked as **T8b**.)
> - **[NEW] Chart moves HERE**: `charts/widget-service/` + `publish-chart.yaml` (registry OCI); deploy chart-dependency `repository:` re-pointed (one line); scheduler repo must stop double-publishing the chart (noted, cross-repo).
> - **[NEW] Dual disk matrix**: {worker,cli} × {us-east-1, eu-west-1} = 4 regional snapshots, workflow lives HERE now, writes back BOTH `worker_image_cache_snapshot_id` + `cli_image_cache_snapshot_id` into infra-repo.
> - **[NEW] Infra tests**: `tests/` harness (worker precedent) + specs for all 3 images + `ci_infra_tests.yml`.
> - infra-repo: `cli` NodeClass + `cli_image_cache_snapshot_id` (worker nodeclass/var untouched).
> - deploy-repo: `cli-jobs` NodePools (us+eu) + `charts/cli-runner/` wrapper + AppSet; chart dep points at THIS repo's registry namespace.
> - `legacy-widget-cli` archived/deprecated; docs cover 3 images + lockstep release + infra tests.
> - TDD (table-driven) + local-stack/kind integration QA (cli e2e; worker e2e best-effort/structural — runtime/license).
>
> **Estimated Effort**: XL (back-half adds a 3rd image + release orchestration + chart move + infra tests)
> **Parallel Execution**: YES — waves (front-half T1–T8 shipped)
> **Critical Path**: [done T1→T2→T3→T4→T7→T8] → T-WIDGET-CORE (Dockerfile.worker, runtime via FROM) → T-RELEASE (release tool 3rd image + lockstep `-prod-` single-tag + T8b suffix rename) → T-DOCS (chart here + publish-chart.yaml) → T-INFRATEST (specs ×3 images) → T9 (dual disk matrix) → T12 (infra cli nodeclass) → T13/T14 (deploy) → F1–F4 → user okay
> **Repos**: widget-service (was legacy-worker; builds all 3 images + chart + snapshots) · acme/scheduler (OUT OF SCOPE — untouched) · deploy-repo · infra-repo · legacy-widget-cli (archived)

---

## Context

### Original Request
Modernize the CLI runner to run k8s jobs, identical flow to the worker (queue/blob, secrets store, blob job I/O, oom-watcher). Original brief explicitly allowed: "port the cli logic into the widget-service image so we can reuse shared logic (oom-watcher, etc.)." Also: cli-lib v1→v2 (npm, drop old flow); newer base with the bundler caution.

### Decisive interview outcomes
- **CONSOLIDATE** cli logic INTO `legacy-worker` (one shared binary; add `cli` mode) — chosen over a separate parallel binary to eliminate ~90% code duplication + contract drift risk.
- **Rename** `legacy-worker` → `widget-service`; **archive** `legacy-widget-cli` (this repo).
- **CLI image MUST NOT contain the shared runtime** (hard constraint) and **MUST contain the CLI tool** (parity with scheduler repo PR #12).
- **Executable resolution = support both**: message `cliBinary`/`executable` primary, else `Settings.xml` `CliScriptName` (+ `Lib/{script}`→root fallback). No platform change required.
- **Sidecar**: reuse worker oom-watcher (same binary, `sidecar` mode) — already language-agnostic.
- **NodeClass** = dedicated `cli` + disk cache (mirror worker). **Queue secret** = reuse worker's (no new store cred). **Cross-repo** = both values-cli.yaml + deploy wrapper.
- **Base image** `node:22-slim`; **toolchain 2024**; **tests** TDD + local-stack + kind.

### REFRAME (parallel-release consolidation) — user-CONFIRMED, supersedes any conflicting framing below

> This subsection is the CURRENT source of truth. Where earlier notes (or the draft) said the runtime is "being phased out / transitional" or framed consolidation as a monorepo, THAT IS NOW CORRECTED here.

1. **"Consolidation" = COORDINATED PARALLEL RELEASE, not a physical monorepo of services.** The CLI + worker IMAGES, the deploy CHART, and the disk SNAPSHOTS all move in **LOCKSTEP off ONE git tag** `vX.Y.Z`. Both runners bump together — the whole point is keeping versions aligned. NO per-image independence is wanted (user explicitly rejected independent cadence).
2. **The shared runtime is NOT going away.** The `acme/scheduler` image STAYS. Its PURPOSE changes (future, out-of-scope): it becomes **cron-only** (scheduling) with **NO worker execution inside it** — the worker-exec↔scheduler coupling is currently "wrongly wired together." The worker *execution runtime* moves into a **worker image built HERE**, mirroring how `Dockerfile.cli` is built HERE.
3. **Scheduler-decoupling is a SEPARATE, OUT-OF-SCOPE task, GATED on the migration of all jobs to the new platform.** In THIS plan we ONLY build the worker image + lockstep release machinery so it is READY TO RECEIVE that future work. **We do NOT edit `acme/scheduler`.**
4. **This repo builds THREE images** from the one binary via the release tool:
   - base minimal `base-runtime:{{.Tag}}` (the binary; oom-watcher sidecar base) — EXISTS, unchanged.
   - `acme/cli-runner:{{.Tag}}-prod-node22` — EXISTS (T7/T8; suffix was `-legacy-node22`, renamed to `-prod-` — see T8b).
   - **`acme/worker:{{.Tag}}-prod-2024`** — NET-NEW `Dockerfile.worker` HERE: base-binary stage + `FROM acme/base-runtime:2024-stable` COPY `/opt/runtime` stage + CLI-tool stage + runtime apt libs + locale + `LD_LIBRARY_PATH` + hide-runtime-libstdc++, ENTRYPOINT the binary. **The runtime is CONSUMED via `FROM acme/base-runtime:2024-stable` — NOT rebuilt here.** Mirrors the current scheduler Dockerfile's worker-specific stages (draft line 69), **minus EXPOSE 4000** unless a runner health/probe port is actually needed (verify).
5. **Tag suffix `-legacy-` → `-prod-`** for the images THIS repo produces (`acme/cli-runner:{{.Tag}}-prod-node22`, `acme/worker:{{.Tag}}-prod-2024`). NOTE: the EXISTING scheduler VERSION scheme `5.9.0-legacy-2024` lives in `acme/scheduler` (OUT OF SCOPE) — leave it. Only this repo's new image tags use `-prod-`.
6. **Chart moves HERE**: add `charts/widget-service/` (the language-agnostic chart, currently in the scheduler repo) + a `publish-chart.yaml` workflow here (registry OCI, `REGISTRY_TOKEN`); re-point the deploy chart-dependency `repository:` (one line). The scheduler repo must STOP double-publishing the chart (noted; editing the scheduler repo to remove its publish is a cross-repo follow-up, not done here).
7. **Dual disk matrix**: generalize the disk-snapshot workflow to a matrix over {worker, cli} × {us-east-1, eu-west-1} = 4 regional snapshots, writing back BOTH `worker_image_cache_snapshot_id` + `cli_image_cache_snapshot_id` into infra-repo. Under this reframe the snapshot workflow lives HERE (images build here now); the 2-region fan-out + infra-PR-bot write-back pattern already exists (draft lines 33-42).
8. **Infra tests**: add `tests/` (harness — Rakefile auto-discovering `spec/<target>/`, matching the worker's existing precedent) with specs for all 3 images: cli spec (CLI tool present, tools present, **`/opt/runtime` ABSENT**, node22), worker spec (runtime `/opt/runtime/libcore.so` present, CLI tool present), base spec (binary present) + a `ci_infra_tests.yml` workflow. (User chose this harness to match precedent over other options.)
9. **T6 e2e**: keep cli local-stack+kind e2e; worker e2e is harder (runtime/license) → best-effort / **structural only**.

### Research Findings (confirmed)

**widget-service core is ~85% language-agnostic** (legacy-worker @ 971aa57):
- `internal/queue/client.go run()` (L145-204) is generic: ReceiveOne, annotate pod BEFORE exec, lease renew, started/heartbeat notify, blob download/upload, DeleteMessage only after completion (idempotent), lease-expired→SIGKILL.
- SEAM = single indirection: `var runExecute = func(job worker.Job, hooks, stop){ job.Execute(...) }` (L29), called L191. Execution + `GetCommand()` live in `internal/worker/job.go`.
- Coupling: (a) `Job.workerBinary` field; (b) `run()`/`runExecute` typed to `worker.Job`; (c) worker stall tuning. → Introduce a small `JobExecutor` interface implemented by `worker.Job` and new `cli.Job`; `run()` takes the interface; a per-subcommand parser builds the concrete type.
- Reuse UNCHANGED: `internal/{queue,storage,secrets,notifier,kubernetes,oomwatcher}`, `cmd/{root,version,sidecar}`, `pkg/helpers`. Sidecar language-agnostic.

**Parity contract** (must hold for cli too): queue msg `{jobId, (cliBinary|workerBinary), blobUri, callbackUrl, webhookUrl, secretsRef}`; blob `jobs/{id}/` download to `{LOCAL_PATH}/{jobId}/`, raw-file upload; annotations set; secrets keep only `PLATFORM_HOSTNAME`+`EXECUTOR_HASH` as env; notifier `JobResult{...}` statuses started/heartbeat/completed/stalled; **cli sets `meta.runner="cli"`**; env `BLOB_BUCKET` injected.

**cli-lib v2.0.0**: `SetupEnv(path)` / `GetRunCommand(path,script)` signature-compatible; precedence npm>pnpm>yarn; needs toolchain 2024 + npm/pnpm/yarn/node on PATH.

**ReleaseTool** supports N `images:` entries (own `dockerfile:` + `image_templates:`) → one binary, N images from ONE tag. Front-half shipped two: base minimal `base-runtime:{{.Tag}}` (the binary) + `acme/cli-runner` (`Dockerfile.cli`, runtime-free). The reframe adds a THIRD entry (`Dockerfile.worker` → `acme/worker:{{.Tag}}-prod-2024`). One-tag→all-images is EXACTLY the lockstep behavior we want.

**the CLI tool** (PR #12): private `acme/cli-tool`, release-only. Stage `FROM debian:slim as clitool` installs `gh`, `gh release download v0.2.0 --repo acme/cli-tool` → `/usr/local/bin/clitool`; needs build secret `registry_token`; CI passes `secrets: registry_token=${{ secrets.API_TOKEN }}`.

**Rename blast radius**: module path + ~36 imports + 3 ldflags + CLI strings (~40 edits, ~20 files). **No external importers.** Repo rename ≠ image rename — worker image and ALL downstream refs UNCHANGED.

**Infra verified**: queue `cli-jobs-*` provisioned; identity for `cli-runner-sa` grants queue/blob/secrets access. deploy-repo is canonical deploy surface. `node:22-slim` real tag.

### Gap-check
Performed via direct infra verification. Message-contract: "support both" removes the platform dependency. Remaining externals captured in "Decisions Needed".

---

## Work Objectives

### Core Objective
Make `widget-service` (renamed from legacy-worker) the single repo that, off ONE git tag, releases in LOCKSTEP: the runtime-free cli image (SHIPPED), a NET-NEW worker image built HERE (runtime consumed via `FROM`), the language-agnostic chart, and dual-image×dual-region disk-cache snapshots — plus infra tests for all 3 images — so the platform is READY to later decouple `acme/scheduler` into cron-only. Deploy cli via the existing deploy/chart pattern; archive legacy `legacy-widget-cli`. **`acme/scheduler` and the shared runtime both stay; decoupling is out of scope.**

### Concrete Deliverables
See TL;DR. Front-half code is SHIPPED (T1–T8). Back-half is mostly Docker/CI/IaC/chart: `Dockerfile.worker` (image #3, runtime via `FROM`), release tool 3rd-image entry + lockstep single-tag `-prod-` suffixes (+ T8b cli-tag rename), `charts/widget-service/` + `publish-chart.yaml` moved here, `tests/` specs ×3 + `ci_infra_tests.yml`, dual-image×dual-region disk-snapshot workflow, infra-repo `cli` NodeClass + `cli_image_cache_snapshot_id`, deploy cli NodePools + wrapper chart + AppSet, docs + archive notice.

### Definition of Done
- [ ] `go build ./... && go vet ./... && go test ./...` pass in widget-service; worker tests unchanged & green.
- [ ] `cli` mode: local-stack+kind e2e — seed queue msg + blob job dir → run → blob outputs, callback `status:completed meta.runner:"cli"`, msg deleted, annotations set.
- [ ] **THREE images build from ONE tag**: base minimal `base-runtime`; cli `acme/cli-runner:{{.Tag}}-prod-node22` (npm/pnpm/yarn + **CLI tool**, **NO `/opt/runtime`**, node22); NEW worker `acme/worker:{{.Tag}}-prod-2024` (**HAS `/opt/runtime` via `FROM`** + CLI tool). Tags aligned to the single git tag.
- [ ] `acme/scheduler` image + VERSION scheme `-legacy-2024` UNTOUCHED (out of scope); runtime NOT rebuilt (consumed via `FROM`).
- [ ] Chart published from HERE (registry OCI) via `publish-chart.yaml`; deploy chart-dependency `repository:` points at this repo's namespace.
- [ ] infra tests green for all 3 images (`ci_infra_tests.yml`): cli(no runtime)+worker(runtime present)+base(binary).
- [ ] disk-snapshot workflow (matrix {worker,cli}×{us,eu}) valid; writes back both `worker_image_cache_snapshot_id` + `cli_image_cache_snapshot_id`.
- [ ] deploy `helm template` renders cli jobs (all tiers) + reused sidecar; `cli-jobs` NodePools valid; infra `cli` NodeClass conditional; worker untouched everywhere.
- [ ] `legacy-widget-cli` archived with a pointer to widget-service.

### Must Have
- One binary → **THREE images from ONE git tag**, released in LOCKSTEP (both runners + chart + snapshots bump together, versions aligned).
- Runtime-free cli image WITH the CLI tool; NEW worker image WITH runtime (via `FROM acme/base-runtime`) + CLI tool; base minimal image unchanged.
- `worker` runtime behavior byte-identical; queue/blob/annotations/notifier/secrets/env parity; `meta.runner="cli"`.
- `-prod-` tag suffix for this repo's cli+worker images; chart published from here; dual-region disk snapshots for both images.
- Executable resolution supports both message field and Settings.xml.

### Must NOT Have (Guardrails)
- **Do NOT modify the scheduler image (OUT OF SCOPE)** — no edits to the scheduler repo's `Dockerfile`, VERSION, push_to_registry.yml, or its EXPOSE-4000/cron wiring. The scheduler→cron-only decoupling is a separate, migration-gated task.
- **Do NOT rebuild the runtime** — the new `Dockerfile.worker` CONSUMES it via `FROM acme/base-runtime:2024-stable` + `COPY --from`; never build the runtime from source here.
- **Do NOT give the images independent versions** — lockstep single-tag `vX.Y.Z` drives all 3 image tags + chart + snapshots. No per-image cadence, no build-ID split introduced solely to decouple releases.
- **Do NOT alter worker RUNTIME behavior/output** anywhere: `internal/worker` behavior, the base minimal worker image, `values-worker.yaml`, deploy `worker-jobs.yaml`/`charts/worker-runner`, infra-repo `worker` NodeClass/`worker_image_cache_snapshot_id`, the `bump-worker` skill. Worker output must be byte-identical before/after.
- **Runtime-free applies to the CLI image ONLY** — `Dockerfile.cli` must never reference a runtime stage or `/opt/runtime`. The NEW `Dockerfile.worker` DELIBERATELY contains the runtime (that is its purpose).
- **Do NOT rename the base image / existing downstream image refs** — the base minimal `base-runtime:{{.Tag}}` name stays; only the NEW runnable images use the `acme/{cli,worker}-runner` names with the `-prod-` suffix.
- **Do NOT duplicate the shared core** — reuse `internal/{queue,storage,secrets,notifier,kubernetes,oomwatcher}`; execution code stays in `internal/{worker,cli}` + the shared `internal/job` base.
- **Do NOT over-abstract** — a minimal `Executor` interface; no plugin/registry framework.
- **Do NOT invent a new queue store credential** — reuse worker's.
- **Do NOT build bundler binaries here** (external). No new infra beyond the cli NodeClass (T12) + the cli snapshot var.
- **Do NOT add a new sidecar mode** — reuse the existing `sidecar`.

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — all verification agent-executed. Evidence → `.sisyphus/evidence/`.

### Test Decision
- Infrastructure exists: YES (widget-service uses `go test`, table-driven, same-package).
- **Automated tests**: TDD. New `internal/cli` + `JobExecutor` seam get RED→GREEN→REFACTOR unit tests using mocks; existing shared-package tests must stay green (regression guard for worker).
- Framework: Go `testing`; `k8s.io/client-go/kubernetes/fake`; hand-rolled cloud SDK fakes (existing pattern).

### QA Policy (per task)
- Cloud-facing behavior: local-stack (`docker run -p 4566:4566 localstackorg/localstack`) + `cloud --endpoint-url`.
- k8s annotate/sidecar: `kind` + `kubectl`.
- CLI subcommands: `interactive_bash` (tmux) on the built binary.
- Images: `docker build`/`buildx` + `docker run` + specs. CLI image → CLI tool present, **runtime absent**, tools present. NEW worker image → **runtime present** (`/opt/runtime/libcore.so`), CLI tool present. Base image → binary present.
- Chart/infra/CI: `helm template`/`helm lint`/`terraform validate|plan`/`actionlint`.
- Release: `releasetool check` + `releasetool release --snapshot --clean --skip=publish` (with `registry_token`) builds ALL 3 images from one tag; assert `-prod-` suffixes and tag alignment.

### Guardrail QA (run repeatedly)
- **Scheduler-untouched (OUT OF SCOPE)**: assert ZERO edits to `acme/scheduler`. We never open a PR there in this plan.
- **Runtime-not-rebuilt**: `Dockerfile.worker` uses `FROM acme/base-runtime:2024-stable` + `COPY --from`; grep shows no runtime-from-source build steps.
- **Lockstep tags aligned**: after a snapshot release, worker `vX.Y.Z-prod-2024`, cli `vX.Y.Z-prod-node22`, chart `X.Y.Z`, both snapshots `vX.Y.Z` all share the SAME `X.Y.Z` from the one git tag.
- **Worker-unchanged**: worker RUNTIME output + `go test ./internal/worker/...` byte-identical/green before vs after; base minimal worker image build unchanged; deploy `helm template -f values-worker.yaml` byte-identical.
- **Runtime-free cli image**: `docker run <cli-image> sh -c 'test ! -e /opt/runtime'`; `docker history` shows no runtime layer.
- **Worker image HAS runtime**: `docker run <worker-image> sh -c 'test -e /opt/runtime/libcore.so'`; `clitool --version` exit 0.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1–2 (widget-service cli foundation + cli image) — ✅ SHIPPED:
├── T1: [x] Repo/module rename → widget-service                                (PR #12)
├── T2: [x] Executor interface + run() dispatch (worker byte-identical)        (PR #12)
├── T5: [x] Toolchain 2024 + cli-lib v2.0.1 dep + tooling doc                  (PR #12)
├── T3: [x] internal/cli (Job/Execute/exec-resolution msg|XML) + base pkg      (#12-stack)
├── T4: [x] cmd/cli.go + runner-label parametrization                         (#13-stack)
└── T7: [x] Dockerfile.cli (node:22-slim + npm/pnpm/yarn + CLI tool, NO runtime) (#14-stack)
    T8: [x] release tool 2nd (cli) image + registry_token build secret         (#15-stack, tag WAS -legacy-)

Wave A (3rd image + lockstep release — the reframe core):
├── T-WIDGET-CORE: Dockerfile.worker HERE (base binary + FROM acme/base-runtime COPY /opt/runtime + CLI tool + LD_LIBRARY_PATH)  [unspecified-high]
├── T-RELEASE:     release tool 3rd image entry + lockstep single-tag `-prod-` suffixes (cli+worker) + registry_token for BOTH; folds T8b cli-tag rename [deep]
└── T6:            local-stack + kind QA harness + cli fixtures (worker e2e structural-only)  [unspecified-high]

Wave B (chart move + infra tests + snapshots — depend on Wave A images):
├── T-DOCS:      charts/widget-service/ moved HERE + publish-chart.yaml (registry OCI, REGISTRY_TOKEN) + note deploy one-line re-point + note scheduler-repo stop-publishing  [deep]
├── T-INFRATEST: tests/ harness + specs for all 3 images + ci_infra_tests.yml  [unspecified-high]
├── T9:          dual disk matrix {worker,cli}×{us,eu}=4 snapshots HERE; writes back BOTH infra vars  [unspecified-high]
└── T12:         infra-repo cli NodeClass + cli_image_cache_snapshot_id (worker untouched)  [deep, skill: terraform-skill]

Wave C (deploy — depend on Wave A/B image tags + chart home + infra NodeClass):
├── T10: [CROSS-REPO chart] values-cli.yaml (all tiers) — in the chart's NEW home (here)              [deep]
├── T11: [CROSS-REPO chart] keda.secretName param → reuse worker secret — chart's new home           [deep]
├── T13: deploy autoscaling/{us,eu}-jobs/cli-jobs.yaml NodePools (mirror worker)                      [deep]
├── T14: deploy charts/cli-runner/* wrapper + AppSet; chart dep repository: → THIS repo's registry    [deep]
└── T15: docs (3 images + lockstep release + infra tests + contract) + archive legacy-widget-cli      [writing]

Wave FINAL (after ALL — 4 parallel reviews, then user okay):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA — local-stack+kind + all 3 images (unspecified-high)
└── F4: Scope fidelity + parity + WORKER/SCHEDULER-UNTOUCHED across repos (deep)
→ Present results → explicit user okay
```

### Dependency Matrix (abbreviated; T1–T8 done)
- **T-WIDGET-CORE**: none new (mirrors shipped Dockerfile.cli + draft scheduler stages); soft on the built binary.
- **T-RELEASE**: T-WIDGET-CORE (needs Dockerfile.worker to add the 3rd `images:` entry); folds T8b (cli `-legacy-`→`-prod-`).
- **T6**: none (harness); feeds F3.
- **T-DOCS**: none hard (chart is self-contained); T-RELEASE (image tags the chart references).
- **T-INFRATEST**: T-WIDGET-CORE + T7 (needs all 3 Dockerfiles to spec against).
- **T9**: T-WIDGET-CORE + T7 (both images to snapshot), T12 (both write-back vars — soft).
- **T12**: none (infra) — batched Wave B.
- **T10**: T-DOCS (chart's new home) + T-RELEASE (image tag/suffix). **T11**: T10 (same chart PR).
- **T13**: T12 (nodeClassRef cli). **T14**: T-RELEASE(tag), T-DOCS(chart home/repository:), T10(values), T11(secret), T13(nodePool). **T15**: T-RELEASE/T-DOCS/T-INFRATEST.
- **F1–F4**: ALL.

### Agent Dispatch Summary (back-half)
- Wave A: T-WIDGET-CORE `unspecified-high`, T-RELEASE `deep`, T6 `unspecified-high`
- Wave B: T-DOCS `deep`, T-INFRATEST `unspecified-high`, T9 `unspecified-high`, T12 `deep` (skill: terraform-skill)
- Wave C: T10 `deep`, T11 `deep`, T13 `deep`, T14 `deep`, T15 `writing`
- FINAL: F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## Decisions Needed / Defaults Applied

**RESOLVED (reframe)**: consolidation = COORDINATED PARALLEL RELEASE (lockstep single-tag), NOT a monorepo; rename→widget-service; archive this repo; runtime-free CLI image; NEW worker image built HERE (runtime CONSUMED via `FROM acme/base-runtime:2024-stable`, NOT rebuilt); CLI tool in both cli+worker images; `-prod-` tag suffix for this repo's images; chart moves HERE + published from here; dual-image×dual-region disk matrix; infra tests ×3; cli NodeClass+disk cache; queue secret reuse. **The shared runtime stays; `acme/scheduler` UNTOUCHED (scheduler→cron-only decoupling is a separate, migration-gated, out-of-scope task).**

**Decisions Needed (external — non-blocking for code):**
- **D-MULTI-REGION (RESOLVED — multi-region mirroring)**: user confirmed cross-region mirroring (us-east-1 → eu-west-1) is ALREADY set up and relied upon. Therefore this repo pushes images to `us-east-1` ONLY (as today) and EU consumes the mirrored copies from `eu-west-1` automatically. NO push matrix is added to the release workflow. T14 deploy `values-eu` keeps its `eu-west-1` registry references (they resolve via mirroring). The dual-region disk matrix still produces regional snapshots per region (snapshots are regional regardless of image mirroring).
- **D-API-OWNER**: Confirm the platform side that enqueues cli jobs, uploads blob inputs to `jobs/{id}/`, and consumes callbacks exists (or is tracked). "Support both" means the runner works whether or not `cliBinary` is sent.
- **D-TOOL-VERSION**: Pin `TOOL_VERSION` — PR #12 uses `v0.2.0` (T7 shipped `v0.2.0`); confirm the version BOTH the cli + new worker images should ship (they should match).
- **D-TOKEN-SECRET**: Confirm the release/CI workflow in widget-service has (or gets) an `API_TOKEN`/`registry_token` secret with read access to private `acme/cli-tool` (needed for BOTH cli + worker image builds).
- **D-DOCS-PUBLISH**: the scheduler repo must STOP double-publishing `charts/widget-service` once we publish it from HERE. Editing that repo's `publish-chart.yaml` is a cross-repo follow-up outside this plan's edit set — track it.
- **D-EXPOSE-PORT**: Verify whether the NEW `Dockerfile.worker` runner needs `EXPOSE 4000` (scheduler has it for its HTTP trigger). Default: OMIT it (runner is queue-driven, not HTTP). Confirm no probe depends on it.
- **D-VERSION-SCHEME**: The lockstep tag reconciles this repo's git-tag scheme with the chart's Chart.yaml semver. The scheduler's own `-legacy-2024` VERSION-file scheme is OUT OF SCOPE (untouched). Confirm the single-tag `vX.Y.Z` → `X.Y.Z` chart-version derivation.

**Defaults Applied (override anytime):**
- Executable: message `cliBinary` primary → XML fallback. Keep producing status files (uploaded to blob). Drop global `corelib` from cli image (jobs self-provide; verify). Hard cutover (no dual-run); rollback = previous image tag.
- **Image names/tags**: `acme/cli-runner:{{.Tag}}-prod-node22` and `acme/worker:{{.Tag}}-prod-2024` (NEW), off the single git tag; base minimal `base-runtime:{{.Tag}}` name unchanged. Chart version = the tag's `X.Y.Z`.
- **T8b (cli tag rename)**: T8 shipped `-legacy-node22`; the reframe renames it to `-prod-node22`. Handled inside T-RELEASE (T8 stays `[x]` — do not un-check; the suffix change is a pending follow-up folded into T-RELEASE).

---

## TODOs

> All tasks operate on `acme/widget-service` (was legacy-worker) unless tagged [CROSS-REPO ...] or [THIS REPO=legacy-widget-cli]. Worker RUNTIME behavior must stay byte-identical. **`acme/scheduler` is OUT OF SCOPE — never edited by these tasks. The runtime is CONSUMED via `FROM`, never rebuilt.**
>
> **Numbering note**: Completed tasks keep their original numbers (T1–T8, all `[x]`). New reframe tasks use suffix IDs (**T-WIDGET-CORE, T-RELEASE, T-DOCS, T-INFRATEST, T8b**) so completed numbers stay stable. T9/T12 are REWRITTEN in place; T10/T11/T13/T14/T15 are RE-SCOPED to the new chart-home / lockstep model.

- [x] 1. Rename repo/module → widget-service  <!-- code-side done on branch feat/rename-widget-service (commit abc1234); GitHub repo rename DEFERRED to user (org-level). -->


  **What to do**:
  - Rename the GitHub repo `acme/legacy-worker` → `acme/widget-service`.
  - Edit `go.mod` module path → `github.com/acme/widget-service`. Update ALL internal imports (~36 lines) via search-replace of the module prefix. Update the 3 ldflags. Update CLI strings: `cmd/root.go` `Use:` and `cmd/version.go` binary name; refresh `AGENTS.md` examples.
  - `go build ./... && go test ./...` must pass unchanged (pure rename).

  **Must NOT do**: change any logic/behavior; rename the image or any downstream image/chart/infra reference; touch `internal/worker` logic.

  **Recommended Agent Profile**: **Category** `deep` (mechanical but wide; a missed import breaks build). Skills: [].

  **Parallelization**: NO (foundation) · Wave 1 · Blocks: T2,T3,T4,T7 · Blocked By: None.

  **References**:
  - Rename blast-radius report: go.mod line 1 + ~36 imports + ldflags + `cmd/root.go` Use + `cmd/version.go`. (WHY: exact edit set.)
  - "repo rename ≠ image rename" — worker image + downstream refs UNCHANGED. (WHY: guardrail.)

  **Acceptance Criteria**:
  - [ ] `grep -RIn "legacy-worker" --include=*.go .` returns nothing (module path fully migrated).
  - [ ] `go build ./... && go test ./...` green; `./widget-service version` prints new name.

  **QA Scenarios**:
  ```
  Scenario: module rename complete + builds + tests green
    Tool: Bash
    Steps:
      1. grep -RIn "acme/legacy-worker" . ; assert none
      2. go build ./... && go vet ./... && go test ./... ; assert pass (worker tests included)
      3. build with ldflags; ./bin version | assert "widget-service"
    Expected Result: clean rename, all green
    Failure Indicators: leftover old path; build/test failure
    Evidence: .sisyphus/evidence/task-1-rename.txt
  ```
  **Evidence to Capture**: [ ] task-1-rename.txt

  **Commit**: YES — `refactor: rename module legacy-worker → widget-service` · files: `go.mod,go.sum,**/*.go,cmd/*,AGENTS.md` · Pre-commit: `go build ./... && go test ./...`

- [x] 2. Introduce JobExecutor interface; dispatch run() on it (worker unchanged)  <!-- commit def5678 (branch feat/rename-widget-service). Executor iface local in internal/queue/client.go; build/vet/full test-short green; worker unchanged. -->


  **What to do**:
  - Define a minimal interface (e.g. `internal/job/executor.go`): `type Executor interface { Execute(hooks worker.ExecuteHooks, stop chan struct{}) notifier.JobResult }` (reuse existing hooks/result types; if those live in `internal/worker`, consider moving the shared hooks/result types to a neutral package `internal/job` WITHOUT changing their behavior/fields — or keep them in worker and have cli import them; pick the lower-churn option and document).
  - Refactor `internal/queue/client.go`: make `runExecute`/`run()` operate on `Executor` + a `parseJob(body) (Executor, annotationsMeta, error)` seam, instead of being hard-typed to `worker.Job`. worker path: parser returns a `worker.Job` — behavior identical.
  - Keep annotation building working for both; source `model` from the executor.

  **Must NOT do**: change worker's runtime behavior or JobResult/annotation output; broad rewrites — keep the seam surgical.

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain` — the crux: decouple orchestration from `worker.Job` without altering worker behavior; type/ownership decisions ripple into T3/T4.
  - **Skills**: [].

  **Parallelization**: NO · Wave 1 · Blocks: T3,T4 · Blocked By: T1.

  **References**:
  - `internal/queue/client.go` `run()` L145-204 + `runExecute` L29 (the seam). (WHY: exact indirection to generalize.)
  - `internal/worker/job.go Execute/GetCommand` + `ExecuteHooks`/`notifier.JobResult` types. (WHY: interface shape + where shared types live.)
  - AGENTS.md conventions (error wrapping). (WHY: match style.)

  **Acceptance Criteria**:
  - [ ] TDD: table tests with a fake Executor asserting `run()` calls Execute and preserves call order; worker-path test unchanged/green.
  - [ ] `go test ./internal/worker/... ./internal/queue/...` green; worker behavior identical.

  **QA Scenarios**:
  ```
  Scenario: run() dispatches via Executor, worker regression green
    Tool: Bash (go test)
    Steps:
      1. go test ./internal/queue/... -run TestRun -v  (fake Executor) → order asserted
      2. go test ./internal/worker/... → all existing pass (no behavior change)
    Expected Result: generic dispatch works; worker untouched
    Failure Indicators: worker tests change/fail; order wrong
    Evidence: .sisyphus/evidence/task-2-executor.txt
  ```
  **Evidence to Capture**: [ ] task-2-executor.txt

  **Commit**: YES — `refactor(queue): dispatch job execution via Executor interface` · files: `internal/job/executor.go,internal/queue/client.go(,internal/worker/* minimal)` · Pre-commit: `go test ./...`

- [x] 5. Verify toolchain 2024 + cli-lib v2; document cli tooling assumptions  <!-- DONE. Dep ADDED to widget-service: go.mod require github.com/acme/cli-lib/v2 v2.0.1. go build/vet exit 0. docs/cli-tooling.md updated. Commit 1a2b3c4 (branch feat/rename-widget-service, unsigned, unpushed). IMPORT PATH for T3/T4 = github.com/acme/cli-lib/v2/cli. -->


  **What to do**:
  - Confirm `go.mod` already toolchain 2024. Add `github.com/acme/cli-lib/v2 v2.0.0` dependency. `go mod tidy`.
  - Add `docs/cli-tooling.md`: cli image needs `npm`,`pnpm`,`yarn`,`node` on PATH; precedence npm>pnpm>yarn; env-setup errors are logged-not-returned.

  **Must NOT do**: change execution logic (T3).

  **Recommended Agent Profile**: **Category** `quick`. Skills: [].

  **Parallelization**: YES · Wave 1 · Blocks: T3 · Blocked By: None (soft T1 for go.mod path).

  **References**: cli-lib v2 README/API; widget-service `go.mod`. (WHY: dep + version.)

  **Acceptance Criteria**:
  - [ ] `go list -m github.com/acme/cli-lib/v2` → v2.0.0; `go build ./...` green.
  - [ ] `docs/cli-tooling.md` present.

  **QA Scenarios**:
  ```
  Scenario: v2 pinned + builds
    Tool: Bash
    Steps: 1. go list -m .../cli-lib → v2.0.0  2. go build ./... → exit 0
    Evidence: .sisyphus/evidence/task-5-clilib.txt
  ```
  **Evidence to Capture**: [ ] task-5-clilib.txt

  **Commit**: YES — `build: add cli-lib v2 + cli tooling doc` · files: `go.mod,go.sum,docs/cli-tooling.md` · Pre-commit: `go build ./...`

- [x] 6. local-stack + kind QA harness + sample fixtures  <!-- DONE commit 5d6e7f8 (branch feat/qa-harness; local, unpushed, NO PR yet — awaiting user). widget-service. 11 files, ONLY hack/qa/* + testdata/*. hack/qa/{localstack-up.sh, seed.sh (queue cli-jobs-test + blob store cli-storage-test + secret acme/api-credentials={PLATFORM_HOSTNAME,EXECUTOR_HASH}), kind-up.sh, teardown.sh, README.md}. Endpoint wiring = ENV ONLY: cloud SDK honors ENDPOINT_URL. Fixtures match internal/cli resolveExecutable ground-truth. bash -n x4 PASS. Signed. Evidence: task-6-harness.txt. This was the LAST implementation task before F1-F4. -->

  **What to do**:
  - `hack/qa/`: `localstack-up.sh`, `seed.sh` (queue, blob store `cli-storage-test`, secret `acme/api-credentials` = `{PLATFORM_HOSTNAME,EXECUTOR_HASH}`, upload sample job dir to `jobs/{id}/`), `kind-up.sh`, `teardown.sh`.
  - Test-only cloud endpoint wiring honoring `ENDPOINT_URL` for local-stack.
  - Fixtures under `testdata/`: an npm job (package.json+script + a `*Settings.xml` with `CliScriptName`) AND a bundled-style binary stub.

  **Must NOT do**: modify runner packages.

  **Recommended Agent Profile**: **Category** `unspecified-high`. Skills: [].

  **Parallelization**: YES · Wave 1 · Blocks: T3,T4 QA, F3 · Blocked By: None.

  **References**: local-stack README; cli-lib v2 testdata layout; current legacy-widget-cli `testdata/jobs/*`. (WHY: valid fixtures incl XML-fallback case.)

  **Acceptance Criteria**:
  - [ ] local-stack health OK; `seed.sh` lists queue+store+secret; `kind-up.sh` node Ready.

  **QA Scenarios**:
  ```
  Scenario: harness bring-up + seed
    Tool: Bash
    Steps: localstack-up → curl health; seed → list asserts; kind-up → kubectl get nodes Ready
    Evidence: .sisyphus/evidence/task-6-harness.txt
  ```
  **Evidence to Capture**: [ ] task-6-harness.txt

  **Commit**: YES — `test: local-stack+kind harness + cli/bundled fixtures` · files: `hack/qa/*,testdata/*` · Pre-commit: `bash -n hack/qa/*.sh`

- [x] 3. internal/cli — Job + Execute seam + executable resolution (msg|XML) + tests  <!-- DONE commit 2b3c4d5 (branch feat/cli-execution-seam, stacked on PR#12). internal/cli/{job.go,binaryrunner.go,paths.go,job_test.go}. Mirrors worker.Execute exactly. resolveExecutable = cliBinary msg → *Settings.xml CliScriptName → Lib/root; script→cli-lib v2, else exec binary. build/vet/full test-short green; worker untouched; signed; not pushed. -->

  **What to do**:
  - Create `internal/cli/job.go` implementing the `Executor` interface (T2), mirroring `internal/worker/job.go` structure but cli-specific:
    - `Job` struct: `JobID`, optional `Executable json:"cliBinary,omitempty"`, `BlobObjectURL`, `CallbackURL`, `SecretsRef`, `Tenant`.
    - **Executable resolution** (`resolveExecutable(dir)`): if `Executable` set use it; else parse `*Settings.xml` `CliScriptName`. Locate via `Lib/{name}`→root fallback.
    - **Execute**: script → `cli.SetupEnv(dir)` + `cli.GetRunCommand(dir, script)`; else `exec.Command(binary)`. Set `meta.runner="cli"`, `meta.modelName=resolvedName`.
  - Port `xml.go` into `internal/cli`.

  **Must NOT do**: touch `internal/worker`; re-implement env setup (use cli-lib v2); build a generic multi-language framework.

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain` — faithfully map worker's Execute/stall/signal semantics onto cli's dual (script/binary) + XML-fallback model with zero parity drift.
  - **Skills**: [].

  **Parallelization**: YES · Wave 2 · Blocks: T4 · Blocked By: T2,T5,T6.

  **References**:
  - `internal/worker/job.go` (Execute/GetCommand/stall/blob/annotate ordering). (WHY: mirror semantics.)
  - current legacy-widget-cli `cli/{job.go,binaryrunner.go,log.go,xml.go}`. (WHY: cli-specific exec + XML + noise stripping to port.)
  - cli-lib v2 `cli/{run,env}.go`. (WHY: env seam.)

  **Acceptance Criteria**:
  - [ ] TDD: resolveExecutable table (message-primary; XML fallback; Lib vs root; script vs binary), exit-code, cleanOutput stripping, meta.runner=="cli" → PASS.
  - [ ] script job runs via env; binary job via exec; stall TERM→KILL on no-output stub.

  **QA Scenarios**:
  ```
  Scenario: npm script via XML fallback (no message binary)
    Tool: interactive_bash (npm present or run in T7 image)
    Steps: job with NO cliBinary + Settings.xml CliScriptName=script → resolve from XML → env run → output, exit 0
    Evidence: .sisyphus/evidence/task-3-xml-npm.txt

  Scenario: message cliBinary overrides XML + bundled binary path + stall
    Tool: interactive_bash
    Steps: 1. cliBinary set → used over XML  2. binary exec exit propagated  3. no-output stub → SIGTERM→grace→SIGKILL, stalled
    Evidence: .sisyphus/evidence/task-3-override-stall.txt

  Scenario: cleanOutput strips noise + meta.runner=cli (unit)
    Tool: Bash (go test)
    Evidence: .sisyphus/evidence/task-3-clean-meta.txt
  ```
  **Evidence to Capture**: [ ] task-3-xml-npm.txt [ ] task-3-override-stall.txt [ ] task-3-clean-meta.txt

  **Commit**: YES — `feat(cli): cli execution seam (script/npm + binary, XML fallback)` · files: `internal/cli/*` · Pre-commit: `go test ./internal/cli/...`

- [x] 4. cmd/cli.go — register cli subcommand; wire parser→Executor  <!-- DONE commit 3c4d5e6 (branch feat/cli-subcommand, stacked on #13). cmd/cli.go + RunCli + ReceiveOneCli + generic buildAnnotations via jobMeta interface. notifier.Notify now defaults Meta.Runner to "worker" ONLY when empty → worker wire byte-identical, cli reports runner=cli. --help lists cli; fails fast w/o QUEUE_URL. + FOLLOW-UP REFACTOR commit 4d5e6f7: extracted shared internal/job base package. worker TEST files byte-identical (0 diff), all 12 pkgs green. Signed; not pushed. -->

  **What to do**:
  - `cmd/cli.go` mirroring `cmd/worker.go`: `cli` command whose RunE invokes the shared `queue.Run` orchestration configured with the cli parser (builds `cli.Job` as the `Executor`). Register in `cmd/root.go init()`.
  - Ensure `run()` (T2) uses the cli parser when in cli mode. Verify `meta.runner="cli"` end-to-end and annotations `model` populated from resolved cli name.

  **Must NOT do**: alter worker subcommand; duplicate orchestration.

  **Recommended Agent Profile**: **Category** `deep`. Skills: [].

  **Parallelization**: YES · Wave 2 · Blocks: T8,T10,T15 · Blocked By: T2,T3.

  **References**: `cmd/{root,worker,sidecar}.go` (subcommand pattern); T2 Executor/parse seam. (WHY: wire without touching worker.)

  **Acceptance Criteria**:
  - [ ] `./widget-service --help` lists `cli`; `cli` fails fast without `QUEUE_URL`.
  - [ ] TDD: cli-mode orchestration test (fakes) → annotate→download→started→execute(cli)→completed(meta.runner=cli)→delete order.

  **QA Scenarios**:
  ```
  Scenario: cli one-shot e2e via local-stack (happy)
    Tool: interactive_bash (local-stack + seeded npm job in blob + queue msg; run binary in T7 image)
    Steps: run cli mode → blob outputs present, callback status=completed meta.runner=cli, msg deleted, exit 0
    Evidence: .sisyphus/evidence/task-4-e2e.txt

  Scenario: lists cli + fails fast no queue (negative)
    Tool: interactive_bash
    Steps: --help contains cli ; unset QUEUE_URL → non-zero + fatal log
    Evidence: .sisyphus/evidence/task-4-help-noqueue.txt
  ```
  **Evidence to Capture**: [ ] task-4-e2e.txt [ ] task-4-help-noqueue.txt

  **Commit**: YES — `feat(cmd): add cli subcommand reusing shared orchestration` · files: `cmd/cli.go,cmd/root.go` · Pre-commit: `go test ./...`

- [x] 7. Dockerfile.cli — node:22-slim + npm/pnpm/yarn + CLI tool (NO runtime)  <!-- DONE commit 6f7a8b9 (branch feat/cli-image, stacked on #14). Dockerfile.cli + .dockerignore. Builder golang:2024 → binary; clitool stage (v0.2.0, gh release download, build secret registry_token); final node:22-slim + worker uid999 + npm/pnpm/yarn, COPY binary + clitool, ENTRYPOINT, USER worker. INDEPENDENTLY VERIFIED in built image ws-cli:qa: clitool 0.2.0, npm/pnpm/yarn, Node 22, /opt/runtime ABSENT + no runtime layer, uid999, no EXPOSE 4000. worker Dockerfile UNTOUCHED. Signed; not pushed. -->

  **What to do**:
  - New `Dockerfile.cli` with `# syntax=docker/dockerfile:1`. Builder stage `FROM golang:2024...` builds the binary (CGO off). **CLI-tool stage** copied verbatim from scheduler repo PR #12 (`FROM debian:slim as clitool`, install gh, `gh release download ${TOOL_VERSION} --repo acme/cli-tool`, `--mount=type=secret,id=registry_token,required=true`). Final `FROM node:22-slim`: install npm + pnpm + yarn, worker uid 999 + writable cache, `COPY --from=builder` binary → `/usr/local/bin/widget-service`, `COPY --from=clitool /usr/local/bin/clitool /usr/local/bin/clitool`, ENTRYPOINT binary. **NO runtime stage, NO `COPY --from=runtime`, NO `/opt/runtime`, NO EXPOSE 4000.**
  - `.dockerignore` as needed. Build locally with `docker buildx build -f Dockerfile.cli --secret id=registry_token,env=REGISTRY_TOKEN`.

  **Must NOT do**: reference the runtime stage; touch the worker `Dockerfile`.

  **Recommended Agent Profile**: **Category** `unspecified-high` (Docker + build secret). Skills: [].

  **Parallelization**: YES · Wave 2 · Blocks: T8,T9 · Blocked By: T1 (+T5 tooling).

  **References**:
  - scheduler repo PR #12 diff (clitool stage + COPY + syntax directive + build secret). (WHY: exact clitool pattern.)
  - current legacy-widget-cli `Dockerfile` (worker uid 999, cache perms). (WHY: cli-base structure.)
  - Runtime-free guardrail + `node:22-slim`. (WHY: constraints.)

  **Acceptance Criteria**:
  - [ ] `docker buildx build -f Dockerfile.cli --secret id=registry_token,env=REGISTRY_TOKEN -t cli:qa .` succeeds.
  - [ ] In image: `clitool --version` exit 0; `npm/pnpm/yarn/node` present; node 22; **`/opt/runtime` ABSENT**; no `4000` EXPOSE.

  **QA Scenarios**:
  ```
  Scenario: cli image has CLI tool + tools, NO runtime
    Tool: Bash (buildx + docker run + history)
    Steps:
      1. buildx build -f Dockerfile.cli --secret id=registry_token,env=REGISTRY_TOKEN -t cli:qa .
      2. docker run --rm cli:qa sh -c 'clitool --version; npm --version; pnpm --version; yarn --version; node --version; test ! -e /opt/runtime && echo NO_RUNTIME'
      3. assert clitool exit0, tools present, node22, "NO_RUNTIME"
      4. docker history cli:qa | assert no runtime layer
    Expected Result: CLI tool present, runtime absent, tools present
    Failure Indicators: /opt/runtime exists; clitool missing; tool missing
    Evidence: .sisyphus/evidence/task-7-cliimage.txt
  ```
  **Evidence to Capture**: [ ] task-7-cliimage.txt

  **Commit**: YES — `build: Dockerfile.cli (CLI tool, npm/pnpm/yarn, no runtime)` · files: `Dockerfile.cli,.dockerignore` · Pre-commit: `docker buildx build -f Dockerfile.cli --secret id=registry_token,env=REGISTRY_TOKEN -t cli:qa .`

- [x] 9. build-disk-snapshot workflow — dual image × dual region matrix (HERE) [REWRITTEN by reframe]  <!-- DONE commit 7fed519 (branch feat/disk-snapshot-workflow; PR #12 open, required lint+tests PASS, REVIEW_REQUIRED). Option B (user: full cutover — widget-service = single source for images+chart+disk for BOTH runners). .github/workflows/build-disk-snapshot.yml (matrix {worker:acme/worker:-prod-2024, cli:acme/cli-runner:-prod-node22}x{us-east-1,eu-west-1}=4; trigger workflow_run[releasetool]+dispatch; open-pr writes BOTH worker_+cli_image_cache_snapshot_id into infra-repo) + ported .github/scripts/{build-user-data.sh, resolve-images.py}. actionlint clean. Signed. Evidence: task-9-disk.txt
  FOLLOW-UPS (noted in PR #12, NOT this task): (a) RETIRE scheduler repo build-disk-snapshot.yml before first worker run; (b) T14b deploy worker-runner wrapper re-point; (c) optional: rename worker-named builder IAM. -->

  **What to do**:
  - Add `.github/workflows/build-disk-snapshot.yml` HERE, generalizing the scheduler repo's regional snapshot workflow to a **MATRIX over {worker, cli} × {us-east-1, eu-west-1} = 4 regional snapshots**. Trigger on `workflow_run` of the release + manual dispatch. Per cell: run the builder w/ a scratch disk, pull THAT image into the runtime, create-snapshot, cleanup old unreferenced snapshot.
  - **Write-back**: open a PR into infra-repo updating BOTH `worker_image_cache_snapshot_id` AND `cli_image_cache_snapshot_id`. Snapshots are REGIONAL — 4 distinct ids.
  - Relates to D-MULTI-REGION: EU snapshots pre-warm whatever image EU ends up serving.

  **Must NOT do**: edit `acme/scheduler` (OUT OF SCOPE); snapshot only one image; run on every commit; touch the worker NodeClass semantics.

  **Recommended Agent Profile**: **Category** `unspecified-high`. Skills: [].

  **Parallelization**: YES · Wave B · Blocks: none · Blocked By: T-WIDGET-CORE + T7 (both images), T12 (cli var — soft).

  **References**: draft lines 33-42 (regional snapshot mechanism; snapshots regional; write-back = PR into infra-repo; generalize the 2-region fan-out to {worker,cli}×{us,eu}=4). (WHY: exact mechanism + matrix design.)

  **Acceptance Criteria**:
  - [ ] `actionlint` clean; matrix = {worker,cli}×{us,eu}; write-back PR updates BOTH `worker_image_cache_snapshot_id` + `cli_image_cache_snapshot_id`; release-triggered.

  **QA Scenarios**:
  ```
  Scenario: dual-image dual-region snapshot workflow valid + both write-backs
    Tool: Bash
    Steps: actionlint; assert matrix {worker,cli}×{us-east-1,eu-west-1}; grep write-backs for BOTH worker_image_cache_snapshot_id + cli_image_cache_snapshot_id; release trigger
    Evidence: .sisyphus/evidence/task-9-disk.txt
  ```
  **Evidence to Capture**: [ ] task-9-disk.txt

  **Commit**: YES — `ci: dual-image dual-region disk snapshot matrix + infra write-back` · files: `.github/workflows/build-disk-snapshot.yml` · Pre-commit: `actionlint`

- [x] 8. ReleaseTool 2nd image target (cli) + CI registry_token build secret  <!-- DONE commit 8b9c0d1 (branch feat/cli-releasetool, stacked on #15). .releasetool.yml 2nd images entry → acme/cli-runner:{latest,{{.Tag}}-legacy-node22} via Dockerfile.cli + --secret=id=registry_token,env=REGISTRY_TOKEN; worker entry UNCHANGED. release.yml: BUILDKIT=1 + REGISTRY_TOKEN=secrets.API_TOKEN. VERIFIED: releasetool check ok; worker image builds w/ ENTRYPOINT intact; cli image+clitool secret proven in T7. Signed; not pushed. -->

  **What to do**:
  - Add a second entry to `.releasetool.yml` `images:` using `dockerfile: Dockerfile.cli`, `image_templates` → `registry.acme.example/acme/cli-runner:{{ .Tag }}-legacy-node22` (+ `:latest`), same build labels. Keep the existing worker image entry unchanged.
  - Ensure the release build passes the **build secret `registry_token`** to BOTH images (worker also needs the CLI tool). Update `.github/workflows/release.yml` accordingly (BUILDKIT=1, secret wiring).

  **Must NOT do**: change the worker image name/tags; leak the token into logs/layers.

  **Recommended Agent Profile**: **Category** `deep` (release tool + build secrets). Skills: [].

  **Parallelization**: YES · Wave 3 · Blocks: T14,F3 · Blocked By: T4,T7.

  **References**: widget-service `.releasetool.yml` + `release.yml`; scheduler repo `push_to_registry.yml`. (WHY: dual-image + secret pattern.)

  **Acceptance Criteria**:
  - [ ] `releasetool check` valid; `releasetool release --snapshot --clean --skip=publish` builds BOTH images; cli tagged `*-legacy-node22`.
  - [ ] worker image name/tags unchanged in config diff.

  **QA Scenarios**:
  ```
  Scenario: two images from one binary; cli tag + secret wired
    Tool: Bash
    Steps:
      1. releasetool check
      2. REGISTRY_TOKEN=... BUILDKIT=1 releasetool release --snapshot --clean --skip=publish
      3. docker images | assert worker AND acme/cli-runner:*-legacy-node22
      4. git diff .releasetool.yml | assert worker entry unchanged
    Expected Result: both images build; worker config untouched
    Failure Indicators: secret failure; worker tags changed; missing cli tag
    Evidence: .sisyphus/evidence/task-8-releasetool2.txt
  ```
  **Evidence to Capture**: [ ] task-8-releasetool2.txt

  **Commit**: YES — `build: add cli image target + registry_token build secret in release` · files: `.releasetool.yml,.github/workflows/release.yml` · Pre-commit: `releasetool check`

  <!-- REFRAME NOTE (T8b, pending — handled inside T-RELEASE): T8 shipped the cli image tag as `{{.Tag}}-legacy-node22`. The reframe renames this repo's image suffix `-legacy-` → `-prod-`, i.e. `{{.Tag}}-prod-node22`. T8 stays [x] (shipped via PR #12 stack) and must NOT be un-checked; the suffix rename is a follow-up folded into T-RELEASE. The scheduler's `-legacy-2024` VERSION scheme is a DIFFERENT repo (acme/scheduler, OUT OF SCOPE) and is left as-is. -->

- [x] T-WIDGET-CORE. Dockerfile.worker HERE — worker RUNNER image (runtime consumed via FROM, CLI tool, LD_LIBRARY_PATH)  <!-- DONE commit 9c0d1e2 (branch feat/worker-image, stacked on feat/cli-releasetool/T8). Dockerfile.worker: builder (=Dockerfile.cli) + FROM acme/base-runtime:2024-stable AS runtime (consumed, NOT rebuilt) + clitool stage (=Dockerfile.cli, registry_token) + final debian:slim: COPY --from=runtime /opt/runtime, runtime apt libs, locale en_US.UTF-8, LD_LIBRARY_PATH, hide-libstdc++, COPY --from=builder binary, COPY --from=clitool, ENTRYPOINT binary. NO EXPOSE 4000. VERIFIED against real scheduler Dockerfile: apt libs / LD_LIBRARY_PATH / locale / hide-libstdc++ BYTE-IDENTICAL; binary from OUR builder; scheduler cron/supervisor labels dropped. hadolint clean; buildx --check ok. Signed; not pushed. Evidence: .sisyphus/evidence/task-worker-img.txt -->
- [x] D-MULTI-REGION RESOLVED: cross-region mirroring (us-east-1 → eu-west-1) already in place & relied upon. This repo pushes us ONLY; EU consumes mirrored copies. NO push matrix. T14 values-eu keeps eu-west-1 refs.

  **What to do**:
  - Add a NET-NEW `Dockerfile.worker` in widget-service (`# syntax=docker/dockerfile:1`), mirroring the shipped `Dockerfile.cli` structure and the current `acme/scheduler` Dockerfile's worker-specific stages (draft line 69), but producing a RUNNER image (queue-driven), NOT the scheduler:
    - Builder stage `FROM golang:2024-slim` builds the binary (CGO off) — reuse the exact builder from `Dockerfile.cli`.
    - **Runtime stage: `FROM acme/base-runtime:2024-stable as runtime`** — CONSUME it; later `COPY --from=runtime /opt/runtime /opt/runtime`. **Do NOT rebuild the runtime.**
    - **CLI-tool stage** identical to `Dockerfile.cli` (`FROM debian:slim as clitool`, `gh release download ${TOOL_VERSION}` from `acme/cli-tool`, `--mount=type=secret,id=registry_token`).
    - Final stage `FROM debian:slim` (matching the scheduler final base): `COPY --from=runtime /opt/runtime`, install runtime apt libs (`libglu1-mesa`, `libxrandr2`, `libxt6`, …), set locale `en_US.UTF-8`, set `LD_LIBRARY_PATH` for the runtime, apply the hide-runtime-`libstdc++` workaround, `COPY --from=builder` binary → `/usr/local/bin/widget-service`, `COPY --from=clitool /usr/local/bin/clitool`, `ENTRYPOINT` the binary. **NO `EXPOSE 4000`** unless a probe needs it (see D-EXPOSE-PORT).
  - Build locally with `docker buildx build -f Dockerfile.worker --secret id=registry_token,env=REGISTRY_TOKEN` (needs `acme/base-runtime:2024-stable` pullable).

  **Must NOT do**: rebuild the runtime from source (consume via `FROM`); edit `acme/scheduler` (OUT OF SCOPE); touch `Dockerfile.cli`, the base minimal worker `Dockerfile`, or `internal/worker` runtime behavior; add `EXPOSE 4000` without justification.

  **Recommended Agent Profile**: **Category** `unspecified-high` (Docker multi-stage + runtime `FROM` + build secret + `LD_LIBRARY_PATH`). Skills: [].

  **Parallelization**: YES · Wave A · Blocks: T-RELEASE, T-INFRATEST, T9 · Blocked By: T7 (mirror source) — soft.

  **References**:
  - scheduler repo Dockerfile stages (draft line 69): `FROM acme/base-runtime:2024-stable` + apt libs + locale + `LD_LIBRARY_PATH` + hide-runtime-libstdc++ + `COPY --from=worker` + `COPY --from=clitool`. (WHY: exact worker-specific stages; only the runtime stage + libs + LD_LIBRARY_PATH are worker-specific, rest generic.)
  - shipped `Dockerfile.cli` (builder + clitool stage + build secret pattern; notepad T7). (WHY: consistency with image #2.)
  - REFRAME item 4 + guardrails (runtime consumed not rebuilt; scheduler untouched; no EXPOSE 4000 by default). (WHY: constraints.)

  **Acceptance Criteria**:
  - [ ] `docker buildx build -f Dockerfile.worker --secret id=registry_token,env=REGISTRY_TOKEN -t worker:qa .` succeeds.
  - [ ] In image: `/opt/runtime/libcore.so` PRESENT; `clitool --version` exit 0; ENTRYPOINT = the binary; `Dockerfile.worker` uses `FROM acme/base-runtime` (no runtime-from-source build layers).

  **QA Scenarios**:
  ```
  Scenario: worker runner image has runtime (via FROM) + CLI tool, runtime not rebuilt
    Tool: Bash (buildx + docker run + history + grep)
    Steps:
      1. grep 'FROM acme/base-runtime:2024-stable' Dockerfile.worker ; assert present (consumed)
      2. buildx build -f Dockerfile.worker --secret id=registry_token,env=REGISTRY_TOKEN -t worker:qa .
      3. docker run --rm worker:qa sh -c 'test -e /opt/runtime/libcore.so && echo HAS_RUNTIME; clitool --version'
      4. assert HAS_RUNTIME + clitool exit0 ; assert no EXPOSE 4000 unless justified
    Expected Result: runtime present via FROM, CLI tool present, binary entrypoint
    Failure Indicators: runtime missing; runtime built from source; scheduler edited; clitool missing
    Evidence: .sisyphus/evidence/task-worker-img.txt
  ```
  **Evidence to Capture**: [ ] task-worker-img.txt

  **Commit**: YES — `build: Dockerfile.worker (runtime via FROM, CLI tool, LD_LIBRARY_PATH)` · files: `Dockerfile.worker` · Pre-commit: `docker buildx build -f Dockerfile.worker --secret id=registry_token,env=REGISTRY_TOKEN -t worker:qa .`

- [x] T-RELEASE. ReleaseTool 3rd image (worker) + lockstep single-tag `-prod-` suffixes + T8b cli rename  <!-- DONE commit 0d1e2f3 (branch feat/worker-release, stacked on feat/worker-image). .releasetool.yml: +3rd images entry acme/worker:{latest,{{.Tag}}-prod-2024} via Dockerfile.worker + --secret=id=registry_token; T8b rename cli {{.Tag}}-legacy-node22→-prod-node22. Base minimal base-runtime entry BYTE-UNCHANGED (verified). Lockstep intact (one images block, all 3 share {{.Tag}}; NO per-image IDs). release.yml UNCHANGED (BUILDKIT=1 + REGISTRY_TOKEN=API_TOKEN already env → covers 3rd build). releasetool check validated. grep legacy=0. Full 3-image snapshot build deferred to CI. Signed; not pushed. Evidence: .sisyphus/evidence/task-release.txt -->
  <!-- T8b (cli -legacy-→-prod- rename) COMPLETED here inside T-RELEASE. -->
- [x] T8b [folded into T-RELEASE]. Rename shipped cli image tag suffix -legacy-node22 → -prod-node22 (.releasetool.yml L39, commit 0d1e2f3). T8 itself stays [x] (shipped as -legacy- via PR #12; suffix corrected here).

  **What to do**:
  - Add a THIRD entry to `.releasetool.yml` `images:` using `dockerfile: Dockerfile.worker`, `image_templates` → `registry.acme.example/acme/worker:{{ .Tag }}-prod-2024` (+ `:latest`), same `extra_files`(go source) pattern as the cli entry. Keep the base minimal `base-runtime:{{ .Tag }}` entry unchanged.
  - **T8b (rename)**: change the cli `images:` entry's tag suffix `{{ .Tag }}-legacy-node22` → `{{ .Tag }}-prod-node22`.
  - **Lockstep single-tag**: confirm ONE git tag `vX.Y.Z` drives ALL `image_templates` (do NOT add per-image IDs / skip toggles to decouple cadence).
  - Ensure the release build passes the **build secret `registry_token`** to BOTH the cli AND the new worker image builds. Extend the shipped T8 wiring in `.github/workflows/release.yml` (`BUILDKIT=1`, `REGISTRY_TOKEN=${{ secrets.API_TOKEN }}`) to the 3rd image.

  **Must NOT do**: change the base minimal `base-runtime` image name/tags; give images independent versions; edit `acme/scheduler`; leak the token into logs/layers.

  **Recommended Agent Profile**: **Category** `deep` (release tool + build secrets + lockstep tag semantics). Skills: [].

  **Parallelization**: YES · Wave A · Blocks: T-DOCS, T10, T14, F3 · Blocked By: T-WIDGET-CORE.

  **References**: widget-service `.releasetool.yml` (shipped 2-`images` config + T8 registry_token wiring; notepad T8) + `release.yml`; REFRAME items 4–5 (3rd image + `-prod-` suffix + lockstep); draft line 45 (one-tag→all-images). (WHY: extend to 3rd image without decoupling cadence.)

  **Acceptance Criteria**:
  - [ ] `releasetool check` valid; `releasetool release --snapshot --clean --skip=publish` builds ALL 3 images from one tag; cli `*-prod-node22`, worker `*-prod-2024`.
  - [ ] base minimal `base-runtime` entry unchanged in diff; no per-image version divergence introduced.

  **QA Scenarios**:
  ```
  Scenario: three images from one tag; -prod- suffixes; lockstep
    Tool: Bash
    Steps:
      1. releasetool check
      2. REGISTRY_TOKEN=... BUILDKIT=1 releasetool release --snapshot --clean --skip=publish
      3. docker images | assert base-runtime(base) AND acme/cli-runner:*-prod-node22 AND acme/worker:*-prod-2024
      4. git diff .releasetool.yml | assert base minimal entry unchanged, cli suffix now -prod-, worker entry added
    Expected Result: 3 images, one tag, -prod- suffixes, base entry untouched
    Failure Indicators: independent versions; -legacy- left on cli; base entry changed; scheduler touched
    Evidence: .sisyphus/evidence/task-release.txt
  ```
  **Evidence to Capture**: [ ] task-release.txt

  **Commit**: YES — `build: 3rd (worker) image + lockstep -prod- tags (rename cli suffix)` · files: `.releasetool.yml,.github/workflows/release.yml` · Pre-commit: `releasetool check`

- [x] T-DOCS. Move chart HERE + publish-chart.yaml (registry OCI)  <!-- DONE commit 1e2f3a4 (branch feat/worker-chart, stacked on feat/worker-release). charts/widget-service/{Chart.yaml,values.yaml,values-worker.yaml,values-cli.yaml,templates/{NOTES.txt,external-secret,rbac,scaled-job,service-account,trigger-authentication}.yaml} copied BYTE-IDENTICAL from acme/platform-scheduler. worker image ref kept VERBATIM acme/scheduler:5.9.0-legacy-2024 (byte-identical render guardrail; repoint deferred to T10/T14). publish-chart.yaml: push-master(Chart.yaml gated)+dispatch, helm v3.14.4, login+push oci://registry.acme.example/acme (namespace PINNED), secret REGISTRY_TOKEN, checkout@v7. helm lint 0-failed; both templates render; actionlint clean. Chart version 0.12.1. Signed; not pushed. Evidence: .sisyphus/evidence/task-docs.txt -->

  **What to do**:
  - Add `charts/widget-service/` to THIS repo (the language-agnostic chart currently in the scheduler repo: `Chart.yaml`, `values.yaml`, `values-worker.yaml`, `values-cli.yaml`, `templates/*`). It is already "worker or CLI" generic (draft line 70) — copy faithfully; only the image tags shift to `-prod-` and to `acme/worker` / `acme/cli-runner`.
  - Add `.github/workflows/publish-chart.yaml` mirroring the scheduler repo's (draft line 68): Helm 3.14.x, login `registry.acme.example` with `REGISTRY_TOKEN`, `helm package charts/widget-service` + `helm push .tgz oci://registry.acme.example/acme`. Chart version derives from the lockstep tag's `X.Y.Z`.
  - **Note (do NOT edit those repos here)**: the deploy chart-dependency `repository:` becomes a ONE-LINE re-point to THIS repo's registry namespace (applied in T14). The scheduler repo must STOP double-publishing the chart (D-DOCS-PUBLISH) — cross-repo follow-up, not done here.

  **Must NOT do**: alter worker RUNTIME chart behavior (worker render byte-identical); edit the scheduler repo; double-publish; hardcode secrets.

  **Recommended Agent Profile**: **Category** `deep` (Helm packaging + registry OCI publish). Skills: [].

  **Parallelization**: YES · Wave B · Blocks: T10, T11, T14 · Blocked By: T-RELEASE (image tags the chart references) — soft.

  **References**: draft lines 52–54, 64, 68, 70, 74 (chart is the cleanest thing to move; publish-chart.yaml; language-agnostic; registry OCI `oci://registry.acme.example/acme`; `REGISTRY_TOKEN`). (WHY: chart-move mechanics + publish target.)

  **Acceptance Criteria**:
  - [ ] `helm lint charts/widget-service` + `helm template` (both values files) render; worker render byte-identical to the pre-move chart.
  - [ ] `publish-chart.yaml` present + `actionlint`-clean; pushes to `oci://registry.acme.example/acme` with chart version = tag `X.Y.Z`.

  **QA Scenarios**:
  ```
  Scenario: chart lives + publishes here; worker render unchanged
    Tool: Bash (helm + actionlint)
    Steps: helm lint; helm template -f values-worker.yaml (diff vs source chart → empty); helm template -f values-cli.yaml (image -prod-); actionlint publish-chart.yaml; grep REGISTRY_TOKEN + oci push
    Evidence: .sisyphus/evidence/task-docs.txt
  ```
  **Evidence to Capture**: [ ] task-docs.txt

  **Commit**: YES — `feat(chart): host widget-service chart + publish-chart workflow` · files: `charts/widget-service/*,.github/workflows/publish-chart.yaml` · Pre-commit: `helm lint && actionlint`

<!-- MERGE NOTE 2026-08-10: T1-T8 + T-WIDGET-CORE + T-RELEASE(+T8b) + T-DOCS all MERGED to master via squash PR #12 (commit f8b241a). Stack folded in + closed. publish-chart.yaml uses REGISTRY_TOKEN→oci://registry.acme.example/acme, idempotent registry-check gate, Chart.yaml seeded 0.0.1-alpha. master green. -->
- [x] T-INFRATEST. infra harness + specs for all 3 images + ci_infra_tests.yml  <!-- DONE commit 2f3a4b5 (branch feat/infra-tests off master f8b241a). tests/{.rspec,.gitignore,Gemfile,Rakefile,spec/spec_helper.rb} mirrored verbatim from scheduler repo; spec/{base,cli,worker}/dockerfile_spec.rb + .github/workflows/ci_infra_tests.yml. cli spec: /opt/runtime ABSENT + tools + node22 + clitool + uid999 (RAN LOCALLY 15/0 green). worker spec: /opt/runtime/libcore.so PRESENT + runtime libs + clitool + LC_ALL + LD_LIBRARY_PATH (CI-deferred). base spec: minimal → docker-inspect Entrypoint + uid (RAN LOCALLY 3/0 green). ci_infra_tests: PR trigger, [no e2e] skip, local registry :5000, registry_token=API_TOKEN for clitool. actionlint clean; go build green. Signed; pushed. Evidence: .sisyphus/evidence/task-infratest.txt -->
  <!-- NOTE: ci_infra_tests.yml fires on pull_request → needs a PR opened for CI to run the specs. -->
  <!-- MERGED 2026-08-10 via PR #13 → master 30cf1f9. Two CI fixes en route: (a) libxt6→libxt6t64 (Debian t64 rename), (b) rewrote ci_infra_tests.yml as a per-image MATRIX {base,cli,worker} — fixed a cross-image spec resolution collision AND parallelized worker vs cli. All 3 legs green. -->

  **What to do**:
  - Add `tests/` harness matching the worker's precedent (draft line 66): `Gemfile`, `.rspec`, `Rakefile` (auto-discovers `spec/<target>/`), `spec/spec_helper.rb` (`get_docker_image(tag, build_mode, path, dockerfile)`, entrypoint overridden to `sleep infinity`).
  - Specs for ALL 3 images:
    - `spec/cli/dockerfile_spec.rb`: CLI tool present + `clitool --version` exit 0; npm/pnpm/yarn/node present; node 22; **`/opt/runtime` ABSENT**.
    - `spec/worker/dockerfile_spec.rb`: **runtime `/opt/runtime/libcore.so` present**; CLI tool present; runtime apt libs (`libglu1-mesa`/`libxrandr2`/`libxt6t64`); locale.
    - `spec/base/dockerfile_spec.rb`: the binary present (minimal).
  - Add `.github/workflows/ci_infra_tests.yml` mirroring the scheduler repo's: PR trigger (skip if title `[no e2e]`), local registry `:5000`, `buildx build` each Dockerfile → `localhost:5000/<img>:rspec`, `BUILD_MODE=pull bundle exec rspec spec`. The worker spec needs `acme/base-runtime` pulled + `registry_token` for the CLI tool.

  **Must NOT do**: assert on `acme/scheduler` (OUT OF SCOPE); require runtime in the cli spec; add e2e that needs a license beyond image-structure.

  **Recommended Agent Profile**: **Category** `unspecified-high` (harness + buildx-in-CI + local registry). Skills: [].

  **Parallelization**: YES · Wave B · Blocks: F1, F3 · Blocked By: T-WIDGET-CORE + T7 (needs all 3 Dockerfiles).

  **References**: draft line 66 (worker specs: Gemfile/.rspec/Rakefile/spec_helper `get_docker_image`/dockerfile_spec assertions incl `/opt/runtime/libcore.so` + `clitool --version`; ci_infra_tests.yml local-registry buildx flow). (WHY: convention + per-image assertions to mirror.)

  **Acceptance Criteria**:
  - [ ] `bundle exec rspec spec` (BUILD_MODE=pull) green for cli(no runtime)/worker(runtime present)/base(binary).
  - [ ] `ci_infra_tests.yml` `actionlint`-clean; builds all 3 images; skips on `[no e2e]`.

  **QA Scenarios**:
  ```
  Scenario: specs assert runtime-in-worker, no-runtime-in-cli, binary-in-base
    Tool: Bash (buildx + rspec + actionlint)
    Steps: build 3 images to local registry; rspec spec → cli asserts !/opt/runtime, worker asserts /opt/runtime/libcore.so + clitool, base asserts binary; actionlint ci_infra_tests.yml
    Evidence: .sisyphus/evidence/task-infratest.txt
  ```
  **Evidence to Capture**: [ ] task-infratest.txt

  **Commit**: YES — `test(infra): specs for cli/worker/base images + ci_infra_tests` · files: `tests/*,.github/workflows/ci_infra_tests.yml` · Pre-commit: `actionlint && (cd tests && bundle exec rubocop || true)`

- [x] 10. [CHART — new home HERE] values-cli.yaml (all tiers) [RE-SCOPED by reframe]  <!-- DONE + MERGED PR #14 → master 918a8ff. commit 462d505 (branch feat/values-cli-all-tiers). All 6 tiers active w/ confirmed queue URLs; image 2.0.0-prod-node22; ephemeralStorage mirrors worker per-tier; CPU REQUEST ramp (user decision): xs/s/m=500m, l/xl/xxl=1000m — NO cpu limit. keda.secretName LEFT cli-keda-secrets for T11. values-worker.yaml untouched. helm lint 0-failed; 6 ScaledJobs render. Evidence: task-10 (render proof in PR #14). -->

  **What to do**:
  - Complete `charts/widget-service/values-cli.yaml` **in the chart's NEW home HERE** (moved by T-DOCS; NO LONGER the scheduler repo): enable all tiers s/m/l/xl/xxl with correct `cli-jobs-{tier}` queue URLs (verify names vs infra-repo), per-tier resources (mirror values-worker unless cli differs), image `acme/cli-runner:{ver}-prod-node22` (**note `-prod-`, per T8b/T-RELEASE**), `nodePool: cli-jobs`, `sidecar.enabled: true` (base minimal base-runtime image + `CONTAINER_NAME=cli-runner`), `keda.secretName` per T11 (reuse worker secret).
  - `helm lint` + `helm template -f values-cli.yaml` render valid ScaledJobs + sidecar + external-secret/trigger-auth.

  **Must NOT do**: modify values-worker.yaml or worker template behavior; invent queue URLs; edit the scheduler repo (chart lives here now).

  **Recommended Agent Profile**: **Category** `deep`. Skills: [].

  **Parallelization**: YES · Wave C · Blocks: T11,T14,F1 · Blocked By: T-DOCS (chart home), T-RELEASE (image tag/suffix).

  **References**: scheduler repo source `values-cli.yaml`+`values-worker.yaml` — copied here by T-DOCS; infra-repo real URLs; T-RELEASE `-prod-` image tag; sidecar CONTAINER_NAME. (WHY: complete to worker parity in the new home.)

  **Acceptance Criteria**:
  - [ ] `helm lint` + `helm template -f values-cli.yaml` → ScaledJob per tier + sidecar (CONTAINER_NAME=cli-runner) + correct SA/nodePool/queues/image tag `*-prod-node22`.

  **QA Scenarios**:
  ```
  Scenario: cli values render all tiers + sidecar
    Tool: Bash (helm)
    Steps: helm lint; helm template -f values-cli.yaml | assert ScaledJob per tier, queues cli-jobs-*, sidecar CONTAINER_NAME=cli-runner, SA cli-runner-sa, nodePool cli-jobs, image *-prod-node22
    Evidence: .sisyphus/evidence/task-10-values.txt
  ```
  **Evidence to Capture**: [ ] task-10-values.txt

  **Commit**: YES (widget-service branch — chart home) — `feat(chart): complete values-cli.yaml (all tiers)` · files: `charts/widget-service/values-cli.yaml` · Pre-commit: `helm lint && helm template`

- [x] 11. [CHART — new home HERE] keda.secretName: separate per-ns secret from SAME store property [RE-SCOPED — user twist]  <!-- DONE (VERIFICATION-ONLY, no code change, no PR). The plan's original "reuse ONE worker secret" premise was a MISREAD of the chart. USER TWIST (correct): worker & cli run in SEPARATE namespaces, and KEDA TriggerAuthentication + its secret are namespace-scoped → cli CANNOT read worker's secret. So: SAME store property (nothing new) but a SECOND, cli-namespace-scoped K8s secret. The chart ALREADY implements this. T10 already set values-cli.yaml keda.secretName: cli-keda-secrets. VERIFIED via helm template: worker render BYTE-IDENTICAL. helm lint 0-failed. git status clean. -->
  <!-- NOTE for T14/deploy: cli-jobs KEDA scaler consumes cli-keda-secrets in the cli namespace. No deploy secret wiring needed beyond deploying the chart into ns cli. -->

  **What to do**:
  - **In the chart's NEW home HERE** (moved by T-DOCS): inspect how worker KEDA auth is templated (`TriggerAuthentication`/`ExternalSecret`, driven by `keda.secretName`? namespaced vs Cluster). Choose the mechanism so cli REUSES worker's shared store `WORKER_CLI_RUNNER` creds without a new credential. Set `values-cli.yaml keda.secretName` accordingly. worker render must be byte-identical.

  **Must NOT do**: create a new store cred; change worker output; hardcode cli into shared templates; edit the scheduler repo (chart lives here now).

  **Recommended Agent Profile**: **Category** `deep`. Skills: [].

  **Parallelization**: YES · Wave C · Blocks: T14,F1 · Blocked By: T10 (same chart PR here).

  **References**: `charts/widget-service/templates/{external-secret,trigger-authentication}.yaml`+base `values.yaml keda.secretName`; deploy ClusterSecretStore + store `WORKER_CLI_RUNNER`; values-worker `keda.secretName`. (WHY: reuse mechanism.)

  **Acceptance Criteria**:
  - [ ] `helm template -f values-worker.yaml` byte-identical before/after.
  - [ ] `helm template -f values-cli.yaml` KEDA auth reuses worker creds (no new store cred). Mechanism documented.

  **QA Scenarios**:
  ```
  Scenario: cli reuses worker KEDA creds; worker unchanged
    Tool: Bash (helm)
    Steps: diff worker render before/after → EMPTY; cli render references shared secret (not a new store-backed one)
    Evidence: .sisyphus/evidence/task-11-keda.txt
  ```
  **Evidence to Capture**: [ ] task-11-keda.txt

  **Commit**: YES (same PR as T10) — `feat(chart): keda.secretName param so cli reuses worker secret` · files: `charts/widget-service/templates/*, values-cli.yaml, Chart.yaml(bump)` · Pre-commit: `helm lint && helm template (both)`

- [x] 12. [CROSS-REPO infra-repo] cli NodeClass + `cli_image_cache_snapshot_id` [intent unchanged]  <!-- DONE commit 3a4b5c6 (acme/infra-repo branch feat/cli-nodeclass, off master 7b16b6e; PUSHED, no PR yet). +modules/cluster/variables.tf (cli_image_cache_snapshot_id default "", cli_sandbox_image, ebs_size_cli) + karpenter.tf node_class_cli (count = snapshot!=""?1:0, name: cli, identical userData/mount/pinned sandbox, /dev/xvdb snapshotID) + cluster-{us,eu}-jobs.tf pass cli_image_cache_snapshot_id="" + README rows. VERIFIED: additions-only (+160/-0), worker nodeclass/var BYTE-UNCHANGED. terraform validate green (offline); fmt clean; tflint clean. plan deferred. Signed. Evidence: task-12-nodeclass.txt -->
  <!-- T13 NOTE: cli-jobs NodePool must set nodeClassRef.name: cli + taint acme.example/cli-jobs (taint lives on NodePool, worker nodeclass has none). -->
  <!-- T9 NOTE: disk snapshot workflow writes cli_image_cache_snapshot_id back into cluster-{us,eu}-jobs.tf (currently ""); regional distinct ids. -->
  <!-- NOTE: PR #494 MERGED to infra-repo master (merge commit b77c66b). cli NodeClass + cli_image_cache_snapshot_id now on master (inert until T9 fills snapshot ids). -->

  **What to do**:
  - Mirror the worker NodeClass + image-cache (draft lines 34-35, 41): add a `cli` NodeClass and a `cli_image_cache_snapshot_id` variable (per `modules/cluster`, `count = snapshot_id != "" ? 1 : 0`) that, when set, creates the `cli` nodeclass attaching the pre-warmed snapshot at `/dev/xvdb`; SET the var per-cluster in `cluster-us-jobs.tf` + `cluster-eu-jobs.tf` (regional, distinct ids); default empty (skip) until T9's dual matrix produces snapshots. worker NodeClass + `worker_image_cache_snapshot_id` unchanged.

  **Must NOT do**: change worker nodeclass/var; provision queue/identity (exist); edit `acme/scheduler`.

  **Recommended Agent Profile**: **Category** `deep`. Skills: [`terraform-skill`] — TF module/variable authoring + review (direct overlap).

  **Parallelization**: YES · Wave B · Blocks: T13,T9 · Blocked By: None.

  **References**: infra-repo `modules/cluster/{karpenter.tf,variables.tf,README.md}` (worker nodeclass L115-223 + `worker_image_cache_snapshot_id` L174-191, set in `cluster-{us,eu}-jobs.tf`); T9 dual-image snapshot workflow (writes BOTH vars back). (WHY: mirror the conditional worker nodeclass; cli gap per draft line 41.)

  **Acceptance Criteria**:
  - [ ] `terraform validate`; plan shows `cli` nodeclass created iff `cli_image_cache_snapshot_id` set; worker unchanged.

  **QA Scenarios**:
  ```
  Scenario: conditional cli nodeclass, no worker drift
    Tool: Bash (terraform)
    Steps: validate; plan with var="" (no nodeclass, worker unchanged); plan with var="snap-x" (creates cli nodeclass, worker unchanged)
    Evidence: .sisyphus/evidence/task-12-nodeclass.txt
  ```
  **Evidence to Capture**: [ ] task-12-nodeclass.txt

  **Commit**: YES (infra-repo branch) — `feat(karpenter): cli NodeClass + image-cache var` · files: `modules/cluster/{karpenter.tf,variables.tf,README.md},cluster-*-jobs.tf` · Pre-commit: `terraform validate`

- [ ] 15. Docs + archive legacy-widget-cli [EXPANDED by reframe]

  **What to do**:
  - In widget-service: update `README.md`/`AGENTS.md` to document the `cli` subcommand, the **THREE images** (base minimal `base-runtime` = binary/sidecar; `acme/cli-runner:*-prod-node22` = cli+CLI tool, **runtime-free**; NEW `acme/worker:*-prod-2024` = runtime-via-`FROM`+CLI tool), the **lockstep single-tag `-prod-` release**, the **chart now hosted here** (`publish-chart.yaml`, registry OCI), the **infra tests**, and the shared contract (`docs/contract.md`). State explicitly that `acme/scheduler` is OUT OF SCOPE and the runtime is consumed via `FROM`, not rebuilt.
  - In `acme/legacy-widget-cli` (THIS repo): add an archive/deprecation notice to `README.md` pointing to widget-service; then archive the GitHub repo. Note: this plan's `.sisyphus/` lives here; archiving is the final action after execution completes.

  **Must NOT do**: delete history; break the worker docs; imply the scheduler is being edited or the runtime removed.

  **Recommended Agent Profile**: **Category** `writing`. Skills: [].

  **Parallelization**: YES · Wave C · Blocks: none · Blocked By: T-RELEASE, T-DOCS, T-INFRATEST.

  **References**: widget-service AGENTS.md; scheduler repo README CLI-tool note; this repo README (legacy); REFRAME subsection (lockstep/3-image/scheduler-out-of-scope). (WHY: doc parity + retirement + reframe.)

  **Acceptance Criteria**:
  - [ ] widget-service README documents cli mode + all 3 images (runtime-free cli + runtime-bearing worker + base) + lockstep `-prod-` release + chart-here + infra tests. `docs/contract.md` complete.
  - [ ] Docs state scheduler is out-of-scope and runtime is consumed via `FROM` (not rebuilt/removed).
  - [ ] legacy-widget-cli README has deprecation pointer; repo archived (final step).

  **QA Scenarios**:
  ```
  Scenario: docs complete + deprecation pointer
    Tool: Bash
    Steps: grep README for "cli" subcommand + "no runtime"/"CLI tool"; grep this-repo README for "archived"/widget-service
    Evidence: .sisyphus/evidence/task-15-docs.txt
  ```
  **Evidence to Capture**: [ ] task-15-docs.txt

  **Commit**: YES — widget-service: `docs: cli mode + dual-image + contract`; legacy-widget-cli: `docs: deprecate in favor of widget-service` · Pre-commit: none

- [x] 13. [CROSS-REPO deploy] cli-jobs NodePools (us-jobs + eu-jobs)  <!-- DONE commit 4b5c6d7 (acme/deploy-repo branch feat/cli-jobs-nodepool off master fa89131; PR #2324 open). Added autoscaling/{us,eu}-jobs/cli-jobs.yaml — each mirrors ITS region's worker-jobs.yaml with EXACTLY 4 identifier changes: metadata.name+label cli-jobs, nodeClassRef.name=cli (infra-repo T12), taint acme.example/cli-jobs:NoSchedule. Regional asymmetry PRESERVED: us has nodepool Exists req, eu doesn't. on-demand only; worker-jobs/default-nodepool/AppSet UNTOUCHED. kubectl --dry-run=client validated. Unsigned (deploy-repo has no signing). Evidence: task-13-nodepool.txt -->

  **What to do**:
  - Add `autoscaling/us-jobs/cli-jobs.yaml` + `autoscaling/eu-jobs/cli-jobs.yaml`, mirroring `worker-jobs.yaml` EXACTLY except: `name: cli-jobs`, label `nodepool: cli-jobs`, `nodeClassRef.name: cli` (T12), taint `acme.example/cli-jobs:NoSchedule`. Same requirements/limits/disruption/weight/expireAfter. Auto-deployed by existing `bootstrap/addons/autoscaling.yaml` (no AppSet change).

  **Must NOT do**: modify worker-jobs files or the autoscaling ApplicationSet; use spot.

  **Recommended Agent Profile**: **Category** `deep`. Skills: [].

  **Parallelization**: YES · Wave C · Blocks: F1 · Blocked By: T12 (NodeClass `cli`).

  **References**: deploy `autoscaling/{us,eu}-jobs/worker-jobs.yaml`; `bootstrap/addons/autoscaling.yaml`; chart tolerations/nodeSelector. (WHY: mirror + scheduling match.)

  **Acceptance Criteria**:
  - [ ] `kubectl --dry-run=client` valid; diff vs worker-jobs shows ONLY name/label/nodeClassRef/taint.

  **QA Scenarios**:
  ```
  Scenario: cli NodePools valid + minimal diff
    Tool: Bash (kubectl/yq)
    Steps: dry-run apply us+eu; yq diff vs worker-jobs → only name/nodepool-label/nodeClassRef/taint differ
    Evidence: .sisyphus/evidence/task-13-nodepool.txt
  ```
  **Evidence to Capture**: [ ] task-13-nodepool.txt

  **Commit**: YES (deploy branch) — `feat(autoscaling): add cli-jobs NodePool (us+eu)` · files: `autoscaling/{us-jobs,eu-jobs}/cli-jobs.yaml` · Pre-commit: `kubectl --dry-run=client`

- [x] 14. [CROSS-REPO deploy] charts/cli-runner wrapper + ApplicationSet  <!-- DONE commit 5c6d7e8 (acme/deploy-repo branch feat/cli-runner-wrapper off master e70c926; PR #2325 open, CI GREEN, REVIEW_REQUIRED). charts/cli-runner/{Chart.yaml (dep widget-service alias=cli version=0.0.1-alpha repository=oci://registry.acme.example/acme),values.yaml (top key cli:, SA cli-runner-sa, image acme/cli-runner:2.0.0-prod-node22, keda cli-keda-secrets, nodePool cli-jobs),values-{us,eu}-jobs.yaml (regional registry + 6 cli queue URLs each)} + bootstrap/addons/cli-runner.yaml (verbatim worker AppSet; diff=4 lines; clusters us-jobs+eu-jobs). worker UNTOUCHED. CI GREEN = dep resolved from registry + rendered cli Apps. Unsigned. Evidence: task-14-deploy.txt
  RESOLVED T14 blockers: (1) EU cli queues DO exist. (2) chart published oci://registry.acme.example/acme/widget-service:0.0.1-alpha (pinned). -->

  **What to do**:
  - Create `charts/cli-runner/{Chart.yaml (dep widget-service, same version as worker, alias cli),values.yaml,values-us-jobs.yaml,values-eu-jobs.yaml}` mirroring `charts/worker-runner/` — **chart dependency `repository:` RE-POINTED to `oci://registry.acme.example/acme`**, cli image `acme/cli-runner:{ver}-prod-node22` (**note `-prod-`**), region+registry per cluster (see D-MULTI-REGION — RESOLVED: mirroring; EU uses eu-west-1 refs), all `cli-jobs-{tier}` URLs, SA `cli-runner-sa`, nodePool cli-jobs, sidecar reuse (base minimal base-runtime image, CONTAINER_NAME=cli-runner), keda.secretName = worker's (T11).
  - Also RE-POINT the existing `charts/worker-runner/Chart.yaml` dependency `repository:` to `oci://registry.acme.example/acme` (same one-line move; worker wrapper otherwise unchanged) so both wrappers consume the chart from its new home.
  - Create `bootstrap/addons/cli-runner.yaml` ApplicationSet mirroring `worker-runner.yaml` (clusters us-jobs+eu-jobs, path charts/cli-runner/, valueFiles [values.yaml, values-{{.name}}.yaml], ns cli, CreateNamespace=true).

  **Must NOT do**: modify worker wrapper values/AppSet behavior (only the chart-dependency `repository:` line may move); hardcode secrets; invent queue URLs; resolve D-MULTI-REGION unilaterally.

  **Recommended Agent Profile**: **Category** `deep`. Skills: [].

  **Parallelization**: YES · Wave C · Blocks: F1,F3 · Blocked By: T-RELEASE(image tag/`-prod-`), T-DOCS(chart home/`repository:`), T10(values), T11(secret), T13(nodePool).

  **References**: deploy `charts/worker-runner/*`+`bootstrap/addons/worker-runner.yaml`; draft lines 52,59 (deploy chart dep `repository: oci://registry.acme.example/...`, one-line re-point); chart values-cli.yaml (tier resources); infra `cli-jobs-*` URLs. (WHY: mirror pattern + chart-home re-point + real values.)

  **Acceptance Criteria**:
  - [ ] `helm dependency update && helm lint charts/cli-runner`; `helm template` (us + eu) renders ScaledJobs per tier + sidecar (CONTAINER_NAME=cli-runner) + KEDA reuse; ns cli; SA cli-runner-sa; nodePool cli-jobs; correct region/queues/image tag `*-prod-node22`.
  - [ ] chart-dependency `repository:` (both cli + worker wrappers) points at THIS repo's registry namespace (chart-home move).
  - [ ] `bootstrap/addons/cli-runner.yaml` valid; diff vs worker-runner.yaml only name/path/ns/values.

  **QA Scenarios**:
  ```
  Scenario: deploy cli wrapper renders both clusters; chart dep re-pointed
    Tool: Bash (helm + kubectl dry-run)
    Steps: dep update; lint; template us (region us-east-1, queues, sidecar env, SA, nodePool, image *-prod-node22); template eu (eu-west-1); grep Chart.yaml repository: → this-repo registry; dry-run AppSet
    Evidence: .sisyphus/evidence/task-14-deploy.txt
  ```
  **Evidence to Capture**: [ ] task-14-deploy.txt

  **Commit**: YES (deploy branch) — `feat: cli-runner wrapper chart + AppSet (us+eu); re-point chart repository` · files: `charts/cli-runner/*,charts/worker-runner/Chart.yaml,bootstrap/addons/cli-runner.yaml` · Pre-commit: `helm lint && helm template && kubectl --dry-run`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents in PARALLEL. ALL must APPROVE. Present consolidated results and get explicit user "okay" before completing. Never check F1–F4 before the okay.

- [x] F1. **Plan Compliance Audit** — `oracle`  <!-- APPROVE (user okay 2026-08-12): Must-Have 5/5, Must-NOT 9/9 clean, tasks shipped (T15-archive deferred by user, in-scope). -->`
  Verify each Must-Have exists (read files, run `go test`, `docker run` ×3 images, `releasetool check`, `helm template`, `terraform validate`, `actionlint`). For each Must-NOT: grep for violations (runtime in CLI image, runtime rebuilt-from-source, `acme/scheduler` edited, images given independent versions, worker runtime drift, base-image rename, core duplication, new sidecar mode) → reject with file:line. Confirm evidence files + reframe tasks (T-WIDGET-CORE/T-RELEASE/T-DOCS/T-INFRATEST/T8b) present.
  Output: `Must Have [N/N] | Must NOT [N/N] | Tasks [N/N] | VERDICT`

- [x] F2. **Code Quality Review** — `unspecified-high`  <!-- APPROVE (user okay 2026-08-12): go build/vet/golangci-lint green, go test -race clean, no leaked secrets (registry_token via build --secret only), worker wire byte-identical. -->`
  `go build/vet ./...`, `golangci-lint`, `go test ./... -cover`. Review `internal/cli` + `Executor` seam + shared `internal/job` base for leaks (tickers/goroutines), error wrapping, AI slop. Review the 3 Dockerfiles + release tool + workflows (publish-chart, ci_infra_tests, build-disk-snapshot) for hadolint/actionlint cleanliness + no leaked `registry_token`. Confirm worker runtime packages behaviorally unchanged (git diff scope; wire byte-identical test).
  Output: `Build/Vet/Lint [..] | Tests [..] | cli-seam [clean/issues] | dockerfiles×3 [..] | worker-wire [identical?] | VERDICT`

- [x] F3. **Real Manual QA (local-stack + kind + all 3 images + lockstep)** — `unspecified-high`  <!-- APPROVE (user okay 2026-08-12): all 3 images pulled+probed (cli:noRuntime+clitool, worker:/opt/runtime/libcore.so+clitool, base:binary), local-stack/seed/kind harness ran e2e, lockstep tags aligned, disk run → infra-repo #498 merged. -->`
  Full e2e for cli mode (npm script AND bundled binary): queue→blob download→exec→blob upload→callback(meta.runner=cli)→delete→annotations; simulate OOM → reused sidecar cleanup. Build ALL 3 images: **cli has CLI tool + tools + NO /opt/runtime; NEW worker HAS /opt/runtime (via FROM acme/base-runtime) + CLI tool; base has binary**. specs ×3 green. `releasetool release --snapshot` → 3 images from ONE tag with aligned `-prod-` suffixes. worker e2e best-effort/structural. Edge cases: lease expiry, stall TERM→KILL, missing secretsRef, XML-vs-message executable, tenant. Evidence → `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N] | Images [cli:noRuntime+clitool, worker:runtime+clitool, base:binary] | Lockstep [tags aligned?] | Edge [N] | VERDICT`

- [x] F4. **Scope Fidelity + Parity + Worker/Scheduler-Untouched** — `deep`  <!-- APPROVE (user okay 2026-08-12): scheduler-untouched CLEAN (only #149 disk-drop, still OPEN), worker-runtime-untouched CLEAN, parity 6/6, cross-repo minimal-diff 5/5, lockstep+-prod- OK. -->`
  Spec vs diff per task (1:1, no creep). Parity vs pre-consolidation worker contract (queue/blob/annotations/notifier+meta.runner/secrets/env). Cross-repo minimal-diff: deploy cli-jobs vs worker-jobs, cli wrapper vs worker wrapper, chart-dependency `repository:` re-point, infra cli nodeclass, values-worker render. **Assert ZERO edits to `acme/scheduler` (out of scope) and ZERO worker RUNTIME drift across widget-service/deploy-repo/infra-repo.** Confirm runtime consumed via `FROM` (not rebuilt), base image name unchanged, `-prod-` suffix used, lockstep single-tag.
  Output: `Tasks [N/N] | Parity [N/N] | Cross-repo minimal-diff [N/N] | Scheduler-untouched [CLEAN] | Worker-runtime-untouched [CLEAN/N] | Lockstep+-prod- [OK] | VERDICT`

---

## Commit Strategy
Conventional commits per task, per repo, on feature branches. widget-service: front-half (T1–T8) shipped as a stacked PR chain; back-half additive (Dockerfile.worker, release tool 3rd image + `-prod-` rename, chart + publish-chart, specs + ci_infra_tests, dual-disk workflow) — worker runtime untouched. Cross-repo (T12 infra-repo; T13/T14 deploy-repo) each in their target repo's feature branch/PR. `acme/scheduler` gets NO commits. Pre-commit: `go test ./...` (Go), `releasetool check` (release), `helm lint`+`template` (charts), `terraform validate` (infra), `actionlint`/`hadolint` (workflows/Dockerfiles), `bundle exec rspec` (infra tests).

## Success Criteria

### Verification Commands
```bash
# widget-service — binary + all 3 images + lockstep release
go build ./... && go vet ./... && go test ./...
./widget-service --help            # lists worker, cli, sidecar, version
releasetool check
REGISTRY_TOKEN=... BUILDKIT=1 releasetool release --snapshot --clean --skip=publish  # 3 images, one tag
# cli image: CLI tool present, runtime ABSENT, -prod- tag
docker buildx build -f Dockerfile.cli --secret id=registry_token,env=REGISTRY_TOKEN -t cli:qa .
docker run --rm cli:qa sh -c 'clitool --version && test ! -e /opt/runtime && npm --version && node --version'
# NEW worker image: runtime PRESENT (via FROM), CLI tool present
docker buildx build -f Dockerfile.worker --secret id=registry_token,env=REGISTRY_TOKEN -t worker:qa .
docker run --rm worker:qa sh -c 'test -e /opt/runtime/libcore.so && clitool --version'
grep 'FROM acme/base-runtime:2024-stable' Dockerfile.worker   # runtime consumed, not rebuilt
# infra tests (all 3 images)
(cd tests && BUILD_MODE=pull bundle exec rspec spec)
# scheduler + worker runtime untouched
git diff --stat -- internal/worker               # (no behavioral change)
# NO edits to acme/scheduler in this plan's PRs
# chart + deploy render
helm lint charts/widget-service
helm template p charts/cli-runner -f charts/cli-runner/values-us-jobs.yaml   # image *-prod-node22
```

### Final Checklist
- [ ] All Must-Have present; all Must-NOT absent (runtime-free CLI image; runtime-bearing worker image via FROM; runtime NOT rebuilt; `acme/scheduler` UNTOUCHED; lockstep single-tag `-prod-`; worker runtime byte-unchanged).
- [ ] THREE images build from ONE tag; cli mode e2e green (local-stack+kind); worker e2e structural.
- [ ] infra tests green ×3; chart published from here; dual-image×dual-region disk matrix valid.
- [ ] deploy/infra render (cli nodeclass + NodePools + wrapper + chart-dep re-point); legacy-widget-cli archived.
- [ ] Decisions-needed resolved or explicitly deferred (esp. D-MULTI-REGION left OPEN by design).
