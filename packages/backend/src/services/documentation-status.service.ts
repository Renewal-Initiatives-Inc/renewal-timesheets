import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { calculateAge } from '../utils/age.js';
import { decryptDob } from '../utils/encryption.js';
import { getRequiredDocuments, EmployeeError } from './employee.service.js';
import type { DocumentationStatus, DocumentType } from '@renewal/types';

const { employees, employeeDocuments } = schema;

/**
 * Get the documentation compliance status for an employee.
 *
 * Determines:
 * - If all required documents are present and valid
 * - Which documents are missing
 * - Which documents are expiring within 30 days
 *
 * @param employeeId - Employee UUID
 * @returns Documentation status
 */
export async function getDocumentationStatus(employeeId: string): Promise<DocumentationStatus> {
  // Get employee
  const employee = await db.query.employees.findFirst({
    where: eq(employees.id, employeeId),
  });

  if (!employee) {
    throw new EmployeeError('Employee not found', 'EMPLOYEE_NOT_FOUND');
  }

  // Calculate age and required documents (DOB is AES-256-GCM encrypted in DB)
  const today = new Date().toISOString().split('T')[0]!;
  const age = calculateAge(decryptDob(employee.dateOfBirth), today);
  const required = getRequiredDocuments(age);

  // Get all documents for this employee
  const docs = await db.query.employeeDocuments.findMany({
    where: eq(employeeDocuments.employeeId, employeeId),
  });

  // Filter to valid documents (not invalidated, not expired)
  const validDocs = docs.filter((d) => {
    if (d.invalidatedAt) return false;
    if (d.expiresAt && d.expiresAt < today) return false;
    return true;
  });

  // Build lists of missing and expiring documents
  const missingDocuments: DocumentType[] = [];
  const expiringDocuments: Array<{
    type: DocumentType;
    expiresAt: string;
    daysUntilExpiry: number;
  }> = [];

  // Check parental consent
  const hasParentalConsent = validDocs.some((d) => d.type === 'parental_consent');
  if (required.parentalConsent && !hasParentalConsent) {
    missingDocuments.push('parental_consent');
  }

  // Check work permit
  const workPermitDoc = validDocs.find((d) => d.type === 'work_permit');
  const hasWorkPermit = !!workPermitDoc;
  if (required.workPermit && !hasWorkPermit) {
    missingDocuments.push('work_permit');
  }

  // Check safety training
  const hasSafetyTraining = validDocs.some((d) => d.type === 'safety_training');
  if (required.safetyTraining && !hasSafetyTraining) {
    missingDocuments.push('safety_training');
  }

  // Check for expiring documents (within 30 days)
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  const thirtyDaysStr = thirtyDaysFromNow.toISOString().split('T')[0]!;

  for (const doc of validDocs) {
    if (doc.expiresAt && doc.expiresAt <= thirtyDaysStr) {
      const expiresDate = new Date(doc.expiresAt + 'T00:00:00');
      const todayDate = new Date(today + 'T00:00:00');
      const daysUntilExpiry = Math.ceil(
        (expiresDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      expiringDocuments.push({
        type: doc.type as DocumentType,
        expiresAt: doc.expiresAt,
        daysUntilExpiry,
      });
    }
  }

  return {
    isComplete: missingDocuments.length === 0,
    missingDocuments,
    expiringDocuments,
    hasValidConsent: hasParentalConsent || !required.parentalConsent,
    hasValidWorkPermit: required.workPermit ? hasWorkPermit : null,
    safetyTrainingComplete: hasSafetyTraining || !required.safetyTraining,
  };
}

/**
 * Check if an employee has complete documentation.
 * Used by middleware to determine if employee can submit timesheets.
 *
 * @param employeeId - Employee UUID
 * @returns True if documentation is complete
 */
export async function isDocumentationComplete(employeeId: string): Promise<boolean> {
  try {
    const status = await getDocumentationStatus(employeeId);
    return status.isComplete;
  } catch {
    // If employee not found or other error, treat as incomplete
    return false;
  }
}
