import { eq, and, lte, gte, desc, sql, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getAgeBand, type AgeBand } from '../utils/age.js';
import { decryptDob } from '../utils/encryption.js';
import type { ComplianceDetails } from '../db/schema/compliance.js';

const { complianceCheckLogs, timesheets, employees, payrollRecords, taskCodeRates } = schema;

/**
 * Error codes for report operations.
 */
export type ReportErrorCode = 'INVALID_DATE_RANGE' | 'NO_DATA_FOUND';

/**
 * Error thrown for report-related business logic errors.
 */
export class ReportError extends Error {
  constructor(
    message: string,
    public code: ReportErrorCode
  ) {
    super(message);
    this.name = 'ReportError';
  }
}

/**
 * Filters for compliance audit report.
 */
export interface ComplianceAuditFilters {
  startDate: string;
  endDate: string;
  employeeId?: string;
  ageBand?: AgeBand;
  result?: 'pass' | 'fail' | 'not_applicable';
  ruleId?: string;
}

/**
 * A single compliance audit record with employee and timesheet info.
 */
export interface ComplianceAuditRecord {
  id: string;
  timesheetId: string;
  ruleId: string;
  result: 'pass' | 'fail' | 'not_applicable';
  details: ComplianceDetails;
  checkedAt: string;
  employeeAgeOnDate: number;
  ageBand: AgeBand;
  employeeId: string;
  employeeName: string;
  weekStartDate: string;
}

/**
 * Summary of compliance audit results.
 */
export interface ComplianceAuditSummary {
  totalChecks: number;
  passCount: number;
  failCount: number;
  notApplicableCount: number;
  uniqueTimesheets: number;
  uniqueEmployees: number;
  ruleBreakdown: { ruleId: string; passCount: number; failCount: number }[];
}

/**
 * Response for compliance audit report.
 */
export interface ComplianceAuditResponse {
  records: ComplianceAuditRecord[];
  summary: ComplianceAuditSummary;
}

/**
 * Filters for timesheet history report.
 */
export interface TimesheetHistoryFilters {
  startDate: string;
  endDate: string;
  employeeId?: string;
  status?: 'open' | 'submitted' | 'approved' | 'rejected';
  ageBand?: AgeBand;
  taskCodes?: string[];
}

/**
 * A lightweight entry summary for report views.
 */
export interface EntryLogItem {
  workDate: string;
  taskCode: string;
  taskName: string;
  startTime: string;
  endTime: string;
  hours: string;
  rate: string | null;
  notes: string | null;
}

/**
 * A single timesheet history record with employee info.
 */
export interface TimesheetHistoryRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  weekStartDate: string;
  status: string;
  totalHours: number;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  supervisorNotes: string | null;
  complianceCheckCount: number;
  complianceFailCount: number;
  totalEarnings: string | null;
  entries: EntryLogItem[];
}

/**
 * Summary of timesheet history results.
 */
export interface TimesheetHistorySummary {
  totalTimesheets: number;
  statusBreakdown: { status: string; count: number }[];
  totalHours: number;
  totalEarnings: number;
  employeeBreakdown: { employeeId: string; name: string; count: number }[];
}

/**
 * Response for timesheet history report.
 */
export interface TimesheetHistoryResponse {
  timesheets: TimesheetHistoryRecord[];
  summary: TimesheetHistorySummary;
}

/**
 * Get compliance audit records with filtering.
 */
export async function getComplianceAuditReport(
  filters: ComplianceAuditFilters
): Promise<ComplianceAuditResponse> {
  // Validate date range
  if (filters.startDate > filters.endDate) {
    throw new ReportError('Start date must be before or equal to end date', 'INVALID_DATE_RANGE');
  }

  // Build the query with joins
  const records = await db
    .select({
      id: complianceCheckLogs.id,
      timesheetId: complianceCheckLogs.timesheetId,
      ruleId: complianceCheckLogs.ruleId,
      result: complianceCheckLogs.result,
      details: complianceCheckLogs.details,
      checkedAt: complianceCheckLogs.checkedAt,
      employeeAgeOnDate: complianceCheckLogs.employeeAgeOnDate,
      employeeId: employees.id,
      employeeName: employees.name,
      weekStartDate: timesheets.weekStartDate,
    })
    .from(complianceCheckLogs)
    .innerJoin(timesheets, eq(complianceCheckLogs.timesheetId, timesheets.id))
    .innerJoin(employees, eq(timesheets.employeeId, employees.id))
    .where(
      and(
        gte(complianceCheckLogs.checkedAt, new Date(filters.startDate + 'T00:00:00Z')),
        lte(complianceCheckLogs.checkedAt, new Date(filters.endDate + 'T23:59:59Z')),
        filters.employeeId ? eq(employees.id, filters.employeeId) : undefined,
        filters.result ? eq(complianceCheckLogs.result, filters.result) : undefined,
        filters.ruleId ? eq(complianceCheckLogs.ruleId, filters.ruleId) : undefined
      )
    )
    .orderBy(desc(complianceCheckLogs.checkedAt));

  // Filter by age band in memory (since it requires calculation)
  let filteredRecords = records.map((r) => ({
    id: r.id,
    timesheetId: r.timesheetId,
    ruleId: r.ruleId,
    result: r.result,
    details: r.details as ComplianceDetails,
    checkedAt: r.checkedAt.toISOString(),
    employeeAgeOnDate: r.employeeAgeOnDate,
    ageBand: getAgeBandSafe(r.employeeAgeOnDate),
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    weekStartDate: r.weekStartDate,
  }));

  if (filters.ageBand) {
    filteredRecords = filteredRecords.filter((r) => r.ageBand === filters.ageBand);
  }

  // Calculate summary
  const summary = calculateComplianceAuditSummary(filteredRecords);

  return {
    records: filteredRecords,
    summary,
  };
}

/**
 * Get timesheet history records with filtering.
 */
export async function getTimesheetHistoryReport(
  filters: TimesheetHistoryFilters
): Promise<TimesheetHistoryResponse> {
  // Validate date range
  if (filters.startDate > filters.endDate) {
    throw new ReportError('Start date must be before or equal to end date', 'INVALID_DATE_RANGE');
  }

  // Build conditions
  const conditions = [
    gte(timesheets.weekStartDate, filters.startDate),
    lte(timesheets.weekStartDate, filters.endDate),
  ];

  if (filters.employeeId) {
    conditions.push(eq(timesheets.employeeId, filters.employeeId));
  }

  if (filters.status) {
    conditions.push(eq(timesheets.status, filters.status));
  }

  // Get timesheets with employee info
  const timesheetResults = await db.query.timesheets.findMany({
    where: and(...conditions),
    with: {
      employee: true,
      entries: {
        with: { taskCode: true },
        orderBy: (entries, { asc }) => [asc(entries.workDate), asc(entries.startTime)],
      },
    },
    orderBy: [desc(timesheets.weekStartDate)],
  });

  // Get compliance check counts for these timesheets
  const timesheetIds = timesheetResults.map((t) => t.id);
  const complianceCounts: Record<string, { total: number; failed: number }> = {};

  if (timesheetIds.length > 0) {
    const complianceResults = await db
      .select({
        timesheetId: complianceCheckLogs.timesheetId,
        result: complianceCheckLogs.result,
        count: sql<number>`count(*)`,
      })
      .from(complianceCheckLogs)
      .where(inArray(complianceCheckLogs.timesheetId, timesheetIds))
      .groupBy(complianceCheckLogs.timesheetId, complianceCheckLogs.result);

    for (const row of complianceResults) {
      if (!complianceCounts[row.timesheetId]) {
        complianceCounts[row.timesheetId] = { total: 0, failed: 0 };
      }
      complianceCounts[row.timesheetId]!.total += Number(row.count);
      if (row.result === 'fail') {
        complianceCounts[row.timesheetId]!.failed += Number(row.count);
      }
    }
  }

  // Get payroll records for approved timesheets
  const approvedTimesheetIds = timesheetResults
    .filter((t) => t.status === 'approved')
    .map((t) => t.id);
  const payrollMap: Record<string, string> = {};

  if (approvedTimesheetIds.length > 0) {
    const payrollResults = await db.query.payrollRecords.findMany({
      where: inArray(payrollRecords.timesheetId, approvedTimesheetIds),
    });

    for (const pr of payrollResults) {
      payrollMap[pr.timesheetId] = pr.totalEarnings;
    }
  }

  // Look up effective rates for all entries
  const allEntries = timesheetResults.flatMap((t) => t.entries);
  const uniqueTaskCodeIds = [...new Set(allEntries.map((e) => e.taskCodeId))];

  const allRates =
    uniqueTaskCodeIds.length > 0
      ? await db.query.taskCodeRates.findMany({
          where: inArray(taskCodeRates.taskCodeId, uniqueTaskCodeIds),
          orderBy: [desc(taskCodeRates.effectiveDate)],
        })
      : [];

  const ratesByTaskCode = new Map<string, (typeof allRates)>();
  for (const rate of allRates) {
    const existing = ratesByTaskCode.get(rate.taskCodeId) ?? [];
    existing.push(rate);
    ratesByTaskCode.set(rate.taskCodeId, existing);
  }

  function findEffectiveRate(taskCodeId: string, workDate: string): string | null {
    const rates = ratesByTaskCode.get(taskCodeId) ?? [];
    for (const rate of rates) {
      if (rate.effectiveDate <= workDate) {
        return rate.hourlyRate;
      }
    }
    return null;
  }

  // Build records with task code filtering and rate enrichment
  let records: TimesheetHistoryRecord[] = timesheetResults.map((t) => {
    const filteredEntries = t.entries.filter((e) => {
      if (filters.taskCodes && filters.taskCodes.length > 0) {
        return filters.taskCodes.includes(e.taskCode.code);
      }
      return true;
    });

    const totalHours = filteredEntries.reduce((sum, entry) => sum + parseFloat(entry.hours), 0);

    return {
      id: t.id,
      employeeId: t.employeeId,
      employeeName: t.employee.name,
      weekStartDate: t.weekStartDate,
      status: t.status,
      totalHours,
      submittedAt: t.submittedAt?.toISOString() ?? null,
      reviewedAt: t.reviewedAt?.toISOString() ?? null,
      reviewedBy: t.reviewedBy,
      supervisorNotes: t.supervisorNotes,
      complianceCheckCount: complianceCounts[t.id]?.total ?? 0,
      complianceFailCount: complianceCounts[t.id]?.failed ?? 0,
      totalEarnings: payrollMap[t.id] ?? null,
      entries: filteredEntries.map((e) => ({
        workDate: e.workDate,
        taskCode: e.taskCode.code,
        taskName: e.taskCode.name,
        startTime: e.startTime,
        endTime: e.endTime,
        hours: e.hours,
        rate: findEffectiveRate(e.taskCodeId, e.workDate),
        notes: e.notes,
      })),
      dateOfBirth: decryptDob(t.employee.dateOfBirth),
    };
  });

  // Remove timesheets with no matching entries after task code filtering
  if (filters.taskCodes && filters.taskCodes.length > 0) {
    records = records.filter((r) => r.entries.length > 0);
  }

  // Filter by age band if specified
  if (filters.ageBand) {
    records = records.filter((r) => {
      const recordWithDob = r as TimesheetHistoryRecord & { dateOfBirth: string };
      const age = calculateAgeOnDate(recordWithDob.dateOfBirth, recordWithDob.weekStartDate);
      const band = getAgeBandSafe(age);
      return band === filters.ageBand;
    });
  }

  // Remove dateOfBirth from final output
  const cleanRecords = records.map(({ ...r }) => {
    const { dateOfBirth: _dateOfBirth, ...clean } = r as TimesheetHistoryRecord & {
      dateOfBirth?: string;
    };
    return clean as TimesheetHistoryRecord;
  });

  // Calculate summary
  const summary = calculateTimesheetHistorySummary(cleanRecords, timesheetResults);

  return {
    timesheets: cleanRecords,
    summary,
  };
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
 * Get age band safely (returns '18+' for any age >= 12).
 */
function getAgeBandSafe(age: number): AgeBand {
  if (age < 12) return '12-13'; // Treat below 12 as youngest band
  return getAgeBand(age);
}

/**
 * Calculate compliance audit summary statistics.
 */
function calculateComplianceAuditSummary(records: ComplianceAuditRecord[]): ComplianceAuditSummary {
  const ruleMap = new Map<string, { passCount: number; failCount: number }>();
  const timesheetSet = new Set<string>();
  const employeeSet = new Set<string>();

  let passCount = 0;
  let failCount = 0;
  let notApplicableCount = 0;

  for (const record of records) {
    timesheetSet.add(record.timesheetId);
    employeeSet.add(record.employeeId);

    if (record.result === 'pass') passCount++;
    else if (record.result === 'fail') failCount++;
    else notApplicableCount++;

    // Update rule breakdown
    if (!ruleMap.has(record.ruleId)) {
      ruleMap.set(record.ruleId, { passCount: 0, failCount: 0 });
    }
    const ruleStats = ruleMap.get(record.ruleId)!;
    if (record.result === 'pass') ruleStats.passCount++;
    else if (record.result === 'fail') ruleStats.failCount++;
  }

  const ruleBreakdown = Array.from(ruleMap.entries()).map(([ruleId, stats]) => ({
    ruleId,
    ...stats,
  }));

  return {
    totalChecks: records.length,
    passCount,
    failCount,
    notApplicableCount,
    uniqueTimesheets: timesheetSet.size,
    uniqueEmployees: employeeSet.size,
    ruleBreakdown,
  };
}

/**
 * Calculate timesheet history summary statistics.
 */
function calculateTimesheetHistorySummary(
  records: TimesheetHistoryRecord[],
  _rawTimesheets: { employee: { id: string; name: string } }[]
): TimesheetHistorySummary {
  const statusMap = new Map<string, number>();
  const employeeMap = new Map<string, { name: string; count: number }>();

  let totalHours = 0;
  let totalEarnings = 0;

  for (const record of records) {
    // Status breakdown
    const statusCount = statusMap.get(record.status) ?? 0;
    statusMap.set(record.status, statusCount + 1);

    // Employee breakdown
    if (!employeeMap.has(record.employeeId)) {
      employeeMap.set(record.employeeId, { name: record.employeeName, count: 0 });
    }
    employeeMap.get(record.employeeId)!.count++;

    // Totals
    totalHours += record.totalHours;
    if (record.totalEarnings) {
      totalEarnings += parseFloat(record.totalEarnings);
    }
  }

  const statusBreakdown = Array.from(statusMap.entries()).map(([status, count]) => ({
    status,
    count,
  }));

  const employeeBreakdown = Array.from(employeeMap.entries()).map(([employeeId, data]) => ({
    employeeId,
    name: data.name,
    count: data.count,
  }));

  return {
    totalTimesheets: records.length,
    statusBreakdown,
    totalHours: Math.round(totalHours * 100) / 100,
    totalEarnings: Math.round(totalEarnings * 100) / 100,
    employeeBreakdown,
  };
}
