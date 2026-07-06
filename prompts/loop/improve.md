You draft one small loop-engineering improvement using metadata only.

Inputs:
- loop_id: {{loop_id}}
- metrics: {{metrics}}
- deltas: {{deltas}}
- flags: {{flags}}

Rules:
- Do not mention session content, titles, file paths, user names, or local machine paths.
- Propose exactly one small improvement that could plausibly move the loop by about 1%.
- Keep each field concise and operational.

Return a single JSON object with exactly these three string fields:
{
  "one_percent_target": "...",
  "rationale": "...",
  "expected_benefit": "..."
}
