/**
 * Drizzle client and table schema for the app-portal database.
 *
 * Connection uses the `timesheets_reader` Postgres role with:
 *   - SELECT on `employees` (compensation fields)
 *
 * This table definition is NOT managed by this app's migrations —
 * it exists solely for type-safe query building.
 */

import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  numeric,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core';

const { Pool } = pg;

// ─── External Table Schema ─────────────────────────────────────────

/**
 * app-portal employees table (read-only subset).
 *
 * Only the columns needed for compensation lookups are defined here.
 * The full table has many more columns managed by app-portal.
 */
export const portalEmployees = pgTable('employees', {
  id: uuid('id').primaryKey(),
  zitadelUserId: text('zitadel_user_id'),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }),
  firstName: varchar('first_name', { length: 255 }),
  lastName: varchar('last_name', { length: 255 }),
  compensationType: text('compensation_type'), // 'PER_TASK' | 'SALARIED'
  annualSalary: numeric('annual_salary', { precision: 12, scale: 2 }),
  expectedAnnualHours: integer('expected_annual_hours'),
  exemptStatus: text('exempt_status'), // 'EXEMPT' | 'NON_EXEMPT'
  dateOfBirth: text('date_of_birth'),
  isActive: boolean('is_active'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

const portalSchema = { portalEmployees };

// ─── Database Client ───────────────────────────────────────────────

const isVercel = process.env['VERCEL'] === '1';
const nodeEnv = process.env['NODE_ENV'];

function createAppPortalDb() {
  const connectionString = process.env['PEOPLE_DATABASE_URL'];

  if (!connectionString) {
    // Graceful: return null so the app can start without this DB configured
    return null;
  }

  const isLocal =
    nodeEnv === 'development' || nodeEnv === 'test' || connectionString.includes('localhost');

  if (isVercel && !isLocal) {
    const sql = neon(connectionString);
    return drizzleNeon(sql, { schema: portalSchema });
  }

  const pool = new Pool({
    connectionString,
    max: 3, // Low pool — cross-DB reads are infrequent
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  return drizzlePg({ client: pool, schema: portalSchema });
}

export const portalDb = createAppPortalDb();
