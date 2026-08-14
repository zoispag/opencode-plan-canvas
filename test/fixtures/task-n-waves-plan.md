# Widget Loader: verbose Task-N wave convention

## TL;DR

> **Quick Summary**: A tiny synthetic plan whose wave tree writes entries as
> `Task 1:` / `Task 2:` (with a space) instead of `T1:`/`1:`, while its TODOs
> use numbered ids `1.`, `2.`, `3.`. Exercises the parser's `Task N` id support.
> **Parallel Execution**: YES
> **Critical Path**: Task 1 → Task 2 → Task 3 → Final Verification

---

## Execution Strategy

### Parallel Execution Waves

```
Critical Path: Task 1 → Task 2 → Task 3
Wave 1 (start immediately, parallel):
├── Task 1: Branch + config file [quick]
└── Task 2: Loader exception class [quick]

Wave 2 (after Wave 1):
└── Task 3: Loader implementation [deep]

Wave FINAL (after ALL):
└── F1: Review the loader
```

## TODOs

- [x] 1. Add the branch and config file
  **What to do**: create the feature branch and the config file.
- [x] 2. Add the loader exception class
  **What to do**: add `IncompleteLoadException`.
- [ ] 3. Implement the loader
  **What to do**: implement the loader against the config.

## Final Verification Wave

- [ ] F1. **Review the loader** — `oracle`
