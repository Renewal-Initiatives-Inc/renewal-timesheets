import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { TimesheetEntry } from '@renewal/types';
import { isDefaultSchoolDay, timeToMinutes } from '../utils/timezone.js';
import { getWeekDates } from './timesheet.service.js';
import { calculateAge } from '../utils/age.js';
import { decryptDob } from '../utils/encryption.js';

const { timesheetEntries, timesheets, taskCodes } = schema;

type TimesheetEntryRow = typeof timesheetEntries.$inferSelect;

/**
 * Error codes for timesheet entry operations.
 */
export type TimesheetEntryErrorCode =
  | 'ENTRY_NOT_FOUND'
  | 'INVALID_TIME_RANGE'
  | 'DATE_OUTSIDE_WEEK'
  | 'TIMESHEET_NOT_EDITABLE'
  | 'TIMESHEET_NOT_FOUND'
  | 'TASK_CODE_NOT_FOUND'
  | 'TASK_CODE_AGE_RESTRICTED'
  | 'HOUR_LIMIT_EXCEEDED';

/**
 * Error thrown for timesheet entry-related business logic errors.
 */
export class TimesheetEntryError extends Error {
  constructor(
    message: string,
    public code: TimesheetEntryErrorCode
  ) {
    super(message);
    this.name = 'TimesheetEntryError';
  }
}

/**
 * Convert database row to public TimesheetEntry.
 */
function toPublicEntry(row: TimesheetEntryRow): TimesheetEntry {
  return {
    id: row.id,
    timesheetId: row.timesheetId,
    workDate: row.workDate,
    taskCodeId: row.taskCodeId,
    startTime: row.startTime,
    endTime: row.endTime,
    hours: row.hours,
    isSchoolDay: row.isSchoolDay,
    schoolDayOverrideNote: row.schoolDayOverrideNote,
    supervisorPresentName: row.supervisorPresentName,
    mealBreakConfirmed: row.mealBreakConfirmed,
    notes: row.notes,
    fundId: row.fundId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Calculate hours from start and end time strings (HH:MM).
 * Returns decimal hours rounded to 2 places.
 */
export function calculateHours(startTime: string, endTime: string): number {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  if (endMinutes <= startMinutes) {
    throw new TimesheetEntryError('End time must be after start time', 'INVALID_TIME_RANGE');
  }

  const totalMinutes = endMinutes - startMinutes;
  return Math.round((totalMinutes / 60) * 100) / 100;
}

/**
 * Check if a date is valid for a timesheet week.
 */
export function validateEntryDate(weekStartDate: string, workDate: string): boolean {
  const weekDates = getWeekDates(weekStartDate);
  return weekDates.includes(workDate);
}

/**
 * Get default school day status for a date.
 */
export function getDefaultSchoolDayStatus(workDate: string): boolean {
  return isDefaultSchoolDay(workDate);
}

/**
 * Result of hour limit validation.
 */
interface HourValidationResult {
  valid: boolean;
  error?: string;
  dailyTotal?: number;
  dailyLimit?: number;
  weeklyTotal?: number;
  weeklyLimit?: number;
}

/**
 * Validate that an entry doesn't exceed hour limits.
 * Checks both daily and weekly limits based on employee age.
 */
async function validateHourLimits(
  timesheetId: string,
  workDate: string,
  newHours: number,
  isSchoolDay: boolean,
  excludeEntryId?: string // For updates, exclude the entry being updated
): Promise<HourValidationResult> {
  // Get timesheet with employee info
  const timesheet = await db.query.timesheets.findFirst({
    where: eq(timesheets.id, timesheetId),
    with: { employee: true },
  });

  if (!timesheet || !timesheet.employee) {
    return { valid: false, error: 'Timesheet or employee not found' };
  }

  // Calculate employee age on work date (DOB is AES-256-GCM encrypted in DB)
  const dob = decryptDob(timesheet.employee.dateOfBirth);
  const age = calculateAge(dob, workDate);
  const limits = getHourLimitsForAge(age);

  // Get existing entries for this timesheet
  const entries = await db.query.timesheetEntries.findMany({
    where: eq(timesheetEntries.timesheetId, timesheetId),
  });

  // Calculate current totals (excluding entry being updated)
  let dailyTotal = 0;
  let weeklyTotal = 0;

  for (const entry of entries) {
    if (excludeEntryId && entry.id === excludeEntryId) continue;

    const hours = parseFloat(entry.hours);
    weeklyTotal += hours;

    if (entry.workDate === workDate) {
      dailyTotal += hours;
    }
  }

  // Add new hours
  const newDailyTotal = dailyTotal + newHours;
  const newWeeklyTotal = weeklyTotal + newHours;

  // Determine daily limit (school day vs non-school day for 14-15)
  const dailyLimit =
    limits.dailyLimitSchoolDay !== undefined && isSchoolDay
      ? limits.dailyLimitSchoolDay
      : limits.dailyLimit;

  // Determine weekly limit (use school week limit if available)
  const weeklyLimit = limits.weeklyLimitSchoolWeek ?? limits.weeklyLimit;

  // Check daily limit
  if (newDailyTotal > dailyLimit) {
    return {
      valid: false,
      error: `This entry would exceed the daily limit of ${dailyLimit} hours for your age group (${age} years old). Current: ${dailyTotal.toFixed(1)}h, Entry: ${newHours.toFixed(1)}h, Total would be: ${newDailyTotal.toFixed(1)}h`,
      dailyTotal: newDailyTotal,
      dailyLimit,
    };
  }

  // Check weekly limit
  if (newWeeklyTotal > weeklyLimit) {
    return {
      valid: false,
      error: `This entry would exceed the weekly limit of ${weeklyLimit} hours for your age group (${age} years old). Current: ${weeklyTotal.toFixed(1)}h, Entry: ${newHours.toFixed(1)}h, Total would be: ${newWeeklyTotal.toFixed(1)}h`,
      weeklyTotal: newWeeklyTotal,
      weeklyLimit,
    };
  }

  return { valid: true };
}

/**
 * Input for creating a timesheet entry.
 */
export interface CreateEntryInput {
  workDate: string;
  taskCodeId: string;
  startTime: string;
  endTime: string;
  isSchoolDay: boolean;
  schoolDayOverrideNote?: string | null;
  supervisorPresentName?: string | null;
  mealBreakConfirmed?: boolean | null;
  notes?: string | null;
  fundId?: number | null;
}

/**
 * Create a new timesheet entry.
 */
export async function createEntry(
  timesheetId: string,
  input: CreateEntryInput
): Promise<TimesheetEntry> {
  // Get and validate timesheet
  const timesheet = await db.query.timesheets.findFirst({
    where: eq(timesheets.id, timesheetId),
  });

  if (!timesheet) {
    throw new TimesheetEntryError('Timesheet not found', 'TIMESHEET_NOT_FOUND');
  }

  if (timesheet.status !== 'open') {
    throw new TimesheetEntryError(
      `Cannot add entries to timesheet with status: ${timesheet.status}`,
      'TIMESHEET_NOT_EDITABLE'
    );
  }

  // Validate work date is within the timesheet week
  if (!validateEntryDate(timesheet.weekStartDate, input.workDate)) {
    throw new TimesheetEntryError(
      'Work date must be within the timesheet week',
      'DATE_OUTSIDE_WEEK'
    );
  }

  // Validate task code exists
  const taskCode = await db.query.taskCodes.findFirst({
    where: eq(taskCodes.id, input.taskCodeId),
  });

  if (!taskCode) {
    throw new TimesheetEntryError('Task code not found', 'TASK_CODE_NOT_FOUND');
  }

  // Calculate hours
  const hours = calculateHours(input.startTime, input.endTime);

  // Validate hour limits before saving
  const validation = await validateHourLimits(
    timesheetId,
    input.workDate,
    hours,
    input.isSchoolDay
  );
  if (!validation.valid) {
    throw new TimesheetEntryError(validation.error!, 'HOUR_LIMIT_EXCEEDED');
  }

  // Create entry
  const [newEntry] = await db
    .insert(timesheetEntries)
    .values({
      timesheetId,
      workDate: input.workDate,
      taskCodeId: input.taskCodeId,
      startTime: input.startTime,
      endTime: input.endTime,
      hours: hours.toFixed(2),
      isSchoolDay: input.isSchoolDay,
      schoolDayOverrideNote: input.schoolDayOverrideNote ?? null,
      supervisorPresentName: input.supervisorPresentName ?? null,
      mealBreakConfirmed: input.mealBreakConfirmed ?? null,
      notes: input.notes ?? null,
      fundId: input.fundId ?? null,
    })
    .returning();

  return toPublicEntry(newEntry!);
}

/**
 * Result of bulk entry creation.
 */
export interface BulkCreateResult {
  entries: TimesheetEntry[];
  created: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
}

/**
 * Create multiple timesheet entries in a single operation.
 * Used for multi-day drag in timeline UI.
 * All entries must have the same task code, start/end times, and supervisor/meal settings.
 * This performs validation for each entry individually but creates them in a batch.
 */
export async function createMultipleEntries(
  timesheetId: string,
  entries: CreateEntryInput[]
): Promise<BulkCreateResult> {
  // Get and validate timesheet once
  const timesheet = await db.query.timesheets.findFirst({
    where: eq(timesheets.id, timesheetId),
  });

  if (!timesheet) {
    throw new TimesheetEntryError('Timesheet not found', 'TIMESHEET_NOT_FOUND');
  }

  if (timesheet.status !== 'open') {
    throw new TimesheetEntryError(
      `Cannot add entries to timesheet with status: ${timesheet.status}`,
      'TIMESHEET_NOT_EDITABLE'
    );
  }

  // Validate task code exists (assuming all entries use the same task code)
  if (entries.length > 0) {
    const taskCodeId = entries[0]!.taskCodeId;
    const taskCode = await db.query.taskCodes.findFirst({
      where: eq(taskCodes.id, taskCodeId),
    });

    if (!taskCode) {
      throw new TimesheetEntryError('Task code not found', 'TASK_CODE_NOT_FOUND');
    }
  }

  const results: TimesheetEntry[] = [];
  const errors: Array<{ index: number; error: string }> = [];

  // Process each entry
  for (let i = 0; i < entries.length; i++) {
    const input = entries[i]!;

    try {
      // Validate work date is within the timesheet week
      if (!validateEntryDate(timesheet.weekStartDate, input.workDate)) {
        errors.push({ index: i, error: `Work date ${input.workDate} is not within the timesheet week` });
        continue;
      }

      // Calculate hours
      const hours = calculateHours(input.startTime, input.endTime);

      // Insert entry
      const [newEntry] = await db
        .insert(timesheetEntries)
        .values({
          timesheetId,
          workDate: input.workDate,
          taskCodeId: input.taskCodeId,
          startTime: input.startTime,
          endTime: input.endTime,
          hours: hours.toFixed(2),
          isSchoolDay: input.isSchoolDay,
          schoolDayOverrideNote: input.schoolDayOverrideNote ?? null,
          supervisorPresentName: input.supervisorPresentName ?? null,
          mealBreakConfirmed: input.mealBreakConfirmed ?? null,
          notes: input.notes ?? null,
          fundId: input.fundId ?? null,
        })
        .returning();

      results.push(toPublicEntry(newEntry!));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      errors.push({ index: i, error: errorMessage });
    }
  }

  return {
    entries: results,
    created: results.length,
    failed: errors.length,
    errors,
  };
}

/**
 * Input for updating a timesheet entry.
 */
export interface UpdateEntryInput {
  startTime?: string;
  endTime?: string;
  taskCodeId?: string;
  isSchoolDay?: boolean;
  schoolDayOverrideNote?: string | null;
  supervisorPresentName?: string | null;
  mealBreakConfirmed?: boolean | null;
  notes?: string | null;
  fundId?: number | null;
}

/**
 * Update an existing timesheet entry.
 */
export async function updateEntry(
  entryId: string,
  input: UpdateEntryInput
): Promise<TimesheetEntry> {
  // Get entry with timesheet
  const entry = await db.query.timesheetEntries.findFirst({
    where: eq(timesheetEntries.id, entryId),
    with: {
      timesheet: true,
    },
  });

  if (!entry) {
    throw new TimesheetEntryError('Entry not found', 'ENTRY_NOT_FOUND');
  }

  if (entry.timesheet.status !== 'open') {
    throw new TimesheetEntryError(
      `Cannot update entries on timesheet with status: ${entry.timesheet.status}`,
      'TIMESHEET_NOT_EDITABLE'
    );
  }

  // Validate task code if being changed
  if (input.taskCodeId) {
    const taskCode = await db.query.taskCodes.findFirst({
      where: eq(taskCodes.id, input.taskCodeId),
    });

    if (!taskCode) {
      throw new TimesheetEntryError('Task code not found', 'TASK_CODE_NOT_FOUND');
    }
  }

  // Build update object
  const updates: Partial<typeof timesheetEntries.$inferInsert> = {};

  // Handle time changes
  const newStartTime = input.startTime ?? entry.startTime;
  const newEndTime = input.endTime ?? entry.endTime;

  if (input.startTime || input.endTime) {
    const hours = calculateHours(newStartTime, newEndTime);

    // Validate hour limits before saving (exclude current entry from calculation)
    const isSchoolDay = input.isSchoolDay ?? entry.isSchoolDay;
    const validation = await validateHourLimits(
      entry.timesheet.id,
      entry.workDate,
      hours,
      isSchoolDay,
      entryId // Exclude this entry from calculation
    );
    if (!validation.valid) {
      throw new TimesheetEntryError(validation.error!, 'HOUR_LIMIT_EXCEEDED');
    }

    updates.startTime = newStartTime;
    updates.endTime = newEndTime;
    updates.hours = hours.toFixed(2);
  }

  if (input.taskCodeId !== undefined) updates.taskCodeId = input.taskCodeId;
  if (input.isSchoolDay !== undefined) updates.isSchoolDay = input.isSchoolDay;
  if (input.schoolDayOverrideNote !== undefined)
    updates.schoolDayOverrideNote = input.schoolDayOverrideNote;
  if (input.supervisorPresentName !== undefined)
    updates.supervisorPresentName = input.supervisorPresentName;
  if (input.mealBreakConfirmed !== undefined) updates.mealBreakConfirmed = input.mealBreakConfirmed;
  if (input.notes !== undefined) updates.notes = input.notes;
  if (input.fundId !== undefined) updates.fundId = input.fundId;

  const [updated] = await db
    .update(timesheetEntries)
    .set(updates)
    .where(eq(timesheetEntries.id, entryId))
    .returning();

  return toPublicEntry(updated!);
}

/**
 * Delete a timesheet entry.
 */
export async function deleteEntry(entryId: string): Promise<void> {
  // Get entry with timesheet
  const entry = await db.query.timesheetEntries.findFirst({
    where: eq(timesheetEntries.id, entryId),
    with: {
      timesheet: true,
    },
  });

  if (!entry) {
    throw new TimesheetEntryError('Entry not found', 'ENTRY_NOT_FOUND');
  }

  if (entry.timesheet.status !== 'open') {
    throw new TimesheetEntryError(
      `Cannot delete entries from timesheet with status: ${entry.timesheet.status}`,
      'TIMESHEET_NOT_EDITABLE'
    );
  }

  await db.delete(timesheetEntries).where(eq(timesheetEntries.id, entryId));
}

/**
 * Get an entry by ID.
 */
export async function getEntryById(entryId: string): Promise<TimesheetEntry | null> {
  const entry = await db.query.timesheetEntries.findFirst({
    where: eq(timesheetEntries.id, entryId),
  });

  if (!entry) {
    return null;
  }

  return toPublicEntry(entry);
}

/**
 * Get daily totals for a timesheet.
 */
export async function getDailyTotals(timesheetId: string): Promise<Record<string, number>> {
  const entries = await db.query.timesheetEntries.findMany({
    where: eq(timesheetEntries.timesheetId, timesheetId),
  });

  const totals: Record<string, number> = {};
  for (const entry of entries) {
    const hours = parseFloat(entry.hours);
    totals[entry.workDate] = (totals[entry.workDate] || 0) + hours;
  }

  return totals;
}

/**
 * Get weekly total for a timesheet.
 */
export async function getWeeklyTotal(timesheetId: string): Promise<number> {
  const entries = await db.query.timesheetEntries.findMany({
    where: eq(timesheetEntries.timesheetId, timesheetId),
  });

  let total = 0;
  for (const entry of entries) {
    total += parseFloat(entry.hours);
  }

  return Math.round(total * 100) / 100;
}

/**
 * Get all entries for a timesheet grouped by date.
 */
export async function getEntriesGroupedByDate(
  timesheetId: string
): Promise<Map<string, TimesheetEntry[]>> {
  const entries = await db.query.timesheetEntries.findMany({
    where: eq(timesheetEntries.timesheetId, timesheetId),
    orderBy: [timesheetEntries.startTime],
  });

  const grouped = new Map<string, TimesheetEntry[]>();
  for (const entry of entries) {
    const publicEntry = toPublicEntry(entry);
    const existing = grouped.get(entry.workDate) || [];
    existing.push(publicEntry);
    grouped.set(entry.workDate, existing);
  }

  return grouped;
}

/**
 * Hour limits by age band.
 */
export interface HourLimits {
  dailyLimit: number;
  dailyLimitSchoolDay?: number; // Different limit for school days (14-15)
  weeklyLimit: number;
  weeklyLimitSchoolWeek?: number; // Different limit for school weeks (14-15)
  daysWorkedLimit?: number; // Max days per week (16-17)
}

/**
 * Get hour limits based on age.
 */
export function getHourLimitsForAge(age: number): HourLimits {
  if (age >= 18) {
    return {
      dailyLimit: 24, // No limit
      weeklyLimit: 168, // No limit
    };
  }

  if (age >= 16) {
    return {
      dailyLimit: 9,
      weeklyLimit: 48,
      daysWorkedLimit: 6,
    };
  }

  if (age >= 14) {
    return {
      dailyLimit: 8, // Non-school day
      dailyLimitSchoolDay: 3,
      weeklyLimit: 40, // Non-school week
      weeklyLimitSchoolWeek: 18,
    };
  }

  // Ages 12-13
  return {
    dailyLimit: 4,
    weeklyLimit: 24,
  };
}

/**
 * Get age band string.
 */
export function getAgeBand(age: number): '12-13' | '14-15' | '16-17' | '18+' {
  if (age >= 18) return '18+';
  if (age >= 16) return '16-17';
  if (age >= 14) return '14-15';
  return '12-13';
}

// ============================================================================
// Entry Compliance Preview (for Timeline UI Phase 3)
// ============================================================================

import type {
  EntryCompliancePreview,
  EntryPreviewRequest,
  ComplianceWarning,
  ComplianceViolation,
} from '@renewal/types';

/**
 * Preview compliance for a proposed entry without saving.
 * Returns violations, warnings, limits, and requirements.
 */
export async function previewEntryCompliance(
  timesheetId: string,
  entry: EntryPreviewRequest
): Promise<EntryCompliancePreview> {
  // Get timesheet with employee info
  const timesheet = await db.query.timesheets.findFirst({
    where: eq(timesheets.id, timesheetId),
    with: { employee: true },
  });

  if (!timesheet || !timesheet.employee) {
    throw new TimesheetEntryError('Timesheet not found', 'TIMESHEET_NOT_FOUND');
  }

  // Calculate employee age on work date (DOB is AES-256-GCM encrypted in DB)
  const dob = decryptDob(timesheet.employee.dateOfBirth);
  const age = calculateAge(dob, entry.workDate);
  const limits = getHourLimitsForAge(age);
  const isMinor = age < 18;

  // Calculate proposed hours
  const proposedHours = calculateHours(entry.startTime, entry.endTime);

  // Get existing entries for this timesheet
  const existingEntries = await db.query.timesheetEntries.findMany({
    where: eq(timesheetEntries.timesheetId, timesheetId),
  });

  // Calculate current totals
  let currentDailyHours = 0;
  let currentWeeklyHours = 0;

  for (const e of existingEntries) {
    const hours = parseFloat(e.hours);
    currentWeeklyHours += hours;
    if (e.workDate === entry.workDate) {
      currentDailyHours += hours;
    }
  }

  // Determine applicable daily limit
  const dailyLimit =
    limits.dailyLimitSchoolDay !== undefined && entry.isSchoolDay
      ? limits.dailyLimitSchoolDay
      : limits.dailyLimit;

  // Determine applicable weekly limit
  // Check if this is a school week (has at least one school day entry or proposed is on school day)
  const hasSchoolDayEntry = existingEntries.some((e) => e.isSchoolDay) || entry.isSchoolDay;
  const weeklyLimit =
    limits.weeklyLimitSchoolWeek !== undefined && hasSchoolDayEntry
      ? limits.weeklyLimitSchoolWeek
      : limits.weeklyLimit;

  // Calculate projected totals
  const projectedDailyHours = currentDailyHours + proposedHours;
  const projectedWeeklyHours = currentWeeklyHours + proposedHours;

  // Build violations and warnings
  const violations: ComplianceViolation[] = [];
  const warnings: ComplianceWarning[] = [];

  // Check daily limit
  if (projectedDailyHours > dailyLimit) {
    violations.push({
      ruleId: 'HOUR_LIMIT_DAILY',
      ruleName: 'Daily Hour Limit',
      message: `This entry would exceed the daily limit of ${dailyLimit} hours for your age group. Current: ${currentDailyHours.toFixed(1)}h + Entry: ${proposedHours.toFixed(1)}h = ${projectedDailyHours.toFixed(1)}h`,
      remediation: `Reduce the entry to ${Math.max(0, dailyLimit - currentDailyHours).toFixed(1)} hours or less.`,
      affectedDates: [entry.workDate],
    });
  } else if (projectedDailyHours >= dailyLimit * 0.8) {
    warnings.push({
      code: 'APPROACHING_DAILY_LIMIT',
      message: `Approaching daily limit (${projectedDailyHours.toFixed(1)}/${dailyLimit}h)`,
    });
  }

  // Check weekly limit
  if (projectedWeeklyHours > weeklyLimit) {
    violations.push({
      ruleId: 'HOUR_LIMIT_WEEKLY',
      ruleName: 'Weekly Hour Limit',
      message: `This entry would exceed the weekly limit of ${weeklyLimit} hours. Current: ${currentWeeklyHours.toFixed(1)}h + Entry: ${proposedHours.toFixed(1)}h = ${projectedWeeklyHours.toFixed(1)}h`,
      remediation: `Reduce total weekly hours to ${weeklyLimit} hours or less.`,
    });
  } else if (projectedWeeklyHours >= weeklyLimit * 0.8) {
    warnings.push({
      code: 'APPROACHING_WEEKLY_LIMIT',
      message: `Approaching weekly limit (${projectedWeeklyHours.toFixed(1)}/${weeklyLimit}h)`,
    });
  }

  // Check school hours (7 AM - 3 PM) for minors on school days
  if (isMinor && entry.isSchoolDay) {
    const startMinutes = timeToMinutes(entry.startTime);
    const endMinutes = timeToMinutes(entry.endTime);
    const schoolStartMinutes = 7 * 60; // 7 AM
    const schoolEndMinutes = 15 * 60; // 3 PM

    // Check if any part of the entry overlaps school hours
    if (startMinutes < schoolEndMinutes && endMinutes > schoolStartMinutes) {
      violations.push({
        ruleId: 'SCHOOL_HOURS_VIOLATION',
        ruleName: 'School Hours Prohibition',
        message: `Workers under 18 cannot work during school hours (7:00 AM - 3:00 PM) on school days.`,
        remediation: `Adjust the entry to start after 3:00 PM or change the school day designation.`,
        affectedDates: [entry.workDate],
      });
    }
  }

  // Check task age restrictions
  if (entry.taskCodeId) {
    const taskCode = await db.query.taskCodes.findFirst({
      where: eq(taskCodes.id, entry.taskCodeId),
    });

    if (taskCode) {
      if (age < taskCode.minAgeAllowed) {
        violations.push({
          ruleId: 'TASK_AGE_RESTRICTION',
          ruleName: 'Task Age Restriction',
          message: `The task "${taskCode.name}" requires a minimum age of ${taskCode.minAgeAllowed}. You are ${age} years old on this date.`,
          remediation: `Select a different task code that is allowed for your age.`,
        });
      }

      // Hazardous task check
      if (isMinor && taskCode.isHazardous) {
        violations.push({
          ruleId: 'HAZARDOUS_TASK_MINOR',
          ruleName: 'Hazardous Task Restriction',
          message: `Workers under 18 cannot perform hazardous tasks like "${taskCode.name}".`,
          remediation: `Select a non-hazardous task code.`,
        });
      }
    }
  }

  // Determine requirements
  let supervisorRequired = false;
  let supervisorReason: string | undefined;
  let mealBreakRequired = false;
  let mealBreakReason: string | undefined;

  // Check task for supervisor requirement
  if (entry.taskCodeId) {
    const taskCode = await db.query.taskCodes.findFirst({
      where: eq(taskCodes.id, entry.taskCodeId),
    });

    if (taskCode) {
      if (
        taskCode.supervisorRequired === 'always' ||
        (taskCode.supervisorRequired === 'for_minors' && isMinor)
      ) {
        supervisorRequired = true;
        supervisorReason =
          taskCode.supervisorRequired === 'always'
            ? `Task "${taskCode.name}" requires a supervisor for all workers.`
            : `Task "${taskCode.name}" requires a supervisor for workers under 18.`;
      }
    }
  }

  // Check meal break requirement (>6 hours for minors)
  if (isMinor && proposedHours > 6) {
    mealBreakRequired = true;
    mealBreakReason =
      'Massachusetts law requires a 30-minute meal break for shifts over 6 hours for workers under 18.';
  }

  return {
    valid: violations.length === 0,
    warnings,
    violations,
    limits: {
      daily: {
        current: currentDailyHours,
        limit: dailyLimit,
        remaining: Math.max(0, dailyLimit - currentDailyHours),
      },
      weekly: {
        current: currentWeeklyHours,
        limit: weeklyLimit,
        remaining: Math.max(0, weeklyLimit - currentWeeklyHours),
      },
    },
    requirements: {
      supervisorRequired,
      mealBreakRequired,
      supervisorReason,
      mealBreakReason,
    },
    proposedHours,
  };
}
