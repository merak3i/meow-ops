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
# List recent deployments
vercel ls meow-ops

# Promote a specific deployment URL to production
vercel promote <deployment-url> --scope <your-team>
```

### Verification
- Check PWA loads and can be installed from browser
- Verify session data loads (Overview stat cards show numbers)
- Confirm charts render (Daily Chart, Spend Chart)
- Check Companion tab loads without Three.js errors
- Confirm Pomodoro timer works

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

- [ ] PWA loads and installs from browser correctly
- [ ] Overview stat cards show correct token/cost data
- [ ] Sessions table loads and filters work
- [ ] Cost tracker charts render
- [ ] Companion tab loads (WebGL 3D scene renders without console errors)
- [ ] Pomodoro timer counts down correctly
- [ ] Service worker registers and cache is valid
- [ ] Data fetches from Supabase Storage (if cloud mode) or local JSON (if local mode)

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

meow-ops uses file-based session data. The source of truth is:
- **Local**: `~/.claude/projects/` (raw JSONL from Claude Code)
- **Cloud**: Supabase Storage bucket (if `VITE_SUPABASE_URL` is set)

Rolling back the app does **not** affect the data. If a sync script corrupted `sessions.json`:
1. Re-run `node sync/export-local.mjs` to regenerate from source JSONL files
2. Or restore the last known-good `sessions.json` from git history (if committed) or Supabase Storage version history
