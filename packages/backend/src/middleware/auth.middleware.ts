import { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { EmployeePublic } from '../services/auth.service.js';
import { db } from '../db/index.js';
import { employees } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { decryptDob } from '../utils/encryption.js';
import { syncEmployeeFromPortal } from '../services/employee-sync.service.js';

// Zitadel configuration
// Trim to remove any accidental newlines from environment variables (common with Vercel)
const ZITADEL_ISSUER_RAW = process.env['ZITADEL_ISSUER'];
const ZITADEL_ISSUER = ZITADEL_ISSUER_RAW?.trim();
const ZITADEL_PROJECT_ID = process.env['ZITADEL_PROJECT_ID']?.trim();
if (!ZITADEL_ISSUER) {
  console.warn('ZITADEL_ISSUER not set - auth will fail');
} else if (ZITADEL_ISSUER !== ZITADEL_ISSUER_RAW) {
  console.warn('ZITADEL_ISSUER had whitespace trimmed (check env var for accidental newlines)');
}
if (!ZITADEL_PROJECT_ID) {
  console.warn('ZITADEL_PROJECT_ID not set - JWT audience validation disabled');
}

// Create JWKS client for token verification
// Zitadel uses /oauth/v2/keys instead of /.well-known/jwks.json
const JWKS = ZITADEL_ISSUER
  ? createRemoteJWKSet(new URL(`${ZITADEL_ISSUER}/oauth/v2/keys`))
  : null;

// Extended JWT payload with Zitadel-specific claims
interface ZitadelJWTPayload extends JWTPayload {
  email?: string;
  email_verified?: boolean;
  name?: string;
  'urn:zitadel:iam:org:project:roles'?: Record<string, unknown>;
}

// Extend Express Request to include employee and Zitadel user info
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      employee?: EmployeePublic;
      zitadelUser?: {
        sub: string;
        email?: string;
        name?: string;
        roles: string[];
        isAdmin: boolean;
      };
    }
  }
}

/**
 * Extract Bearer token from Authorization header.
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Resolve employee from local DB, syncing from app-portal if needed.
 *
 * Flow:
 * 1. Look up by zitadel_id (fast path, no cross-DB call)
 * 2. If miss, sync from app-portal (creates/updates local cache)
 * 3. Return EmployeePublic or null
 */
async function resolveEmployee(
  zitadelSub: string,
  email?: string,
  name?: string
): Promise<EmployeePublic | null> {
  // Fast path: find by zitadel_id in local DB
  const [localEmployee] = await db
    .select()
    .from(employees)
    .where(eq(employees.zitadelId, zitadelSub))
    .limit(1);

  if (localEmployee) {
    return {
      id: localEmployee.id,
      name: localEmployee.name,
      email: localEmployee.email,
      dateOfBirth: decryptDob(localEmployee.dateOfBirth),
      status: localEmployee.status,
      isSupervisor: false, // always derived from Zitadel, not DB
      createdAt: localEmployee.createdAt,
      zitadelId: localEmployee.zitadelId,
    };
  }

  // Sync from app-portal (handles email-based linking and new employee creation)
  const synced = await syncEmployeeFromPortal(zitadelSub, email, name);
  if (synced) {
    return {
      id: synced.id,
      name: synced.name,
      email: synced.email,
      dateOfBirth: decryptDob(synced.dateOfBirth),
      status: synced.status,
      isSupervisor: false,
      createdAt: synced.createdAt,
      zitadelId: synced.zitadelId,
    };
  }

  return null;
}

/**
 * Middleware that requires a valid Zitadel authentication token.
 * Validates the JWT against Zitadel's JWKS and resolves employee record.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);

  if (!token) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  if (!JWKS || !ZITADEL_ISSUER) {
    res.status(500).json({
      error: 'Configuration Error',
      message: 'Authentication service not configured',
    });
    return;
  }

  try {
    // Verify JWT signature and claims against Zitadel
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ZITADEL_ISSUER,
      audience: ZITADEL_PROJECT_ID || undefined,
    });

    const zitadelPayload = payload as ZitadelJWTPayload;

    // Extract roles from Zitadel claims
    const rolesClaim = zitadelPayload['urn:zitadel:iam:org:project:roles'] || {};
    const roles = Object.keys(rolesClaim);
    const isAdmin = roles.includes('admin');

    // Deny access unless user has required Zitadel role
    if (!isAdmin && !roles.includes('app:renewal-timesheets')) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have access to this application.',
      });
      return;
    }

    const email = zitadelPayload.email;
    const name = zitadelPayload.name;

    // Resolve employee: local cache → sync from portal if needed
    const employee = await resolveEmployee(zitadelPayload.sub!, email, name);

    // Attach Zitadel user info to request
    req.zitadelUser = {
      sub: zitadelPayload.sub!,
      email: email || employee?.email,
      name,
      roles,
      isAdmin,
    };

    if (employee) {
      req.employee = {
        ...employee,
        isSupervisor: isAdmin, // derived exclusively from Zitadel role
      };
    }

    next();
  } catch (error) {
    const err = error as Error;
    console.error('Token verification failed:', {
      name: err.name,
      message: err.message,
      issuer: ZITADEL_ISSUER,
    });
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }
}

/**
 * Middleware that requires supervisor role (Zitadel admin).
 * Must be used after requireAuth middleware.
 */
export async function requireSupervisor(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.employee) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
    return;
  }

  if (!req.zitadelUser?.isAdmin) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Supervisor access required',
    });
    return;
  }

  next();
}

/**
 * Middleware that optionally attaches authentication.
 * Does not fail if no token is present.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);

  if (!token || !JWKS || !ZITADEL_ISSUER) {
    next();
    return;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: ZITADEL_ISSUER,
      audience: ZITADEL_PROJECT_ID || undefined,
    });

    const zitadelPayload = payload as ZitadelJWTPayload;
    const rolesClaim = zitadelPayload['urn:zitadel:iam:org:project:roles'] || {};
    const roles = Object.keys(rolesClaim);
    const isAdmin = roles.includes('admin');

    const email = zitadelPayload.email;
    const name = zitadelPayload.name;

    const employee = await resolveEmployee(zitadelPayload.sub!, email, name);

    req.zitadelUser = {
      sub: zitadelPayload.sub!,
      email: email || employee?.email,
      name,
      roles,
      isAdmin,
    };

    if (employee) {
      req.employee = {
        ...employee,
        isSupervisor: isAdmin,
      };
    }
  } catch {
    // Token invalid, continue without auth
  }

  next();
}
