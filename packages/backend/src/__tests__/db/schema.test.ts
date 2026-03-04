/**
 * Database schema integration tests.
 *
 * These tests verify that the Drizzle schema matches the database
 * and that basic CRUD operations work correctly.
 *
 * IMPORTANT: These tests require a DATABASE_URL environment variable.
 * They will be skipped in CI environments without database access.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import * as schema from '../../db/schema/index.js';

const { Pool } = pg;
const {
  employees,
  employeeDocuments,
  taskCodes,
  taskCodeRates,
  timesheets,
  timesheetEntries,
  complianceCheckLogs,
  payrollRecords,
} = schema;

// Skip all tests if no DATABASE_URL
const DATABASE_URL = process.env['DATABASE_URL'];
const shouldSkip = !DATABASE_URL;

// Use unique identifiers to avoid conflicts with seed data
const testId = Date.now().toString();
const testEmail = (name: string) => `test_${testId}_${name}@test.example`;
const testCode = (base: string) => `T${testId.slice(-4)}_${base}`;

describe.skipIf(shouldSkip)('Database Schema Integration', () => {
  let pool: pg.Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let supervisorId: string;
  let employeeId: string;
  let taskCodeId: string;
  let timesheetId: string;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 3,
    });
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    // Clean up test data in reverse dependency order
    if (timesheetId) {
      await db.delete(payrollRecords).where(eq(payrollRecords.timesheetId, timesheetId));
      await db.delete(complianceCheckLogs).where(eq(complianceCheckLogs.timesheetId, timesheetId));
      await db.delete(timesheetEntries).where(eq(timesheetEntries.timesheetId, timesheetId));
      await db.delete(timesheets).where(eq(timesheets.id, timesheetId));
    }
    if (taskCodeId) {
      await db.delete(taskCodeRates).where(eq(taskCodeRates.taskCodeId, taskCodeId));
      await db.delete(taskCodes).where(eq(taskCodes.id, taskCodeId));
    }
    if (employeeId) {
      await db.delete(employeeDocuments).where(eq(employeeDocuments.employeeId, employeeId));
      await db.delete(employees).where(eq(employees.id, employeeId));
    }
    if (supervisorId) {
      await db.delete(employees).where(eq(employees.id, supervisorId));
    }
    await pool.end();
  });

  describe('Employee operations', () => {
    it('creates an employee with required fields', async () => {
      const [supervisor] = await db
        .insert(employees)
        .values({
          name: 'Test Supervisor',
          email: testEmail('supervisor'),
          dateOfBirth: '1985-01-15',
        })
        .returning();

      expect(supervisor).toBeDefined();
      expect(supervisor!.id).toBeDefined();
      expect(supervisor!.name).toBe('Test Supervisor');
      expect(supervisor!.status).toBe('active');
      supervisorId = supervisor!.id;
    });

    it('creates a minor employee', async () => {
      const [employee] = await db
        .insert(employees)
        .values({
          name: 'Test Minor',
          email: testEmail('minor'),
          dateOfBirth: '2010-06-15',
        })
        .returning();

      expect(employee).toBeDefined();
      employeeId = employee!.id;
    });

    it('enforces unique email constraint', async () => {
      await expect(
        db.insert(employees).values({
          name: 'Duplicate Email',
          email: testEmail('minor'), // Same as above
          dateOfBirth: '2010-06-15',
        })
      ).rejects.toThrow();
    });

    it('reads employee by id', async () => {
      const [found] = await db.select().from(employees).where(eq(employees.id, employeeId));

      expect(found).toBeDefined();
      expect(found!.name).toBe('Test Minor');
    });
  });

  describe('Employee Document operations', () => {
    it('creates a document for an employee', async () => {
      const [doc] = await db
        .insert(employeeDocuments)
        .values({
          employeeId: employeeId,
          type: 'parental_consent',
          filePath: '/test/consent.pdf',
          uploadedBy: supervisorId,
        })
        .returning();

      expect(doc).toBeDefined();
      expect(doc!.type).toBe('parental_consent');
      expect(doc!.expiresAt).toBeNull();
    });

    it('enforces foreign key constraint', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      await expect(
        db.insert(employeeDocuments).values({
          employeeId: fakeId, // Non-existent
          type: 'work_permit',
          filePath: '/test/permit.pdf',
          uploadedBy: supervisorId,
        })
      ).rejects.toThrow();
    });
  });

  describe('Task Code operations', () => {
    it('creates a task code with compliance attributes', async () => {
      const [tc] = await db
        .insert(taskCodes)
        .values({
          code: testCode('F1'),
          name: 'Test Field Work',
          description: 'Test agricultural task',
          isAgricultural: true,
          isHazardous: false,
          supervisorRequired: 'for_minors',
          soloCashHandling: false,
          drivingRequired: false,
          powerMachinery: false,
          minAgeAllowed: 12,
        })
        .returning();

      expect(tc).toBeDefined();
      expect(tc!.isAgricultural).toBe(true);
      expect(tc!.supervisorRequired).toBe('for_minors');
      expect(tc!.minAgeAllowed).toBe(12);
      taskCodeId = tc!.id;
    });

    it('enforces unique code constraint', async () => {
      await expect(
        db.insert(taskCodes).values({
          code: testCode('F1'), // Same code
          name: 'Duplicate Code',
        })
      ).rejects.toThrow();
    });

    it('creates rate versions for a task code', async () => {
      // First rate
      const [rate1] = await db
        .insert(taskCodeRates)
        .values({
          taskCodeId: taskCodeId,
          hourlyRate: '8.00',
          effectiveDate: '2024-01-01',
          justificationNotes: 'Initial rate',
        })
        .returning();

      expect(rate1).toBeDefined();
      expect(rate1!.hourlyRate).toBe('8.00');

      // Second rate (rate increase)
      const [rate2] = await db
        .insert(taskCodeRates)
        .values({
          taskCodeId: taskCodeId,
          hourlyRate: '8.50',
          effectiveDate: '2024-07-01',
          justificationNotes: 'Mid-year adjustment',
        })
        .returning();

      expect(rate2).toBeDefined();
      expect(rate2!.hourlyRate).toBe('8.50');

      // Verify both rates exist
      const rates = await db
        .select()
        .from(taskCodeRates)
        .where(eq(taskCodeRates.taskCodeId, taskCodeId));

      expect(rates.length).toBe(2);
    });
  });

  describe('Timesheet operations', () => {
    it('creates a timesheet for an employee', async () => {
      const [ts] = await db
        .insert(timesheets)
        .values({
          employeeId: employeeId,
          weekStartDate: '2024-06-09', // Sunday
        })
        .returning();

      expect(ts).toBeDefined();
      expect(ts!.status).toBe('open');
      expect(ts!.submittedAt).toBeNull();
      timesheetId = ts!.id;
    });

    it('creates a timesheet entry', async () => {
      const [entry] = await db
        .insert(timesheetEntries)
        .values({
          timesheetId: timesheetId,
          workDate: '2024-06-10', // Monday
          taskCodeId: taskCodeId,
          startTime: '09:00',
          endTime: '12:00',
          hours: '3.00',
          isSchoolDay: true,
        })
        .returning();

      expect(entry).toBeDefined();
      expect(entry!.hours).toBe('3.00');
      expect(entry!.isSchoolDay).toBe(true);
    });

    it('updates timesheet status', async () => {
      const [updated] = await db
        .update(timesheets)
        .set({
          status: 'submitted',
          submittedAt: new Date(),
        })
        .where(eq(timesheets.id, timesheetId))
        .returning();

      expect(updated).toBeDefined();
      expect(updated!.status).toBe('submitted');
      expect(updated!.submittedAt).not.toBeNull();
    });
  });

  describe('Compliance operations', () => {
    it('creates a compliance check log with JSONB details', async () => {
      const [log] = await db
        .insert(complianceCheckLogs)
        .values({
          timesheetId: timesheetId,
          ruleId: 'RULE-002',
          result: 'pass',
          details: {
            ruleDescription: 'Maximum daily hours check',
            checkedValues: { hours: 3, isSchoolDay: true },
            threshold: 3,
            actualValue: 3,
            message: 'Daily hours within limit',
          },
          employeeAgeOnDate: 14,
        })
        .returning();

      expect(log).toBeDefined();
      expect(log!.result).toBe('pass');
      expect(log!.details.ruleDescription).toBe('Maximum daily hours check');
      expect(log!.details.checkedValues).toEqual({ hours: 3, isSchoolDay: true });
    });

    it('queries compliance logs for a timesheet', async () => {
      const logs = await db
        .select()
        .from(complianceCheckLogs)
        .where(eq(complianceCheckLogs.timesheetId, timesheetId));

      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]!.ruleId).toBe('RULE-002');
    });
  });

  describe('Payroll operations', () => {
    it('creates a payroll record with decimal fields', async () => {
      const [payroll] = await db
        .insert(payrollRecords)
        .values({
          timesheetId: timesheetId,
          employeeId: employeeId,
          periodStart: '2024-06-09',
          periodEnd: '2024-06-15',
          agriculturalHours: '3.00',
          agriculturalEarnings: '24.00',
          nonAgriculturalHours: '0.00',
          nonAgriculturalEarnings: '0.00',
          overtimeHours: '0.00',
          overtimeEarnings: '0.00',
          totalEarnings: '24.00',
        })
        .returning();

      expect(payroll).toBeDefined();
      expect(payroll!.agriculturalHours).toBe('3.00');
      expect(payroll!.totalEarnings).toBe('24.00');
    });

    it('enforces unique timesheet constraint on payroll', async () => {
      await expect(
        db.insert(payrollRecords).values({
          timesheetId: timesheetId, // Same timesheet
          employeeId: employeeId,
          periodStart: '2024-06-09',
          periodEnd: '2024-06-15',
          agriculturalHours: '0.00',
          agriculturalEarnings: '0.00',
          nonAgriculturalHours: '0.00',
          nonAgriculturalEarnings: '0.00',
          overtimeHours: '0.00',
          overtimeEarnings: '0.00',
          totalEarnings: '0.00',
        })
      ).rejects.toThrow();
    });
  });

  describe('Relational queries', () => {
    it('queries employee with documents', async () => {
      const result = await db.query.employees.findFirst({
        where: eq(employees.id, employeeId),
        with: {
          documents: true,
        },
      });

      expect(result).toBeDefined();
      expect(result!.documents).toBeDefined();
      expect(Array.isArray(result!.documents)).toBe(true);
    });

    it('queries task code with rates', async () => {
      const result = await db.query.taskCodes.findFirst({
        where: eq(taskCodes.id, taskCodeId),
        with: {
          rates: true,
        },
      });

      expect(result).toBeDefined();
      expect(result!.rates).toBeDefined();
      expect(result!.rates.length).toBe(2);
    });

    it('queries timesheet with entries', async () => {
      const result = await db.query.timesheets.findFirst({
        where: eq(timesheets.id, timesheetId),
        with: {
          entries: {
            with: {
              taskCode: true,
            },
          },
          employee: true,
        },
      });

      expect(result).toBeDefined();
      expect(result!.employee).toBeDefined();
      expect(result!.entries).toBeDefined();
      expect(result!.entries.length).toBeGreaterThan(0);
      expect(result!.entries[0]!.taskCode).toBeDefined();
    });
  });
});
