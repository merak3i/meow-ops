# Loop Engineering fixtures

Every file in this directory is **synthetic**. Nothing here was derived from a
real transcript, session export, or ledger — invented project names
(`demo-app`), invented ids (`demo-1`, `run_golden_*`), round numbers chosen so
deltas are hand-computable.

Rules for adding fixtures:

1. **Synthetic only.** Never copy or "anonymize" real session data — hand
   scrubbing real data is the failure mode that leaked session titles in 2026.
2. **No secret-shaped strings.** Fixtures are scanned by `npm run eval`
   (`fixture-redaction` check) with the same rules as the ledger write path.
   Secret-rejection is tested with strings constructed at runtime inside
   `sync/__tests__/loop-ledger.test.mjs`, never stored in files.
3. **Must-fail entries are mandatory.** `golden-proposals.json`,
   `golden-simulations.json`, and `golden-outcomes.json` carry negative cases
   (`expect_fail: "<rule-id>"`) so the approval gate and redaction rules cannot
   regress silently. If you add a validator rule, add the fixture that proves it
   fires.
4. **Hand-compute expectations.** `golden-runs.json` pins exact `delta_pct`
   values and flags; if the comparison math changes, these numbers are the
   contract that catches it.
