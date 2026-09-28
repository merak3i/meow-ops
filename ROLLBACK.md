# Rollback Runbook

This document covers three rollback strategies in order of preference.
Choose the one that fits the situation.

---

## Decision Tree

```
Production is broken?
│
├─ Yes — how urgent?
│   ├─ Urgent (users affected NOW)
│   │   └─ → Strategy 1: Vercel instant rollback (< 2 min, no code changes)
│   │
│   └─ Non-urgent (can take 5–10 min)
│       └─ → Strategy 2: Git revert (leaves clean audit trail)
│
└─ Development/staging only
    └─ → Strategy 3: Git tag checkout (local only, never force-push main)
```

---

## Executor Auto-Merge Rollback

Use this when an executor auto-merged PR broke something.

1. Find the PR that the executor merged:

   ```bash
   gh pr list --state merged --author @me --search "system:executor" --limit 10
   ```

2. Revert it:

   ```bash
   git revert <MERGE_COMMIT_SHA> --no-edit
   git push origin main
   ```

3. Record the rollback in the ledger:

   ```bash
   grep "applied" ~/.meow-ops/loop-ledger/proposals.jsonl | tail -5
   ```

4. Let the Loop Engineering status machine handle the rest:

   Mark the proposal `rolled_back` by appending a supersede via the Review Deck.
   The next `loop:capture` run records an outcome against the rolled-back
   decision.

### Auto-Merge Fence

Only `{test, prompt}` categories auto-merge. This is hard-coded in
`sync/loop-schema.mjs` as `AUTO_MERGE_CATEGORIES`. Widening the fence requires
a policy proposal through the Review Deck, not a config change.

### Prevention

Before approving a proposal for execution:

- Verify the diff is correct.
- Check that the simulation passed.
- For test proposals, the executor runs the test suite in a worktree, so a
  broken test fails gates before push.
- For prompt proposals, the target is under `prompts/`, so runtime code is not
  affected.

---

## Strategy 1 — Vercel Instant Rollback (Recommended for Production)

Vercel keeps every deployment. You can reactivate any previous one instantly.

### Via Dashboard (fastest)
1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Open the **meow-ops** project
3. Click **Deployments** tab
4. Find the last known-good deployment
5. Click **⋯** → **Promote to Production**
6. Done — DNS flips in < 30 seconds

### Via CLI
```bash
# Return production traffic to the previous production deployment
vercel rollback
vercel rollback status

# Inspect production deployment history
vercel list --prod
```

### Verification
- Open Today, Review, Ledger, Sanctum, and Learn; check that each surface loads without an error.
- Confirm the public session and cost endpoints contain synthetic demo data, not local session history.
- Confirm the Sanctum scene and guide load without Three.js errors.
- Confirm the focus timer chip opens and counts down.
- Check that the service worker registers and the PWA can be installed.

---

## Strategy 2 — Git Revert (Safe for Production, Auditable)

Creates a new commit that undoes the problematic change. Main branch history stays linear.

```bash
# Identify the bad commit(s)
git log --oneline -10

# Revert a single commit
git revert <commit-sha> --no-edit

# Revert a range of commits (newest first)
git revert <newest-sha>..<oldest-sha> --no-edit

# Push — triggers a new Vercel deployment automatically
git push origin main
```

**When to use**: When a specific commit introduced a bug and you want a traceable fix in git history.

**Do not use `git revert` for**: Config changes that need immediate rollback — use Strategy 1 instead while you prepare the revert.

---

## Strategy 3 — Git Tag Checkout (Development Only)

Use this locally to test against a previous known-good state.
**Never force-push to `main`.**

```bash
# List all version tags
git tag -l

# Check out a previous version locally
git checkout v1.0.0

# Create a branch from that tag to test fixes
git checkout -b fix/investigate-v1.0.0

# When done, return to main
git checkout main
```

### To redeploy from a tag (emergency, use with caution)
```bash
# Create a new branch from the tag
git checkout -b hotfix/rollback-to-v1.0.0 v1.0.0

# Push the branch — deploy it on Vercel as a preview first
git push origin hotfix/rollback-to-v1.0.0

# Only after verifying the preview, merge to main via PR
gh pr create --base main --head hotfix/rollback-to-v1.0.0 \
  --title "hotfix: rollback to v1.0.0" \
  --body "Emergency rollback — see incident notes"
```

---

## Version Tag Reference

| Tag | SHA | Date | Description |
|-----|-----|------|-------------|
| `v1.1.0` | _(current)_ | 2026-04-09 | Engineering hardening — format.ts, DB scaffolding, strict types |
| `v1.0.0` | `b62ea6e` | 2026-04-09 | Production baseline — analytics engine + companion v2 |

---

## Post-Rollback Checklist

- [ ] Today, Review, Ledger, Sanctum, and Learn load without errors
- [ ] Public session and cost endpoints serve synthetic demo data
- [ ] Sessions table loads and filters work
- [ ] Cost tracker charts render
- [ ] Sanctum scene and guide load without console errors
- [ ] Focus timer chip opens and counts down correctly
- [ ] Service worker registers and the PWA can be installed
- [ ] Public JSON endpoints return synthetic demo data with `no-store` and no permissive CORS header
- [ ] Local session sync remains local; Supabase Realtime is used only if explicitly configured

---

## Adding New Entries to This Table

Whenever you create a new release tag:
```bash
git tag -a v<X.Y.Z> -m "Release v<X.Y.Z>: <one-line summary>"
git push origin v<X.Y.Z>
```

Then add a row to the Version Tag Reference table above.

---

## Data Rollback Notes

Meow Ops reads session data from each enabled agent's native local store. Rolling back the app does **not** change those source logs. Hosted `public/data/demo-*` files are synthetic fixtures, not backups of local history.

`node sync/export-local.mjs` regenerates local metrics, but it also updates the local history/evidence archive and may call Cursor's read-only Usage API when its optional Admin key is configured. Treat it as a sync operation, not an automatic rollback step; verify the configured inputs before running it. Its `--push` option is retired. Supabase Realtime is optional transport for the Sanctum pipeline visualizer, not session-history storage or a default backup. `sync/upload-to-supabase.mjs` is a separate operator-managed tool.
