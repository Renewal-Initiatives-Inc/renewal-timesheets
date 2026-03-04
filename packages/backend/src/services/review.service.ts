import { eq, and, asc, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type {
  Timesheet,
  TimesheetStatus,
  ReviewQueueItem,
  TimesheetReviewData,
  ComplianceCheckLog,
  EmployeePublic,
  PayrollRecord,
} from '@renewal/types';
import { getTimesheetWithEntries } from './timesheet.service.js';
import { calculatePayrollForTimesheet } from './payroll.service.js';
import { submitStagingRecords, type StagingSubmitResult } from './staging.service.js';

const { timesheets, employees, complianceCheckLogs } = schema;

type TimesheetRow = typeof timesheets.$inferSelect;

/**
 * Error codes for review operations.
 */
export type ReviewErrorCode =
  | 'TIMESHEET_NOT_FOUND'
  | 'TIMESHEET_NOT_SUBMITTED'
  | 'NOTES_REQUIRED'
  | 'NOTES_TOO_SHORT'
  | 'NOT_SUPERVISOR'
  | 'EMPLOYEE_NOT_FOUND'
  | 'INVALID_WEEK_START_DATE';

/**
 * Error thrown for review-related business logic errors.
 */
export class ReviewError extends Error {
  constructor(
    message: string,
    public code: ReviewErrorCode
  ) {
    super(message);
    this.name = 'ReviewError';
  }
}

/**
 * Convert database row to public Timesheet.
 */
function toPublicTimesheet(row: TimesheetRow): Timesheet {
  return {
    id: row.id,
    employeeId: row.employeeId,
    weekStartDate: row.weekStartDate,
    status: row.status as TimesheetStatus,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    supervisorNotes: row.supervisorNotes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Validate that a date is a Sunday (week start).
 */
function isValidSunday(dateStr: string): boolean {
  const date = new Date(dateStr + 'T00:00:00');
  return date.getDay() === 0;
}

/**
 * Get all timesheets awaiting review (status = 'submitted').
 */
export async function getReviewQueue(options?: {
  employeeId?: string;
}): Promise<{ items: ReviewQueueItem[]; total: number }> {
  const conditions = [eq(timesheets.status, 'submitted')];

  if (options?.employeeId) {
    conditions.push(eq(timesheets.employeeId, options.employeeId));
  }

  // Get submitted timesheets with employee info
  const submittedTimesheets = await db.query.timesheets.findMany({
    where: and(...conditions),
    with: {
      employee: true,
      entries: true,
    },
    orderBy: [asc(timesheets.submittedAt)], // Oldest first (FIFO)
  });

  const items: ReviewQueueItem[] = submittedTimesheets.map((ts) => {
    // Calculate total hours from entries
    const totalHours = ts.entries.reduce((sum, entry) => {
      return sum + parseFloat(entry.hours);
    }, 0);

    return {
      id: ts.id,
      employeeId: ts.employeeId,
      employeeName: ts.employee.name,
      weekStartDate: ts.weekStartDate,
      submittedAt: ts.submittedAt?.toISOString() ?? '',
      totalHours,
      entryCount: ts.entries.length,
    };
  });

  return {
    items,
    total: items.length,
  };
}

/**
 * Get a single timesheet with full details for supervisor review.
 */
export async function getTimesheetForReview(
  timesheetId: string
): Promise<TimesheetReviewData | null> {
  // Get timesheet with entries
  const timesheet = await getTimesheetWithEntries(timesheetId);
  if (!timesheet) {
    return null;
  }

  // Get employee info
  const employee = await db.query.employees.findFirst({
    where: eq(employees.id, timesheet.employeeId),
  });

  if (!employee) {
    throw new ReviewError('Employee not found', 'EMPLOYEE_NOT_FOUND');
  }

  // Get compliance check logs for this timesheet
  const logs = await db.query.complianceCheckLogs.findMany({
    where: eq(complianceCheckLogs.timesheetId, timesheetId),
    orderBy: [asc(complianceCheckLogs.ruleId)],
  });

  const complianceLogs: ComplianceCheckLog[] = logs.map((log) => ({
    id: log.id,
    timesheetId: log.timesheetId,
    ruleId: log.ruleId,
    result: log.result as 'pass' | 'fail' | 'not_applicable',
    details: log.details as ComplianceCheckLog['details'],
    checkedAt: log.checkedAt.toISOString(),
    employeeAgeOnDate: log.employeeAgeOnDate,
  }));

  const employeePublic: EmployeePublic = {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    isSupervisor: false, // derived from Zitadel role, not DB
    dateOfBirth: employee.dateOfBirth,
    status: employee.status as 'active' | 'archived',
    createdAt: employee.createdAt.toISOString(),
  };

  return {
    timesheet: timesheet as unknown as TimesheetReviewData['timesheet'],
    employee: employeePublic,
    complianceLogs,
  };
}

/**
 * Get compliance check logs for a timesheet.
 */
export async function getComplianceLogs(timesheetId: string): Promise<ComplianceCheckLog[]> {
  const logs = await db.query.complianceCheckLogs.findMany({
    where: eq(complianceCheckLogs.timesheetId, timesheetId),
    orderBy: [asc(complianceCheckLogs.ruleId)],
  });

  return logs.map((log) => ({
    id: log.id,
    timesheetId: log.timesheetId,
    ruleId: log.ruleId,
    result: log.result as 'pass' | 'fail' | 'not_applicable',
    details: log.details as ComplianceCheckLog['details'],
    checkedAt: log.checkedAt.toISOString(),
    employeeAgeOnDate: log.employeeAgeOnDate,
  }));
}

/**
 * Result of approving a timesheet, including payroll information.
 */
export interface ApproveTimesheetResult {
  timesheet: Timesheet;
  payroll?: PayrollRecord;
  payrollError?: string;
  staging?: StagingSubmitResult;
  stagingError?: string;
}

/**
 * Approve a submitted timesheet.
 * Triggers payroll calculation after approval.
 */
export async function approveTimesheet(
  timesheetId: string,
  supervisorId: string,
  notes?: string
): Promise<ApproveTimesheetResult> {
  // Get timesheet
  const timesheet = await db.query.timesheets.findFirst({
    where: eq(timesheets.id, timesheetId),
  });

  if (!timesheet) {
    throw new ReviewError('Timesheet not found', 'TIMESHEET_NOT_FOUND');
  }

  if (timesheet.status !== 'submitted') {
    throw new ReviewError(
      `Cannot approve timesheet with status: ${timesheet.status}`,
      'TIMESHEET_NOT_SUBMITTED'
    );
  }

  // Update timesheet
  const now = new Date();
  const [updated] = await db
    .update(timesheets)
    .set({
      status: 'approved',
      reviewedBy: supervisorId,
      reviewedAt: now,
      supervisorNotes: notes || null,
      updatedAt: now,
    })
    .where(eq(timesheets.id, timesheetId))
    .returning();

  const approvedTimesheet = toPublicTimesheet(updated!);

  // Calculate payroll
  let payroll: PayrollRecord | undefined;
  let payrollError: string | undefined;

  try {
    payroll = await calculatePayrollForTimesheet(timesheetId);
  } catch (error) {
    console.error('Payroll calculation failed for timesheet', timesheetId, error);
    payrollError = 'Payroll calculation pending - manual recalculation required';
  }

  // Submit staging records to financial-system (non-blocking)
  let staging: StagingSubmitResult | undefined;
  let stagingError: string | undefined;

  try {
    staging = await submitStagingRecords(timesheetId);
  } catch (error) {
    console.error('Staging submission failed for timesheet', timesheetId, error);
    stagingError = error instanceof Error ? error.message : 'Staging submission failed';
  }

  return { timesheet: approvedTimesheet, payroll, payrollError, staging, stagingError };
}

/**
 * Reject a submitted timesheet.
 * Notes are required and must be at least 10 characters.
 */
export async function rejectTimesheet(
  timesheetId: string,
  supervisorId: string,
  notes: string
): Promise<Timesheet> {
  // Validate notes
  if (!notes || notes.trim().length === 0) {
    throw new ReviewError('Notes are required when rejecting a timesheet', 'NOTES_REQUIRED');
  }

  if (notes.trim().length < 10) {
    throw new ReviewError(
      'Notes must be at least 10 characters when rejecting a timesheet',
      'NOTES_TOO_SHORT'
    );
  }

  // Get timesheet
  const timesheet = await db.query.timesheets.findFirst({
    where: eq(timesheets.id, timesheetId),
  });

  if (!timesheet) {
    throw new ReviewError('Timesheet not found', 'TIMESHEET_NOT_FOUND');
  }

  if (timesheet.status !== 'submitted') {
    throw new ReviewError(
      `Cannot reject timesheet with status: ${timesheet.status}`,
      'TIMESHEET_NOT_SUBMITTED'
    );
  }

  // Update timesheet - return to 'open' status
  const now = new Date();
  const [updated] = await db
    .update(timesheets)
    .set({
      status: 'open',
      reviewedBy: supervisorId,
      reviewedAt: now,
      supervisorNotes: notes.trim(),
      updatedAt: now,
    })
    .where(eq(timesheets.id, timesheetId))
    .returning();

  return toPublicTimesheet(updated!);
}

/**
 * Unlock a historical week for an employee.
 * Creates a new timesheet if none exists, or reopens an existing one.
 */
export async function unlockWeek(
  employeeId: string,
  weekStartDate: string,
  supervisorId: string
): Promise<Timesheet> {
  // Validate week start date is a Sunday
  if (!isValidSunday(weekStartDate)) {
    throw new ReviewError('Week start date must be a Sunday', 'INVALID_WEEK_START_DATE');
  }

  // Verify employee exists
  const employee = await db.query.employees.findFirst({
    where: eq(employees.id, employeeId),
  });

  if (!employee) {
    throw new ReviewError('Employee not found', 'EMPLOYEE_NOT_FOUND');
  }

  // Check for existing timesheet
  const existing = await db.query.timesheets.findFirst({
    where: and(eq(timesheets.employeeId, employeeId), eq(timesheets.weekStartDate, weekStartDate)),
  });

  const now = new Date();

  if (existing) {
    // Reopen existing timesheet
    const [updated] = await db
      .update(timesheets)
      .set({
        status: 'open',
        reviewedBy: supervisorId,
        reviewedAt: now,
        supervisorNotes: `Week unlocked by supervisor on ${now.toISOString()}`,
        updatedAt: now,
      })
      .where(eq(timesheets.id, existing.id))
      .returning();

    return toPublicTimesheet(updated!);
  }

  // Create new timesheet for the week
  const [newTimesheet] = await db
    .insert(timesheets)
    .values({
      employeeId,
      weekStartDate,
      status: 'open',
      supervisorNotes: `Week unlocked by supervisor on ${now.toISOString()}`,
    })
    .returning();

  return toPublicTimesheet(newTimesheet!);
}

/**
 * Get count of timesheets pending review.
 */
export async function getPendingReviewCount(): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(timesheets)
    .where(eq(timesheets.status, 'submitted'));

  return Number(result[0]?.count ?? 0);
}
