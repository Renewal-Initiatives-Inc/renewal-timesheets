/**
 * Vercel Serverless Function Entry Point
 * Routes all /api/* requests to the Express backend
 *
 * Following Vercel's Express integration pattern:
 * https://vercel.com/docs/frameworks/backend/express
 */

import app from '../packages/backend/dist/app.js';

export default app;
