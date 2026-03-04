/**
 * Compliance Rule Engine.
 *
 * Orchestrates the evaluation of all compliance rules for a timesheet.
 * Responsible for:
 * - Building the context from timesheet data
 * - Running all applicable rules
 * - Logging results to the database
 * - Returning aggregated results
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { getTimesheetWithEntries, type TimesheetEntryWithTaskCode } from '../timesheet.service.js';
import { getAgeBand, getWeeklyAges, type AgeBand } from '../../utils/age.js';
import { getTodayET } from '../../utils/timezone.js';
import type {
  ComplianceContext,
  ComplianceEmployee,
  EmployeeDocument,
  ComplianceRule,
  RuleResult,
  ComplianceCheckResult,
  ComplianceViolation,
  ComplianceCheckOptions,
} from './types.js';

const { employees, employeeDocuments, complianceCheckLogs } = schema;

/**
 * Error thrown for compliance-related issues.
 */
export class ComplianceError extends Error {
  constructor(
    message: string,
    public code: 'TIMESHEET_NOT_FOUND' | 'EMPLOYEE_NOT_FOUND' | 'ENGINE_ERROR'
  ) {
    super(message);
    this.name = 'ComplianceError';
  }
}

/**
 * Registered compliance rules.
 */
let registeredRules: ComplianceRule[] = [];

/**
 * Register rules with the engine.
 */
export function registerRules(rules: ComplianceRule[]): void {
  registeredRules = [...registeredRules, ...rules];
}

/**
 * Clear all registered rules (for testing).
 */
export function clearRules(): void {
  registeredRules = [];
}

/**
 * Get all registered rules.
 */
export function getRules(): ComplianceRule[] {
  return [...registeredRules];
}

/**
 * Build compliance context from a timesheet ID.
 */
export async function buildContext(timesheetId: string): Promise<ComplianceContext> {
  // Fetch timesheet with entries
  const timesheet = await getTimesheetWithEntries(timesheetId);
  if (!timesheet) {
    throw new ComplianceError('Timesheet not found', 'TIMESHEET_NOT_FOUND');
  }

  // Fetch employee
  const employee = await db.query.employees.findFirst({
    where: eq(employees.id, timesheet.employeeId),
  });

  if (!employee) {
    throw new ComplianceError('Employee not found', 'EMPLOYEE_NOT_FOUND');
  }

  // Fetch employee documents
  const docs = await db.query.employeeDocuments.findMany({
    where: eq(employeeDocuments.employeeId, employee.id),
  });

  // Convert to public types
  const complianceEmployee: ComplianceEmployee = {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    dateOfBirth: employee.dateOfBirth,
    isSupervisor: false, // derived from Zitadel role, not DB
  };

  const documents: EmployeeDocument[] = docs.map((d) => ({
    id: d.id,
    employeeId: d.employeeId,
    type: d.type as 'parental_consent' | 'work_permit' | 'safety_training',
    filePath: d.filePath,
    uploadedAt: d.uploadedAt.toISOString(),
    uploadedBy: d.uploadedBy,
    expiresAt: d.expiresAt,
    invalidatedAt: d.invalidatedAt?.toISOString() ?? null,
  }));

  // Compute per-day ages
  const weeklyAges = getWeeklyAges(employee.dateOfBirth, timesheet.weekStartDate);
  const dailyAges = new Map<string, number>();
  const dailyAgeBands = new Map<string, AgeBand>();

  for (const [date, age] of weeklyAges) {
    dailyAges.set(date, age);
    try {
      dailyAgeBands.set(date, getAgeBand(age));
    } catch {
      // Age below minimum - will be caught by other rules
      dailyAgeBands.set(date, '12-13');
    }
  }

  // Compute daily hours and group entries by date
  const dailyHours = new Map<string, number>();
  const dailyEntries = new Map<string, TimesheetEntryWithTaskCode[]>();

  for (const entry of timesheet.entries) {
    const hours = parseFloat(entry.hours);
    dailyHours.set(entry.workDate, (dailyHours.get(entry.workDate) ?? 0) + hours);

    const entries = dailyEntries.get(entry.workDate) ?? [];
    entries.push(entry);
    dailyEntries.set(entry.workDate, entries);
  }

  // Identify school days and work days
  const schoolDays: string[] = [];
  const workDays: string[] = [];

  for (const entry of timesheet.entries) {
    if (entry.isSchoolDay && !schoolDays.includes(entry.workDate)) {
      schoolDays.push(entry.workDate);
    }
    if (!workDays.includes(entry.workDate)) {
      workDays.push(entry.workDate);
    }
  }

  // Determine if this is a school week
  const isSchoolWeek = schoolDays.length > 0;

  // Weekly total
  let weeklyTotal = 0;
  for (const hours of dailyHours.values()) {
    weeklyTotal += hours;
  }

  return {
    employee: complianceEmployee,
    timesheet,
    documents,
    dailyAges,
    dailyAgeBands,
    dailyHours,
    dailyEntries,
    schoolDays,
    workDays,
    weeklyTotal,
    isSchoolWeek,
    checkDate: getTodayET(),
  };
}

/**
 * Filter rules that apply to the employee based on age bands.
 */
export function filterApplicableRules(
  rules: ComplianceRule[],
  context: ComplianceContext
): ComplianceRule[] {
  // Get all age bands present in the timesheet week
  const ageBandsInWeek = new Set<AgeBand>();
  for (const ageBand of context.dailyAgeBands.values()) {
    ageBandsInWeek.add(ageBand);
  }

  // Filter rules that apply to at least one age band in the week
  return rules.filter((rule) => {
    // If rule has no age band restriction, it applies to all
    if (rule.appliesToAgeBands.length === 0) {
      return true;
    }

    // Check if any of the employee's age bands this week match
    for (const employeeAgeBand of ageBandsInWeek) {
      if (rule.appliesToAgeBands.includes(employeeAgeBand)) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Log compliance check results to the database.
 */
async function logResults(
  timesheetId: string,
  results: RuleResult[],
  context: ComplianceContext
): Promise<void> {
  // Get the primary age for logging (age at start of week)
  const startOfWeekAge = context.dailyAges.get(context.timesheet.weekStartDate) ?? 0;

  // Insert all results - ensure checkedValues is always provided
  const insertValues = results.map((result) => ({
    timesheetId,
    ruleId: result.ruleId,
    result: result.result,
    details: {
      ...result.details,
      checkedValues: result.details.checkedValues ?? {},
    },
    employeeAgeOnDate: startOfWeekAge,
  }));

  if (insertValues.length > 0) {
    await db.insert(complianceCheckLogs).values(insertValues);
  }
}

/**
 * Convert rule results to user-facing violations.
 */
function toViolations(failedRules: RuleResult[]): ComplianceViolation[] {
  return failedRules.map((rule) => ({
    ruleId: rule.ruleId,
    ruleName: rule.ruleName,
    message: rule.errorMessage ?? rule.details.message ?? 'Compliance check failed',
    remediation: rule.remediationGuidance ?? 'Please review and correct this issue.',
    affectedDates: rule.details.affectedDates,
    affectedEntries: rule.details.affectedEntries,
  }));
}

/**
 * Run all compliance checks for a timesheet.
 */
export async function runComplianceCheck(
  timesheetId: string,
  options: ComplianceCheckOptions = {}
): Promise<ComplianceCheckResult> {
  const { stopOnFirstFailure = false } = options;

  // Build context
  const context = await buildContext(timesheetId);

  // Get applicable rules
  const applicableRules = filterApplicableRules(registeredRules, context);

  // Evaluate each rule
  const results: RuleResult[] = [];
  const failedRules: RuleResult[] = [];
  const passedRules: RuleResult[] = [];
  const notApplicableRules: RuleResult[] = [];

  for (const rule of applicableRules) {
    try {
      const result = rule.evaluate(context);
      results.push(result);

      if (result.result === 'fail') {
        failedRules.push(result);
        if (stopOnFirstFailure) {
          break;
        }
      } else if (result.result === 'pass') {
        passedRules.push(result);
      } else {
        notApplicableRules.push(result);
      }
    } catch (error) {
      // Rule threw an error - treat as failure
      const errorResult: RuleResult = {
        ruleId: rule.id,
        ruleName: rule.name,
        result: 'fail',
        details: {
          ruleDescription: rule.name,
          message: `Rule evaluation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
        errorMessage:
          'An error occurred while checking compliance. Please contact your supervisor.',
        remediationGuidance: 'This may be a system issue. Please try again or contact support.',
      };
      results.push(errorResult);
      failedRules.push(errorResult);

      if (stopOnFirstFailure) {
        break;
      }
    }
  }

  // Log all results to database for audit
  await logResults(timesheetId, results, context);

  const checkedAt = new Date().toISOString();

  return {
    passed: failedRules.length === 0,
    timesheetId,
    employeeId: context.employee.id,
    checkedAt,
    results,
    failedRules,
    passedRules,
    notApplicableRules,
    violations: toViolations(failedRules),
  };
}

/**
 * Check if all rules pass without logging (for validation preview).
 */
export async function validateCompliance(
  timesheetId: string
): Promise<{ valid: boolean; violations: ComplianceViolation[] }> {
  const context = await buildContext(timesheetId);
  const applicableRules = filterApplicableRules(registeredRules, context);

  const failedRules: RuleResult[] = [];

  for (const rule of applicableRules) {
    try {
      const result = rule.evaluate(context);
      if (result.result === 'fail') {
        failedRules.push(result);
      }
    } catch {
      // Ignore errors in validation preview
    }
  }

  return {
    valid: failedRules.length === 0,
    violations: toViolations(failedRules),
  };
}
