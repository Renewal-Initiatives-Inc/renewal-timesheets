/**
 * Vercel Serverless Function Entry Point
 * Routes all /api/* requests to the Express backend
 *
 * Following Vercel's Express integration pattern:
 * https://vercel.com/docs/frameworks/backend/express
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

let app: any;
let initError: Error | null = null;

try {
  const mod = await import('../packages/backend/dist/app.js');
  app = mod.default;
  console.log('[api/index] Express app loaded successfully');
} catch (err) {
  initError = err instanceof Error ? err : new Error(String(err));
  console.error('[api/index] Failed to load Express app:', initError.message);
  console.error('[api/index] Stack:', initError.stack);
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  // Temporary debug: show which required env vars are present
  if (req.url?.includes('env-debug')) {
    const required = ['ZITADEL_ISSUER', 'ZITADEL_PROJECT_ID', 'DOB_ENCRYPTION_KEY', 'DATABASE_URL', 'FRONTEND_URL', 'NODE_ENV'];
    const envStatus = Object.fromEntries(
      required.map((k) => [k, process.env[k] ? `set (${process.env[k]!.length} chars)` : 'MISSING'])
    );
    res.status(200).json({ envStatus, vercel: process.env['VERCEL'], region: process.env['VERCEL_REGION'] });
    return;
  }

  if (initError) {
    console.error('[api/index] Returning init error to client');
    res.status(500).json({
      error: 'Function initialization failed',
      message: initError.message,
      stack: initError.stack,
    });
    return;
  }

  if (!app) {
    res.status(500).json({ error: 'App not loaded' });
    return;
  }

  return app(req, res);
}
