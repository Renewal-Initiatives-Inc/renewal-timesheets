/**
 * Database entity types shared between frontend and backend.
 * These types match the Drizzle schema but exclude internal fields.
 */

// Enums
export type EmployeeStatus = 'active' | 'archived';
export type DocumentType = 'parental_consent' | 'work_permit' | 'safety_training';
export type SupervisorRequired = 'none' | 'for_minors' | 'always';
export type TimesheetStatus = 'open' | 'submitted' | 'approved' | 'rejected';
export type ComplianceResult = 'pass' | 'fail' | 'not_applicable';
export type AgeBand = '12-13' | '14-15' | '16-17' | '18+';

// Employee
export interface Employee {
  id: string;
  name: string;
  email: string;
  dateOfBirth: string; // YYYY-MM-DD
  status: EmployeeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  type: DocumentType;
  filePath: string;
  uploadedAt: string;
  uploadedBy: string;
  expiresAt: string | null;
  invalidatedAt: string | null;
}

// Task Code
export interface TaskCode {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isAgricultural: boolean;
  isHazardous: boolean;
  supervisorRequired: SupervisorRequired;
  soloCashHandling: boolean;
  drivingRequired: boolean;
  powerMachinery: boolean;
  minAgeAllowed: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskCodeRate {
  id: string;
  taskCodeId: string;
  hourlyRate: string; // Decimal as string for precision
  effectiveDate: string;
  justificationNotes: string | null;
  createdAt: string;
}

// Timesheet
export interface Timesheet {
  id: string;
  employeeId: string;
  weekStartDate: string;
  status: TimesheetStatus;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  supervisorNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimesheetEntry {
  id: string;
  timesheetId: string;
  workDate: string;
  taskCodeId: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  hours: string; // Decimal as string
  isSchoolDay: boolean;
  schoolDayOverrideNote: string | null;
  supervisorPresentName: string | null;
  mealBreakConfirmed: boolean | null;
  notes: string | null;
  fundId: number | null; // references financial-system funds.id; NULL = General Fund
  createdAt: string;
}

// Fund (cached from financial-system)
export interface CachedFund {
  id: number;
  name: string;
  isActive: boolean;
}

// Staging Sync Status (local tracking of financial-system submissions)
export type StagingSyncStatusValue = 'received' | 'posted' | 'matched_to_payment' | 'paid' | 'error';

export interface StagingSyncRecord {
  id: string;
  timesheetId: string;
  sourceRecordId: string;
  fundId: number;
  amount: string; // Decimal as string
  status: StagingSyncStatusValue;
  metadata: StagingMetadata | null;
  syncedAt: string;
  lastCheckedAt: string | null;
}

export interface StagingMetadata {
  regularHours: string;
  overtimeHours: string;
  regularEarnings: string;
  overtimeEarnings: string;
}

// Compliance
export interface ComplianceDetails {
  ruleDescription: string;
  checkedValues: Record<string, unknown>;
  threshold?: number | string;
  actualValue?: number | string;
  message?: string;
}

export interface ComplianceCheckLog {
  id: string;
  timesheetId: string;
  ruleId: string;
  result: ComplianceResult;
  details: ComplianceDetails;
  checkedAt: string;
  employeeAgeOnDate: number;
}

// Payroll
export interface PayrollRecord {
  id: string;
  timesheetId: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  agriculturalHours: string;
  agriculturalEarnings: string;
  nonAgriculturalHours: string;
  nonAgriculturalEarnings: string;
  overtimeHours: string;
  overtimeEarnings: string;
  totalEarnings: string;
  calculatedAt: string;
  exportedAt: string | null;
}
