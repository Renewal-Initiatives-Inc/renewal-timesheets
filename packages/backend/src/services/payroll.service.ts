import { eq, and, lte, desc, gte, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { PayrollRecord } from '@renewal/types';
import Decimal from 'decimal.js';
import { getAgeBand, type AgeBand } from '../utils/age.js';
import { decryptDob } from '../utils/encryption.js';
import { getSalariedWeeklyPay, type ExemptStatus } from './compensation.service.js';

// Type alias for Decimal instances
type DecimalValue = InstanceType<typeof Decimal>;

const { payrollRecords, timesheets, taskCodeRates } = schema;

type PayrollRecordRow = typeof payrollRecords.$inferSelect;

// Minimum wage floors
const AGRICULTURAL_MIN_WAGE = new Decimal('8.00');
const NON_AGRICULTURAL_MIN_WAGE = new Decimal('15.00');
const OVERTIME_THRESHOLD_HOURS = new Decimal('40');

/**
 * Error codes for payroll operations.
 */
export type PayrollErrorCode =
  | 'TIMESHEET_NOT_FOUND'
  | 'TIMESHEET_NOT_APPROVED'
  | 'NO_RATE_FOUND'
  | 'PAYROLL_ALREADY_EXISTS'
  | 'PAYROLL_NOT_FOUND'
  | 'INVALID_DATE_RANGE';

/**
 * Error thrown for payroll-related business logic errors.
 */
export class PayrollError extends Error {
  constructor(
    message: string,
    public code: PayrollErrorCode
  ) {
    super(message);
    this.name = 'PayrollError';
  }
}

/**
 * Filters for listing payroll records.
 */
export interface PayrollFilters {
  startDate: string;
  endDate: string;
  employeeId?: string;
  ageBand?: AgeBand;
}

/**
 * Payroll record with employee and timesheet details.
 */
export interface PayrollRecordWithDetails extends PayrollRecord {
  employee: {
    id: string;
    name: string;
  };
  timesheet: {
    id: string;
    weekStartDate: string;
  };
}

/**
 * Convert database row to public PayrollRecord.
 */
function toPublicPayrollRecord(row: PayrollRecordRow): PayrollRecord {
  return {
    id: row.id,
    timesheetId: row.timesheetId,
    employeeId: row.employeeId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    agriculturalHours: row.agriculturalHours,
    agriculturalEarnings: row.agriculturalEarnings,
    nonAgriculturalHours: row.nonAgriculturalHours,
    nonAgriculturalEarnings: row.nonAgriculturalEarnings,
    overtimeHours: row.overtimeHours,
    overtimeEarnings: row.overtimeEarnings,
    totalEarnings: row.totalEarnings,
    calculatedAt: row.calculatedAt.toISOString(),
    exportedAt: row.exportedAt?.toISOString() ?? null,
  };
}

/**
 * Get the effective hourly rate for a task code on a specific date.
 * Finds the most recent rate where effective_date <= workDate.
 */
export async function getEffectiveRateForDate(
  taskCodeId: string,
  workDate: string
): Promise<DecimalValue> {
  const rate = await db.query.taskCodeRates.findFirst({
    where: and(
      eq(taskCodeRates.taskCodeId, taskCodeId),
      lte(taskCodeRates.effectiveDate, workDate)
    ),
    orderBy: [desc(taskCodeRates.effectiveDate)],
  });

  if (!rate) {
    throw new PayrollError(
      `No rate found for task code ${taskCodeId} on ${workDate}`,
      'NO_RATE_FOUND'
    );
  }

  return new Decimal(rate.hourlyRate);
}

/**
 * Validate that a rate meets minimum wage requirements.
 * Returns warnings if rate is below the applicable minimum.
 */
function validateMinimumWage(
  rate: DecimalValue,
  isAgricultural: boolean,
  taskCodeCode: string
): string | null {
  const minWage = isAgricultural ? AGRICULTURAL_MIN_WAGE : NON_AGRICULTURAL_MIN_WAGE;

  if (rate.lessThan(minWage)) {
    const type = isAgricultural ? 'agricultural' : 'non-agricultural';
    return `Warning: Task ${taskCodeCode} rate $${rate.toFixed(2)} is below ${type} minimum wage $${minWage.toFixed(2)}`;
  }

  return null;
}

/**
 * Calculate payroll for an approved timesheet.
 * Creates a PayrollRecord with:
 * - Agricultural hours and earnings
 * - Non-agricultural hours and earnings
 * - Overtime hours and earnings (non-agricultural only)
 * - Total earnings
 */
export async function calculatePayrollForTimesheet(timesheetId: string): Promise<PayrollRecord> {
  // Get timesheet with entries and task codes
  const timesheet = await db.query.timesheets.findFirst({
    where: eq(timesheets.id, timesheetId),
    with: {
      entries: {
        with: {
          taskCode: true,
        },
      },
    },
  });

  if (!timesheet) {
    throw new PayrollError('Timesheet not found', 'TIMESHEET_NOT_FOUND');
  }

  if (timesheet.status !== 'approved') {
    throw new PayrollError(
      `Cannot calculate payroll for timesheet with status: ${timesheet.status}`,
      'TIMESHEET_NOT_APPROVED'
    );
  }

  // Check for existing payroll record
  const existingPayroll = await db.query.payrollRecords.findFirst({
    where: eq(payrollRecords.timesheetId, timesheetId),
  });

  if (existingPayroll) {
    // Return existing record instead of creating duplicate
    return toPublicPayrollRecord(existingPayroll);
  }

  // Calculate period dates (week start to week end)
  const periodStart = timesheet.weekStartDate;
  const periodEndDate = new Date(periodStart + 'T00:00:00');
  periodEndDate.setDate(periodEndDate.getDate() + 6);
  const periodEnd = periodEndDate.toISOString().split('T')[0]!;

  // Check if employee has salaried compensation from app-portal
  let salariedData: Awaited<ReturnType<typeof getSalariedWeeklyPay>> = null;

  try {
    salariedData = await getSalariedWeeklyPay(timesheet.employeeId);
  } catch (error) {
    // Log but don't block payroll — fall back to task_code_rates
    console.warn(
      `Compensation lookup failed for employee ${timesheet.employeeId}, using task_code_rates:`,
      error instanceof Error ? error.message : error
    );
  }

  // Initialize accumulators
  let agriculturalHours = new Decimal(0);
  let agriculturalEarnings = new Decimal(0);
  let nonAgriculturalHours = new Decimal(0);
  let nonAgriculturalEarnings = new Decimal(0);
  let overtimeHours = new Decimal(0);
  let overtimeEarnings = new Decimal(0);
  let totalEarnings: DecimalValue;
  const warnings: string[] = [];

  if (salariedData) {
    // ── SALARIED PATH ──────────────────────────────────────────────
    // Fixed weekly pay = annual_salary / 52, regardless of hours.
    // Hours determine fund allocation (Phase 4) and overtime eligibility.
    // ag/non-ag distinction is irrelevant for salaried adults — all
    // earnings go to nonAgriculturalEarnings for the payroll record.
    const { weeklyPay, exemptStatus } = salariedData;
    warnings.push(...salariedData.warnings);

    // Tally total hours (task type doesn't affect salaried pay)
    let totalHours = new Decimal(0);
    for (const entry of timesheet.entries) {
      totalHours = totalHours.plus(new Decimal(entry.hours));
    }

    // All salaried earnings recorded as non-agricultural
    nonAgriculturalHours = totalHours;
    nonAgriculturalEarnings = weeklyPay;

    // Overtime for NON_EXEMPT salaried employees (FLSA fluctuating workweek)
    // OT premium = (weeklyPay / actual hours) × 0.5 × overtime hours
    if (
      exemptStatus !== 'EXEMPT' &&
      totalHours.greaterThan(OVERTIME_THRESHOLD_HOURS)
    ) {
      overtimeHours = totalHours.minus(OVERTIME_THRESHOLD_HOURS);
      const regularRate = weeklyPay.dividedBy(totalHours);
      overtimeEarnings = overtimeHours.times(regularRate).times(new Decimal('0.5'));
    }

    totalEarnings = weeklyPay.plus(overtimeEarnings);
  } else {
    // ── PER_TASK PATH (unchanged) ──────────────────────────────────
    // Each entry: hours × task_code_rate (date-effective)
    for (const entry of timesheet.entries) {
      const hours = new Decimal(entry.hours);
      const rate = await getEffectiveRateForDate(entry.taskCodeId, entry.workDate);

      // Validate minimum wage
      const warning = validateMinimumWage(
        rate,
        entry.taskCode.isAgricultural,
        entry.taskCode.code
      );
      if (warning) {
        warnings.push(warning);
      }

      const earnings = hours.times(rate);

      if (entry.taskCode.isAgricultural) {
        agriculturalHours = agriculturalHours.plus(hours);
        agriculturalEarnings = agriculturalEarnings.plus(earnings);
      } else {
        nonAgriculturalHours = nonAgriculturalHours.plus(hours);
        nonAgriculturalEarnings = nonAgriculturalEarnings.plus(earnings);
      }
    }

    // Overtime for PER_TASK: non-agricultural hours > 40
    if (nonAgriculturalHours.greaterThan(OVERTIME_THRESHOLD_HOURS)) {
      overtimeHours = nonAgriculturalHours.minus(OVERTIME_THRESHOLD_HOURS);

      if (nonAgriculturalHours.greaterThan(0)) {
        const weightedRate = nonAgriculturalEarnings.dividedBy(nonAgriculturalHours);
        overtimeEarnings = overtimeHours.times(weightedRate.times(new Decimal('0.5')));
      }
    }

    totalEarnings = agriculturalEarnings.plus(nonAgriculturalEarnings).plus(overtimeEarnings);
  }

  // Log warnings if any
  if (warnings.length > 0) {
    console.warn(`Payroll warnings for timesheet ${timesheetId}:`, warnings);
  }

  // Create payroll record
  const [payrollRecord] = await db
    .insert(payrollRecords)
    .values({
      timesheetId,
      employeeId: timesheet.employeeId,
      periodStart,
      periodEnd,
      agriculturalHours: agriculturalHours.toFixed(2),
      agriculturalEarnings: agriculturalEarnings.toFixed(2),
      nonAgriculturalHours: nonAgriculturalHours.toFixed(2),
      nonAgriculturalEarnings: nonAgriculturalEarnings.toFixed(2),
      overtimeHours: overtimeHours.toFixed(2),
      overtimeEarnings: overtimeEarnings.toFixed(2),
      totalEarnings: totalEarnings.toFixed(2),
    })
    .returning();

  return toPublicPayrollRecord(payrollRecord!);
}

/**
 * Get payroll record for a specific timesheet.
 */
export async function getPayrollRecord(timesheetId: string): Promise<PayrollRecord | null> {
  const record = await db.query.payrollRecords.findFirst({
    where: eq(payrollRecords.timesheetId, timesheetId),
  });

  return record ? toPublicPayrollRecord(record) : null;
}

/**
 * Get payroll record by ID.
 */
export async function getPayrollRecordById(id: string): Promise<PayrollRecord | null> {
  const record = await db.query.payrollRecords.findFirst({
    where: eq(payrollRecords.id, id),
  });

  return record ? toPublicPayrollRecord(record) : null;
}

/**
 * Calculate age as of a specific date.
 */
function calculateAgeOnDate(dateOfBirth: string, asOfDate: string): number {
  const dob = new Date(dateOfBirth + 'T00:00:00');
  const asOf = new Date(asOfDate + 'T00:00:00');

  let age = asOf.getFullYear() - dob.getFullYear();
  const monthDiff = asOf.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

/**
 * Get age band safely (returns '18+' for any age >= 18).
 */
function getAgeBandSafe(age: number): AgeBand {
  if (age < 12) return '12-13'; // Treat below 12 as youngest band
  return getAgeBand(age);
}

/**
 * List payroll records with filters.
 * Filters by period dates (overlapping with date range) and optionally by employee.
 */
export async function listPayrollRecords(
  filters: PayrollFilters
): Promise<PayrollRecordWithDetails[]> {
  // Validate date range
  if (filters.startDate > filters.endDate) {
    throw new PayrollError('Start date must be before or equal to end date', 'INVALID_DATE_RANGE');
  }

  // Build conditions
  const conditions = [
    // Period overlaps with filter range
    lte(payrollRecords.periodStart, filters.endDate),
    gte(payrollRecords.periodEnd, filters.startDate),
  ];

  if (filters.employeeId) {
    conditions.push(eq(payrollRecords.employeeId, filters.employeeId));
  }

  // Query with relations
  const records = await db.query.payrollRecords.findMany({
    where: and(...conditions),
    with: {
      employee: true,
      timesheet: true,
    },
    orderBy: [desc(payrollRecords.periodStart)],
  });

  // Map records to output format
  let result = records.map((record) => ({
    id: record.id,
    timesheetId: record.timesheetId,
    employeeId: record.employeeId,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    agriculturalHours: record.agriculturalHours,
    agriculturalEarnings: record.agriculturalEarnings,
    nonAgriculturalHours: record.nonAgriculturalHours,
    nonAgriculturalEarnings: record.nonAgriculturalEarnings,
    overtimeHours: record.overtimeHours,
    overtimeEarnings: record.overtimeEarnings,
    totalEarnings: record.totalEarnings,
    calculatedAt: record.calculatedAt.toISOString(),
    exportedAt: record.exportedAt?.toISOString() ?? null,
    employee: {
      id: record.employee.id,
      name: record.employee.name,
      dateOfBirth: decryptDob(record.employee.dateOfBirth),
    },
    timesheet: {
      id: record.timesheet.id,
      weekStartDate: record.timesheet.weekStartDate,
    },
  }));

  // Filter by age band if specified
  if (filters.ageBand) {
    result = result.filter((record) => {
      const age = calculateAgeOnDate(record.employee.dateOfBirth, record.periodStart);
      const band = getAgeBandSafe(age);
      return band === filters.ageBand;
    });
  }

  // Remove dateOfBirth from output (was only needed for filtering)
  return result.map(({ employee, ...rest }) => ({
    ...rest,
    employee: {
      id: employee.id,
      name: employee.name,
    },
  }));
}

/**
 * Recalculate payroll for an approved timesheet.
 * Deletes existing record and creates a new one.
 */
export async function recalculatePayroll(timesheetId: string): Promise<PayrollRecord> {
  // Get timesheet to verify it's approved
  const timesheet = await db.query.timesheets.findFirst({
    where: eq(timesheets.id, timesheetId),
  });

  if (!timesheet) {
    throw new PayrollError('Timesheet not found', 'TIMESHEET_NOT_FOUND');
  }

  if (timesheet.status !== 'approved') {
    throw new PayrollError(
      `Cannot calculate payroll for timesheet with status: ${timesheet.status}`,
      'TIMESHEET_NOT_APPROVED'
    );
  }

  // Delete existing payroll record if exists
  await db.delete(payrollRecords).where(eq(payrollRecords.timesheetId, timesheetId));

  // Calculate fresh
  return calculatePayrollForTimesheet(timesheetId);
}

/**
 * Recalculate payroll for all approved timesheets.
 * Useful after fixing rate effective dates or other bulk updates.
 */
export async function recalculateAllApprovedPayroll(): Promise<{
  success: number;
  failed: number;
  results: Array<{ timesheetId: string; weekStartDate: string; earnings: string | null; error?: string }>;
}> {
  // Get all approved timesheets
  const approvedTimesheets = await db.query.timesheets.findMany({
    where: eq(timesheets.status, 'approved'),
    columns: { id: true, weekStartDate: true },
  });

  const results: Array<{ timesheetId: string; weekStartDate: string; earnings: string | null; error?: string }> = [];
  let success = 0;
  let failed = 0;

  for (const ts of approvedTimesheets) {
    try {
      // Delete existing payroll record if exists
      await db.delete(payrollRecords).where(eq(payrollRecords.timesheetId, ts.id));

      // Recalculate
      const payroll = await calculatePayrollForTimesheet(ts.id);
      results.push({
        timesheetId: ts.id,
        weekStartDate: ts.weekStartDate,
        earnings: payroll.totalEarnings,
      });
      success++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        timesheetId: ts.id,
        weekStartDate: ts.weekStartDate,
        earnings: null,
        error: message,
      });
      failed++;
    }
  }

  return { success, failed, results };
}

/**
 * Mark payroll records as exported.
 * Updates the exportedAt timestamp.
 */
export async function markPayrollExported(payrollIds: string[]): Promise<void> {
  if (payrollIds.length === 0) return;

  const now = new Date();

  await db
    .update(payrollRecords)
    .set({ exportedAt: now })
    .where(
      sql`${payrollRecords.id} IN (${sql.join(
        payrollIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    );
}
