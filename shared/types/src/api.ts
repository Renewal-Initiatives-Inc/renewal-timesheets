/**
 * API Response Types
 * Shared between frontend and backend for type-safe API communication
 */

import type {
  AgeBand,
  CachedFund,
  DocumentType,
  EmployeeDocument,
  SupervisorRequired,
  TaskCode,
  TaskCodeRate,
} from './db.js';

export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

// ============================================================================
// Authentication Types
// ============================================================================

/**
 * Public employee information (no sensitive fields).
 */
export interface EmployeePublic {
  id: string;
  name: string;
  email: string;
  isSupervisor: boolean;
  dateOfBirth: string;
  status: 'active' | 'archived';
  createdAt: string;
}

/**
 * Current user response.
 */
export interface MeResponse {
  employee: EmployeePublic;
}

// ============================================================================
// Employee Management Types
// ============================================================================

/**
 * Required documents based on employee age.
 */
export interface RequiredDocuments {
  parentalConsent: boolean;
  workPermit: boolean;
  safetyTraining: boolean;
  coppaDisclosure: boolean; // Required for ages 12-13
}

/**
 * Documentation status for an employee.
 */
export interface DocumentationStatus {
  isComplete: boolean;
  missingDocuments: DocumentType[];
  expiringDocuments: Array<{
    type: DocumentType;
    expiresAt: string;
    daysUntilExpiry: number;
  }>;
  hasValidConsent: boolean;
  hasValidWorkPermit: boolean | null; // null if not required
  safetyTrainingComplete: boolean;
}

/**
 * Employee with documentation status summary.
 */
export interface EmployeeWithDocStatus extends EmployeePublic {
  age: number;
  ageBand: AgeBand;
  documentation: {
    isComplete: boolean;
    missingCount: number;
    expiringCount: number;
  };
}

/**
 * Employee detail response with full documentation.
 */
export interface EmployeeDetailResponse {
  employee: EmployeeWithDocStatus;
  documents: EmployeeDocument[];
  requiredDocuments: RequiredDocuments;
  documentationStatus: DocumentationStatus;
}

/**
 * Employee list response.
 */
export interface EmployeeListResponse {
  employees: EmployeeWithDocStatus[];
}

// UpdateEmployeeRequest, UpdateEmployeeResponse, ArchiveEmployeeResponse removed
// — employee data managed in app-portal

// ============================================================================
// Document Management Types
// ============================================================================

/**
 * Document upload request metadata.
 */
export interface DocumentUploadRequest {
  type: DocumentType;
  expiresAt?: string; // Required for work permits
}

/**
 * Document response.
 */
export interface DocumentResponse {
  document: EmployeeDocument;
}

/**
 * Document download URL response.
 */
export interface DocumentDownloadResponse {
  url: string;
  expiresAt: string;
}

/**
 * Document invalidation response.
 */
export interface DocumentInvalidateResponse {
  message: string;
}

// ============================================================================
// Dashboard Types
// ============================================================================

/**
 * Dashboard alert types.
 */
export type AlertType = 'missing_document' | 'expiring_document' | 'age_transition';

/**
 * Dashboard alert.
 */
export interface DashboardAlert {
  type: AlertType;
  employeeId: string;
  employeeName: string;
  message: string;
  dueDate?: string;
}

/**
 * Dashboard employees response.
 */
export interface DashboardEmployeesResponse {
  employees: EmployeeWithDocStatus[];
}

/**
 * Dashboard alerts response.
 */
export interface DashboardAlertsResponse {
  alerts: DashboardAlert[];
}

/**
 * Dashboard stats response.
 */
export interface DashboardStats {
  totalEmployees: number;
  completeDocumentation: number;
  missingDocumentation: number;
  expiringDocuments: number;
  pendingReviewCount: number;
  byAgeBand: {
    '12-13': number;
    '14-15': number;
    '16-17': number;
    '18+': number;
  };
}

/**
 * Dashboard stats response.
 */
export interface DashboardStatsResponse {
  stats: DashboardStats;
}

// ============================================================================
// Task Code Management Types
// ============================================================================

/**
 * Task code with its current effective rate.
 */
export interface TaskCodeWithCurrentRate extends TaskCode {
  currentRate: number;
}

/**
 * Task code detail with rate history.
 */
export interface TaskCodeDetailResponse {
  taskCode: TaskCodeWithCurrentRate & {
    rateHistory: TaskCodeRate[];
  };
}

/**
 * Task code list response.
 */
export interface TaskCodeListResponse {
  taskCodes: TaskCodeWithCurrentRate[];
  total: number;
}

/**
 * Create task code request.
 */
export interface CreateTaskCodeRequest {
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

/**
 * Update task code request.
 * Note: code field cannot be changed after creation.
 */
export interface UpdateTaskCodeRequest {
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

/**
 * Add rate request.
 */
export interface AddRateRequest {
  hourlyRate: number;
  effectiveDate: string;
  justificationNotes?: string;
}

/**
 * Task code list query parameters.
 */
export interface TaskCodeListParams {
  isAgricultural?: 'true' | 'false';
  isHazardous?: 'true' | 'false';
  forAge?: number;
  includeInactive?: 'true' | 'false';
  search?: string;
}

/**
 * Task code error codes.
 */
export type TaskCodeErrorCode =
  | 'TASK_CODE_NOT_FOUND'
  | 'CODE_ALREADY_EXISTS'
  | 'INVALID_MIN_AGE'
  | 'RATE_NOT_FOUND'
  | 'INVALID_EFFECTIVE_DATE'
  | 'CODE_IMMUTABLE'
  | 'EMPLOYEE_NOT_FOUND';

// ============================================================================
// Fund Types (financial-system integration)
// ============================================================================

/**
 * Fund list response (from local cache).
 */
export interface FundListResponse {
  funds: CachedFund[];
  lastSyncedAt: string | null;
}

/**
 * Fund sync response.
 */
export interface FundSyncResponse {
  synced: number;
  message: string;
}

// ============================================================================
// Staging Record Types (financial-system integration)
// ============================================================================

import type { StagingSyncRecord } from './db.js';

/**
 * Result of submitting staging records on approval.
 */
export interface StagingSubmitResult {
  submitted: number;
  records: Array<{
    sourceRecordId: string;
    fundId: number;
    amount: string;
  }>;
}

/**
 * Financial status for a timesheet (per-fund staging status).
 */
export interface TimesheetFinancialStatus {
  timesheetId: string;
  records: StagingSyncRecord[];
  allPosted: boolean;
}

// ============================================================================
// Timesheet Types
// ============================================================================

import type { Timesheet, TimesheetEntry, TimesheetStatus } from './db.js';

/**
 * Timesheet entry with associated task code information.
 */
export interface TimesheetEntryWithTaskCode extends TimesheetEntry {
  taskCode: TaskCodeWithCurrentRate;
}

/**
 * Hour limits based on age band.
 */
export interface HourLimits {
  dailyLimit: number;
  dailyLimitSchoolDay?: number; // Different limit for school days (14-15)
  weeklyLimit: number;
  weeklyLimitSchoolWeek?: number; // Different limit for school weeks (14-15)
  daysWorkedLimit?: number; // Max days per week (16-17)
}

/**
 * Timesheet totals with limits and warnings.
 */
export interface TimesheetTotals {
  daily: Record<string, number>; // { '2024-01-15': 4.5, ... }
  weekly: number;
  limits: HourLimits;
  warnings: string[];
}

/**
 * Birthday information for a week.
 */
export interface BirthdayInfo {
  date: string;
  newAge: number;
}

/**
 * Timesheet with entries and calculated totals.
 */
export interface TimesheetWithEntries extends Timesheet {
  entries: TimesheetEntryWithTaskCode[];
  totals: TimesheetTotals;
  birthdayInWeek?: BirthdayInfo;
}

/**
 * Create timesheet entry request.
 */
export interface CreateEntryRequest {
  workDate: string; // YYYY-MM-DD
  taskCodeId: string;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  isSchoolDay: boolean;
  schoolDayOverrideNote?: string | null;
  supervisorPresentName?: string | null;
  mealBreakConfirmed?: boolean | null;
  notes?: string | null;
  fundId?: number | null; // references financial-system funds.id; omit or null = General Fund
}

/**
 * Update timesheet entry request.
 */
export interface UpdateEntryRequest {
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
 * Timesheet list response.
 */
export interface TimesheetListResponse {
  timesheets: Timesheet[];
  total: number;
}

/**
 * Timesheet list query parameters.
 */
export interface TimesheetListParams {
  status?: 'open' | 'submitted' | 'approved' | 'rejected' | 'all';
  limit?: number;
  offset?: number;
}

/**
 * Week day information.
 */
export interface WeekDayInfo {
  date: string;
  dayOfWeek: string;
  isSchoolDay: boolean;
  employeeAge: number;
}

/**
 * Week information for a timesheet.
 */
export interface WeekInfo {
  weekStartDate: string;
  weekEndDate: string;
  dates: WeekDayInfo[];
  birthdayInWeek?: BirthdayInfo;
}

/**
 * Timesheet error codes.
 */
export type TimesheetErrorCode =
  | 'TIMESHEET_NOT_FOUND'
  | 'TIMESHEET_NOT_EDITABLE'
  | 'TIMESHEET_ACCESS_DENIED'
  | 'EMPLOYEE_NOT_FOUND'
  | 'INVALID_WEEK_START_DATE'
  | 'ENTRY_NOT_FOUND'
  | 'INVALID_TIME_RANGE'
  | 'DATE_OUTSIDE_WEEK'
  | 'TASK_CODE_NOT_FOUND'
  | 'TASK_CODE_AGE_RESTRICTED';

// ============================================================================
// Compliance Types
// ============================================================================

import type { ComplianceCheckLog } from './db.js';

/**
 * Compliance violation details for display.
 */
export interface ComplianceViolation {
  ruleId: string;
  ruleName: string;
  message: string;
  remediation: string;
  affectedDates?: string[];
  affectedEntries?: string[];
}

/**
 * Compliance summary statistics.
 */
export interface ComplianceSummary {
  total: number;
  passed: number;
  failed: number;
  notApplicable: number;
}

/**
 * Timesheet submission result.
 */
export interface SubmitTimesheetResult {
  passed: boolean;
  message?: string;
  status?: TimesheetStatus;
  violations?: ComplianceViolation[];
  summary?: ComplianceSummary;
}

/**
 * Compliance validation result (preview without submission).
 */
export interface ValidateTimesheetResult {
  passed: boolean;
  violations?: ComplianceViolation[];
  summary?: ComplianceSummary;
}

// ============================================================================
// Supervisor Review Types
// ============================================================================

/**
 * Review queue item (summary for list view).
 */
export interface ReviewQueueItem {
  id: string;
  employeeId: string;
  employeeName: string;
  weekStartDate: string;
  submittedAt: string;
  totalHours: number;
  entryCount: number;
}

/**
 * Full timesheet data for supervisor review.
 */
export interface TimesheetReviewData {
  timesheet: TimesheetWithEntries;
  employee: EmployeePublic;
  complianceLogs: ComplianceCheckLog[];
}

/**
 * Approve timesheet request.
 */
export interface ApproveTimesheetRequest {
  notes?: string;
}

/**
 * Approve timesheet response.
 */
export interface ApproveTimesheetResponse {
  success: boolean;
  timesheet: Timesheet;
  message: string;
}

/**
 * Reject timesheet request.
 */
export interface RejectTimesheetRequest {
  notes: string; // Required, minimum 10 characters
}

/**
 * Reject timesheet response.
 */
export interface RejectTimesheetResponse {
  success: boolean;
  timesheet: Timesheet;
  message: string;
}

/**
 * Unlock week request.
 */
export interface UnlockWeekRequest {
  employeeId: string;
  weekStartDate: string;
}

/**
 * Unlock week response.
 */
export interface UnlockWeekResponse {
  success: boolean;
  timesheet: Timesheet;
  message: string;
}

/**
 * Review queue response.
 */
export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
  total: number;
}

/**
 * Supervisor review error codes.
 */
export type ReviewErrorCode =
  | 'TIMESHEET_NOT_FOUND'
  | 'TIMESHEET_NOT_SUBMITTED'
  | 'NOTES_REQUIRED'
  | 'NOTES_TOO_SHORT'
  | 'NOT_SUPERVISOR'
  | 'EMPLOYEE_NOT_FOUND'
  | 'INVALID_WEEK_START_DATE';

// ============================================================================
// Payroll Types
// ============================================================================

import type { PayrollRecord } from './db.js';

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
 * Payroll report query parameters.
 */
export interface PayrollReportParams {
  startDate: string;
  endDate: string;
  employeeId?: string;
}

/**
 * Payroll report summary statistics.
 */
export interface PayrollReportSummary {
  totalRecords: number;
  totalAgriculturalHours: string;
  totalAgriculturalEarnings: string;
  totalNonAgriculturalHours: string;
  totalNonAgriculturalEarnings: string;
  totalOvertimeHours: string;
  totalOvertimeEarnings: string;
  totalEarnings: string;
}

/**
 * Payroll report response.
 */
export interface PayrollReportResponse {
  records: PayrollRecordWithDetails[];
  summary: PayrollReportSummary;
}

/**
 * Payroll record response (single record).
 */
export interface PayrollRecordResponse {
  payroll: PayrollRecord;
}

/**
 * Payroll recalculation response.
 */
export interface PayrollRecalculateResponse {
  success: boolean;
  payroll: PayrollRecord;
  message: string;
}

/**
 * Approve timesheet response with payroll (updated).
 */
export interface ApproveTimesheetWithPayrollResponse {
  success: boolean;
  timesheet: Timesheet;
  payroll?: PayrollRecord;
  payrollError?: string;
  message: string;
}

/**
 * Payroll error codes.
 */
export type PayrollErrorCode =
  | 'TIMESHEET_NOT_FOUND'
  | 'TIMESHEET_NOT_APPROVED'
  | 'NO_RATE_FOUND'
  | 'PAYROLL_ALREADY_EXISTS'
  | 'PAYROLL_NOT_FOUND'
  | 'INVALID_DATE_RANGE';

// ============================================================================
// Entry Compliance Preview Types (for Timeline UI Phase 3)
// ============================================================================

/**
 * Warning about a proposed entry (informational, doesn't block).
 */
export interface ComplianceWarning {
  code: string;
  message: string;
  field?: string; // Which field caused the warning
}

/**
 * Request to preview compliance for a proposed entry.
 */
export interface EntryPreviewRequest {
  workDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  taskCodeId: string;
  isSchoolDay: boolean;
}

/**
 * Limit information with current and remaining hours.
 */
export interface LimitInfo {
  current: number;
  limit: number;
  remaining: number;
}

/**
 * Requirements for a proposed entry based on compliance rules.
 */
export interface EntryRequirements {
  supervisorRequired: boolean;
  mealBreakRequired: boolean;
  supervisorReason?: string;
  mealBreakReason?: string;
}

/**
 * Result of previewing compliance for a proposed entry.
 */
export interface EntryCompliancePreview {
  valid: boolean;
  warnings: ComplianceWarning[];
  violations: ComplianceViolation[];
  limits: {
    daily: LimitInfo;
    weekly: LimitInfo;
  };
  requirements: EntryRequirements;
  proposedHours: number;
}
