/**
 * Employee Sync Service
 *
 * Syncs employee data from app-portal (source of truth) into the local
 * timesheets employees table (thin cache kept for FK integrity).
 *
 * Flow: Zitadel sub → portal lookup → upsert local cache row
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { portalDb, portalEmployees } from '../db/app-portal.js';
import { decrypt, encryptDob, decryptDob } from '../utils/encryption.js';

const { employees } = schema;

type Employee = typeof employees.$inferSelect;

/**
 * Re-encrypt DOB from portal encryption key to timesheets encryption key.
 * Portal uses PAYROLL_ENCRYPTION_KEY; timesheets uses DOB_ENCRYPTION_KEY.
 * Returns null if the value is null or re-encryption fails.
 */
function reEncryptDob(portalEncryptedDob: string | null): string | null {
  if (!portalEncryptedDob) return null;

  // If it's already a plaintext date (YYYY-MM-DD), encrypt directly
  if (/^\d{4}-\d{2}-\d{2}$/.test(portalEncryptedDob)) {
    return encryptDob(portalEncryptedDob);
  }

  try {
    // Decrypt with portal key, re-encrypt with timesheets key
    const plaintext = decrypt(portalEncryptedDob, 'PAYROLL_ENCRYPTION_KEY');
    return encryptDob(plaintext);
  } catch {
    console.warn('Could not re-encrypt DOB from portal (missing PAYROLL_ENCRYPTION_KEY?)');
    return null;
  }
}

interface PortalEmployee {
  id: string;
  zitadelUserId: string | null;
  name: string | null;
  email: string | null;
  dateOfBirth: string | null;
  isActive: boolean | null;
}

/**
 * Look up an employee in app-portal by Zitadel user ID.
 */
async function findPortalEmployee(zitadelSub: string): Promise<PortalEmployee | null> {
  if (!portalDb) return null;

  try {
    const [row] = await portalDb
      .select({
        id: portalEmployees.id,
        zitadelUserId: portalEmployees.zitadelUserId,
        name: portalEmployees.name,
        email: portalEmployees.email,
        dateOfBirth: portalEmployees.dateOfBirth,
        isActive: portalEmployees.isActive,
      })
      .from(portalEmployees)
      .where(eq(portalEmployees.zitadelUserId, zitadelSub))
      .limit(1);

    return row ?? null;
  } catch (error) {
    console.error('Failed to query app-portal for employee:', error);
    return null;
  }
}

/**
 * Sync an employee from app-portal into the local cache.
 *
 * Strategy:
 * 1. Query portal by Zitadel sub
 * 2. Find local employee by zitadel_id OR email
 * 3. Upsert: update existing or insert new
 *
 * Returns the local employee record, or null if not found in portal.
 */
export async function syncEmployeeFromPortal(
  zitadelSub: string,
  emailHint?: string,
  nameHint?: string
): Promise<Employee | null> {
  const portalEmployee = await findPortalEmployee(zitadelSub);
  if (!portalEmployee) return null;

  const portalName = portalEmployee.name || nameHint || 'Unknown';
  const portalEmail = portalEmployee.email || emailHint || '';
  const portalStatus = portalEmployee.isActive !== false ? 'active' : 'archived';

  // Try to find existing local employee by zitadel_id
  let localEmployee = await db.query.employees.findFirst({
    where: eq(employees.zitadelId, zitadelSub),
  });

  // If not found by zitadel_id, try by email (auto-link scenario)
  if (!localEmployee && portalEmail) {
    localEmployee = await db.query.employees.findFirst({
      where: eq(employees.email, portalEmail.toLowerCase()),
    });
  }

  if (localEmployee) {
    // Update existing local employee
    const updates: Partial<typeof employees.$inferInsert> = {
      name: portalName,
      email: portalEmail.toLowerCase(),
      status: portalStatus as 'active' | 'archived',
      zitadelId: zitadelSub,
      updatedAt: new Date(),
    };

    // Re-encrypt DOB if portal has it and local doesn't, or portal has a newer value
    if (portalEmployee.dateOfBirth) {
      const reEncrypted = reEncryptDob(portalEmployee.dateOfBirth);
      if (reEncrypted) {
        updates.dateOfBirth = reEncrypted;
      }
    }

    const [updated] = await db
      .update(employees)
      .set(updates)
      .where(eq(employees.id, localEmployee.id))
      .returning();

    return updated ?? localEmployee;
  }

  // Insert new local employee (first-time sync)
  // DOB is required in the schema — use portal DOB or a placeholder
  let localDob: string;
  if (portalEmployee.dateOfBirth) {
    const reEncrypted = reEncryptDob(portalEmployee.dateOfBirth);
    localDob = reEncrypted || encryptDob('2000-01-01'); // fallback placeholder
  } else {
    localDob = encryptDob('2000-01-01'); // placeholder until DOB is set in portal
  }

  const [inserted] = await db
    .insert(employees)
    .values({
      name: portalName,
      email: portalEmail.toLowerCase(),
      dateOfBirth: localDob,
      isSupervisor: false, // always false — derived from Zitadel role
      status: portalStatus as 'active' | 'archived',
      zitadelId: zitadelSub,
    })
    .returning();

  if (inserted) {
    console.log(`Synced new employee from portal: ${portalName} (${portalEmail})`);
  }

  return inserted ?? null;
}
