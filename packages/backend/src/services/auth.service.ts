import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { decryptDob } from '../utils/encryption.js';

const { employees } = schema;

export type Employee = typeof employees.$inferSelect;

export interface EmployeePublic {
  id: string;
  name: string;
  email: string;
  isSupervisor: boolean;
  dateOfBirth: string;
  status: 'active' | 'archived';
  createdAt: Date;
  zitadelId?: string | null;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public code: 'EMPLOYEE_NOT_FOUND'
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Strip sensitive fields from employee record.
 * Note: isSupervisor is always false here — derived from Zitadel role in middleware.
 */
function toPublic(employee: Employee): EmployeePublic {
  return {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    isSupervisor: false,
    dateOfBirth: decryptDob(employee.dateOfBirth),
    status: employee.status,
    createdAt: employee.createdAt,
    zitadelId: employee.zitadelId,
  };
}

/**
 * Get an employee by ID (public info only).
 */
export async function getEmployeeById(employeeId: string): Promise<EmployeePublic | null> {
  const employee = await db.query.employees.findFirst({
    where: eq(employees.id, employeeId),
  });

  if (!employee) {
    return null;
  }

  return toPublic(employee);
}

/**
 * Get an employee by email (public info only).
 * Used for Zitadel SSO email-based account linking.
 */
export async function getEmployeeByEmail(email: string): Promise<EmployeePublic | null> {
  const employee = await db.query.employees.findFirst({
    where: eq(employees.email, email.toLowerCase()),
  });

  if (!employee) {
    return null;
  }

  return toPublic(employee);
}
