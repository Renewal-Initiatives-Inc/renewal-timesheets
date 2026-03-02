import { eq, and, like, or, lte, desc, asc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { TaskCode, TaskCodeRate, SupervisorRequired } from '@renewal/types';

const { taskCodes, taskCodeRates, employees } = schema;

type TaskCodeRow = typeof taskCodes.$inferSelect;
type TaskCodeRateRow = typeof taskCodeRates.$inferSelect;

const MIN_AGE_ALLOWED = 12;

/**
 * Error codes for task code operations.
 */
export type TaskCodeErrorCode =
  | 'TASK_CODE_NOT_FOUND'
  | 'CODE_ALREADY_EXISTS'
  | 'INVALID_MIN_AGE'
  | 'RATE_NOT_FOUND'
  | 'INVALID_EFFECTIVE_DATE'
  | 'CODE_IMMUTABLE'
  | 'EMPLOYEE_NOT_FOUND';

/**
 * Error thrown for task code-related business logic errors.
 */
export class TaskCodeError extends Error {
  constructor(
    message: string,
    public code: TaskCodeErrorCode
  ) {
    super(message);
    this.name = 'TaskCodeError';
  }
}

/**
 * Convert database row to public TaskCode.
 */
function toPublicTaskCode(row: TaskCodeRow): TaskCode {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isAgricultural: row.isAgricultural,
    isHazardous: row.isHazardous,
    supervisorRequired: row.supervisorRequired as SupervisorRequired,
    soloCashHandling: row.soloCashHandling,
    drivingRequired: row.drivingRequired,
    powerMachinery: row.powerMachinery,
    minAgeAllowed: row.minAgeAllowed,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Convert database row to public TaskCodeRate.
 */
function toPublicRate(row: TaskCodeRateRow): TaskCodeRate {
  return {
    id: row.id,
    taskCodeId: row.taskCodeId,
    hourlyRate: row.hourlyRate,
    effectiveDate: row.effectiveDate,
    justificationNotes: row.justificationNotes,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * TaskCode with its current effective rate.
 */
export interface TaskCodeWithCurrentRate extends TaskCode {
  currentRate: number;
}

/**
 * TaskCode detail with rate history.
 */
export interface TaskCodeDetail extends TaskCodeWithCurrentRate {
  rateHistory: TaskCodeRate[];
}

/**
 * Options for listing task codes.
 */
export interface ListTaskCodesOptions {
  isAgricultural?: boolean;
  isHazardous?: boolean;
  forAge?: number;
  includeInactive?: boolean;
  search?: string;
}

/**
 * Get the effective rate for a task code on a given date.
 * Returns the most recent rate that has an effective date on or before the given date.
 */
export async function getEffectiveRate(
  taskCodeId: string,
  asOfDate: string = new Date().toISOString().split('T')[0]!
): Promise<number | null> {
  const rate = await db.query.taskCodeRates.findFirst({
    where: and(
      eq(taskCodeRates.taskCodeId, taskCodeId),
      lte(taskCodeRates.effectiveDate, asOfDate)
    ),
    orderBy: [desc(taskCodeRates.effectiveDate)],
  });

  if (!rate) {
    return null;
  }

  return parseFloat(rate.hourlyRate);
}

/**
 * List all task codes with optional filters.
 */
export async function listTaskCodes(
  options: ListTaskCodesOptions = {}
): Promise<{ taskCodes: TaskCodeWithCurrentRate[]; total: number }> {
  const { isAgricultural, isHazardous, forAge, includeInactive = false, search } = options;

  // Build where conditions
  const conditions = [];

  // Filter by active status (soft archive)
  if (!includeInactive) {
    conditions.push(eq(taskCodes.isActive, true));
  }

  if (isAgricultural !== undefined) {
    conditions.push(eq(taskCodes.isAgricultural, isAgricultural));
  }

  if (isHazardous !== undefined) {
    conditions.push(eq(taskCodes.isHazardous, isHazardous));
  }

  if (forAge !== undefined) {
    // Only return tasks where minAgeAllowed <= employee age
    conditions.push(lte(taskCodes.minAgeAllowed, forAge));
  }

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(or(like(taskCodes.code, searchPattern), like(taskCodes.name, searchPattern)));
  }

  // Fetch task codes with their rates in a single query (avoids N+1)
  const taskCodeList = await db.query.taskCodes.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [asc(taskCodes.code)],
    with: {
      rates: {
        orderBy: [desc(taskCodeRates.effectiveDate)],
      },
    },
  });

  // Resolve current rate from the pre-loaded rates (no additional queries)
  const today = new Date().toISOString().split('T')[0]!;
  const results: TaskCodeWithCurrentRate[] = taskCodeList.map((tc) => {
    const currentRate = tc.rates.find((r) => r.effectiveDate <= today);
    return {
      ...toPublicTaskCode(tc),
      currentRate: currentRate ? parseFloat(currentRate.hourlyRate) : 0,
    };
  });

  return {
    taskCodes: results,
    total: results.length,
  };
}

/**
 * Get a single task code by ID with rate history.
 */
export async function getTaskCodeById(id: string): Promise<TaskCodeDetail | null> {
  const taskCode = await db.query.taskCodes.findFirst({
    where: eq(taskCodes.id, id),
    with: {
      rates: {
        orderBy: [desc(taskCodeRates.effectiveDate)],
      },
    },
  });

  if (!taskCode) {
    return null;
  }

  const today = new Date().toISOString().split('T')[0]!;
  const currentRate = await getEffectiveRate(id, today);

  return {
    ...toPublicTaskCode(taskCode),
    currentRate: currentRate ?? 0,
    rateHistory: taskCode.rates.map(toPublicRate),
  };
}

/**
 * Get a task code by its code string.
 */
export async function getTaskCodeByCode(code: string): Promise<TaskCodeWithCurrentRate | null> {
  const taskCode = await db.query.taskCodes.findFirst({
    where: eq(taskCodes.code, code.toUpperCase()),
  });

  if (!taskCode) {
    return null;
  }

  const today = new Date().toISOString().split('T')[0]!;
  const currentRate = await getEffectiveRate(taskCode.id, today);

  return {
    ...toPublicTaskCode(taskCode),
    currentRate: currentRate ?? 0,
  };
}

/**
 * Create a new task code with its initial rate.
 */
export interface CreateTaskCodeInput {
  code: string;
  name: string;
  description?: string;
  isAgricultural: boolean;
  isHazardous: boolean;
  supervisorRequired: SupervisorRequired;
  minAgeAllowed: number;
  soloCashHandling: boolean;
  drivingRequired: boolean;
  powerMachinery: boolean;
  initialRate: number;
  rateEffectiveDate: string;
  rateJustificationNotes?: string;
}

export async function createTaskCode(input: CreateTaskCodeInput): Promise<TaskCodeWithCurrentRate> {
  // Validate minimum age
  if (input.minAgeAllowed < MIN_AGE_ALLOWED) {
    throw new TaskCodeError(
      `Minimum age allowed must be at least ${MIN_AGE_ALLOWED}`,
      'INVALID_MIN_AGE'
    );
  }

  // Check for duplicate code
  const existingCode = await db.query.taskCodes.findFirst({
    where: eq(taskCodes.code, input.code.toUpperCase()),
  });

  if (existingCode) {
    throw new TaskCodeError(`Task code "${input.code}" already exists`, 'CODE_ALREADY_EXISTS');
  }

  // Create task code
  const [newTaskCode] = await db
    .insert(taskCodes)
    .values({
      code: input.code.toUpperCase(),
      name: input.name,
      description: input.description ?? null,
      isAgricultural: input.isAgricultural,
      isHazardous: input.isHazardous,
      supervisorRequired: input.supervisorRequired,
      minAgeAllowed: input.minAgeAllowed,
      soloCashHandling: input.soloCashHandling,
      drivingRequired: input.drivingRequired,
      powerMachinery: input.powerMachinery,
    })
    .returning();

  // Create initial rate
  await db.insert(taskCodeRates).values({
    taskCodeId: newTaskCode!.id,
    hourlyRate: input.initialRate.toFixed(2),
    effectiveDate: input.rateEffectiveDate.split('T')[0]!, // Extract date part
    justificationNotes: input.rateJustificationNotes ?? null,
  });

  return {
    ...toPublicTaskCode(newTaskCode!),
    currentRate: input.initialRate,
  };
}

/**
 * Update a task code.
 * Note: The code field cannot be changed after creation.
 */
export interface UpdateTaskCodeInput {
  name?: string;
  description?: string;
  isAgricultural?: boolean;
  isHazardous?: boolean;
  supervisorRequired?: SupervisorRequired;
  minAgeAllowed?: number;
  soloCashHandling?: boolean;
  drivingRequired?: boolean;
  powerMachinery?: boolean;
  isActive?: boolean; // For soft archive
}

export async function updateTaskCode(
  id: string,
  input: UpdateTaskCodeInput
): Promise<TaskCodeWithCurrentRate> {
  const taskCode = await db.query.taskCodes.findFirst({
    where: eq(taskCodes.id, id),
  });

  if (!taskCode) {
    throw new TaskCodeError('Task code not found', 'TASK_CODE_NOT_FOUND');
  }

  // Validate minimum age if provided
  if (input.minAgeAllowed !== undefined && input.minAgeAllowed < MIN_AGE_ALLOWED) {
    throw new TaskCodeError(
      `Minimum age allowed must be at least ${MIN_AGE_ALLOWED}`,
      'INVALID_MIN_AGE'
    );
  }

  const updates: Partial<typeof taskCodes.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.isAgricultural !== undefined) updates.isAgricultural = input.isAgricultural;
  if (input.isHazardous !== undefined) updates.isHazardous = input.isHazardous;
  if (input.supervisorRequired !== undefined) updates.supervisorRequired = input.supervisorRequired;
  if (input.minAgeAllowed !== undefined) updates.minAgeAllowed = input.minAgeAllowed;
  if (input.soloCashHandling !== undefined) updates.soloCashHandling = input.soloCashHandling;
  if (input.drivingRequired !== undefined) updates.drivingRequired = input.drivingRequired;
  if (input.powerMachinery !== undefined) updates.powerMachinery = input.powerMachinery;
  if (input.isActive !== undefined) updates.isActive = input.isActive;

  const [updated] = await db.update(taskCodes).set(updates).where(eq(taskCodes.id, id)).returning();

  const today = new Date().toISOString().split('T')[0]!;
  const currentRate = await getEffectiveRate(id, today);

  return {
    ...toPublicTaskCode(updated!),
    currentRate: currentRate ?? 0,
  };
}

/**
 * Add a new rate to a task code.
 * The effective date cannot be in the past.
 */
export interface AddRateInput {
  hourlyRate: number;
  effectiveDate: string;
  justificationNotes?: string;
}

export async function addRate(taskCodeId: string, input: AddRateInput): Promise<TaskCodeRate> {
  const taskCode = await db.query.taskCodes.findFirst({
    where: eq(taskCodes.id, taskCodeId),
  });

  if (!taskCode) {
    throw new TaskCodeError('Task code not found', 'TASK_CODE_NOT_FOUND');
  }

  // Validate effective date is not in the past
  const today = new Date().toISOString().split('T')[0]!;
  const effectiveDateStr = input.effectiveDate.split('T')[0]!;

  if (effectiveDateStr < today) {
    throw new TaskCodeError('Effective date cannot be in the past', 'INVALID_EFFECTIVE_DATE');
  }

  const [newRate] = await db
    .insert(taskCodeRates)
    .values({
      taskCodeId,
      hourlyRate: input.hourlyRate.toFixed(2),
      effectiveDate: effectiveDateStr,
      justificationNotes: input.justificationNotes ?? null,
    })
    .returning();

  return toPublicRate(newRate!);
}

/**
 * Get rate history for a task code.
 */
export async function getRateHistory(taskCodeId: string): Promise<TaskCodeRate[]> {
  const taskCode = await db.query.taskCodes.findFirst({
    where: eq(taskCodes.id, taskCodeId),
  });

  if (!taskCode) {
    throw new TaskCodeError('Task code not found', 'TASK_CODE_NOT_FOUND');
  }

  const rates = await db.query.taskCodeRates.findMany({
    where: eq(taskCodeRates.taskCodeId, taskCodeId),
    orderBy: [desc(taskCodeRates.effectiveDate)],
  });

  return rates.map(toPublicRate);
}

/**
 * Get task codes filtered for a specific employee based on their age.
 * @param employeeId - The employee's ID
 * @param asOfDate - Optional date to calculate age as of (YYYY-MM-DD format). Defaults to today.
 */
export async function getTaskCodesForEmployee(
  employeeId: string,
  asOfDate?: string
): Promise<{ taskCodes: TaskCodeWithCurrentRate[]; total: number }> {
  const employee = await db.query.employees.findFirst({
    where: eq(employees.id, employeeId),
  });

  if (!employee) {
    throw new TaskCodeError('Employee not found', 'EMPLOYEE_NOT_FOUND');
  }

  // Calculate employee's age as of the specified date (or today)
  const referenceDate = asOfDate ? new Date(asOfDate + 'T00:00:00') : new Date();
  const birthDate = new Date(employee.dateOfBirth + 'T00:00:00');
  let age = referenceDate.getFullYear() - birthDate.getFullYear();
  const monthDiff = referenceDate.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < birthDate.getDate())) {
    age--;
  }

  // Get task codes appropriate for this age
  return listTaskCodes({ forAge: age });
}
