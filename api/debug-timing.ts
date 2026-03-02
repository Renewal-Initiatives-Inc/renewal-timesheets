import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Temporary diagnostic endpoint to measure timing of each operation
 * in the auth + data fetch pipeline. DELETE after debugging.
 */
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const timings: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const t0 = Date.now();

  // Step 1: Import the Express app (measures module init time)
  try {
    const t1 = Date.now();
    await import('../packages/backend/dist/app.js');
    timings['1_module_import'] = Date.now() - t1;
  } catch (e) {
    timings['1_module_import'] = Date.now() - t0;
    errors['1_module_import'] = (e as Error).message;
  }

  // Step 2: Test Neon DB connection
  try {
    const t2 = Date.now();
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env['DATABASE_URL']!);
    const result = await sql`SELECT 1 as ok`;
    timings['2_db_query'] = Date.now() - t2;
    timings['2_db_result'] = result[0]?.ok;
  } catch (e) {
    timings['2_db_query'] = -1;
    errors['2_db_query'] = (e as Error).message;
  }

  // Step 3: Test JWKS fetch from Zitadel
  try {
    const t3 = Date.now();
    const issuer = process.env['ZITADEL_ISSUER']?.trim();
    const jwksUrl = `${issuer}/oauth/v2/keys`;
    const jwksResp = await fetch(jwksUrl);
    timings['3_jwks_fetch'] = Date.now() - t3;
    timings['3_jwks_status'] = jwksResp.status;
  } catch (e) {
    timings['3_jwks_fetch'] = -1;
    errors['3_jwks_fetch'] = (e as Error).message;
  }

  // Step 4: Test Zitadel userinfo endpoint (no token, expect 401)
  try {
    const t4 = Date.now();
    const issuer = process.env['ZITADEL_ISSUER']?.trim();
    const userinfoResp = await fetch(`${issuer}/oidc/v1/userinfo`, {
      headers: { Authorization: 'Bearer fake' },
    });
    timings['4_userinfo_fetch'] = Date.now() - t4;
    timings['4_userinfo_status'] = userinfoResp.status;
  } catch (e) {
    timings['4_userinfo_fetch'] = -1;
    errors['4_userinfo_fetch'] = (e as Error).message;
  }

  // Step 5: Test a simple DB query (count employees)
  try {
    const t5 = Date.now();
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env['DATABASE_URL']!);
    const result = await sql`SELECT count(*) as cnt FROM employees`;
    timings['5_employee_count'] = Date.now() - t5;
    timings['5_count_result'] = Number(result[0]?.cnt);
  } catch (e) {
    timings['5_employee_count'] = -1;
    errors['5_employee_count'] = (e as Error).message;
  }

  timings['total_ms'] = Date.now() - t0;

  res.status(200).json({ timings, errors });
}
