// GET /api/github-activity — repository activity for the hosted shell.
import { readGithubActivity } from './_github-activity-core.js';

export async function GET() {
  const body = await readGithubActivity();
  return new Response(JSON.stringify(body), {
    status: body.ok ? 200 : 502,
    headers: {
      'Content-Type': 'application/json',
      // Shared cache keeps unauthenticated calls well under GitHub's 60/hour.
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Vercel-CDN-Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
