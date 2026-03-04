import type {
  EmployeePublic,
  EmployeeDetailResponse,
  EmployeeListResponse,
  DocumentationStatus,
  RequiredDocuments,
  DashboardAlertsResponse,
  EmployeeDocument,
  ApiError,
  TaskCodeWithCurrentRate,
  TaskCodeListResponse,
  TaskCodeDetailResponse,
  CreateTaskCodeRequest,
  UpdateTaskCodeRequest,
  AddRateRequest,
  TaskCodeListParams,
  TaskCodeRate,
  TimesheetWithEntries,
  TimesheetListResponse,
  TimesheetListParams,
  TimesheetEntry,
  CreateEntryRequest,
  UpdateEntryRequest,
  TimesheetTotals,
  WeekInfo,
  FundListResponse,
  FundSyncResponse,
} from '@renewal/types';

const API_BASE = '/api';

/**
 * Custom error for API calls with enhanced diagnostics
 */
export class ApiRequestError extends Error {
  public readonly isTimeout: boolean;
  public readonly endpoint: string;
  public readonly timestamp: string;
  public readonly diagnosticInfo: string;
  public readonly responseBody: Record<string, unknown>;

  constructor(
    message: string,
    public status: number,
    public code?: string,
    endpoint?: string,
    responseBody?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.endpoint = endpoint || 'unknown';
    this.timestamp = new Date().toISOString();
    this.isTimeout = status === 504 || code === 'FUNCTION_INVOCATION_TIMEOUT';
    this.responseBody = responseBody || {};

    // Build diagnostic string for easy debugging
    this.diagnosticInfo = [
      `Status: ${status}`,
      `Endpoint: ${this.endpoint}`,
      `Time: ${this.timestamp}`,
      code ? `Code: ${code}` : null,
      this.isTimeout ? 'Type: SERVERLESS_TIMEOUT' : null,
    ]
      .filter(Boolean)
      .join(' | ');
  }

  /**
   * Get a user-friendly error message
   */
  getUserMessage(): string {
    if (this.isTimeout) {
      return 'The server took too long to respond. This may happen during high load or after periods of inactivity. Please try again in a moment.';
    }
    return this.message;
  }

  /**
   * Log diagnostic info to console for debugging
   */
  logDiagnostics(): void {
    console.error(`[API Error] ${this.diagnosticInfo}`);
    console.error(`[API Error] Message: ${this.message}`);
    if (this.isTimeout) {
      console.error(
        '[API Error] This is a serverless function timeout (10s limit on Vercel Hobby)'
      );
      console.error('[API Error] Consider: retry the request, or check Vercel function logs');
    }
  }
}

/**
 * Check if an error is a timeout error
 */
export function isTimeoutError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.isTimeout;
}

/**
 * Format error for display, with special handling for timeouts
 */
export function formatApiError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    error.logDiagnostics();
    return error.getUserMessage();
  }
  if (error instanceof Error) {
    // Network errors (offline, DNS failure, etc.)
    if (error.message === 'Failed to fetch') {
      return 'Unable to connect to the server. Please check your internet connection.';
    }
    return error.message;
  }
  return 'An unexpected error occurred. Please try again.';
}

/**
 * Get the current auth token from localStorage
 */
function getAuthToken(): string | null {
  return localStorage.getItem('token');
}

/**
 * Set the auth token in localStorage
 */
export function setAuthToken(token: string): void {
  localStorage.setItem('token', token);
}

/**
 * Clear the auth token from localStorage
 */
export function clearAuthToken(): void {
  localStorage.removeItem('token');
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return !!getAuthToken();
}

/**
 * Get CSRF token from cookie
 */
function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)_csrf=([^;]*)/);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Fetch CSRF token from server (initializes cookie).
 * Call this once on app startup.
 */
export async function initializeCsrfToken(): Promise<void> {
  try {
    await fetch(`${API_BASE}/csrf-token`, {
      credentials: 'include',
    });
  } catch {
    // Silently fail - CSRF protection is optional in development
    console.warn('Failed to initialize CSRF token');
  }
}

/**
 * Make an authenticated API request
 */
async function apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};

  // Copy existing headers
  if (options.headers) {
    const existingHeaders = options.headers as Record<string, string>;
    Object.assign(headers, existingHeaders);
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  // Add CSRF token for state-changing requests
  const method = options.method?.toUpperCase() || 'GET';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include', // Include cookies for CSRF
    });
  } catch {
    // Network-level errors (offline, DNS, CORS, etc.)
    const apiError = new ApiRequestError('Failed to fetch', 0, 'NETWORK_ERROR', endpoint);
    apiError.logDiagnostics();
    throw apiError;
  }

  if (!response.ok) {
    // Try to parse error response, but handle timeout specially
    let errorBody: ApiError;
    try {
      errorBody = (await response.json()) as ApiError;
    } catch {
      // For 504 timeouts, Vercel returns plain text, not JSON
      if (response.status === 504) {
        errorBody = {
          error: 'FUNCTION_INVOCATION_TIMEOUT',
          message: 'Request timed out',
        };
      } else {
        errorBody = {
          error: 'Unknown error',
          message: response.statusText,
        };
      }
    }

    const apiError = new ApiRequestError(
      errorBody.message || 'Request failed',
      response.status,
      errorBody.error,
      endpoint,
      errorBody as unknown as Record<string, unknown>
    );
    apiError.logDiagnostics();
    throw apiError;
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

// ============================================================================
// Auth API
// ============================================================================

export async function logout(): Promise<void> {
  try {
    await apiRequest('/auth/logout', { method: 'POST' });
  } finally {
    clearAuthToken();
  }
}

export async function getCurrentUser(): Promise<{ employee: EmployeePublic }> {
  return apiRequest('/auth/me');
}

// ============================================================================
// Employee API
// ============================================================================

export async function getEmployees(params?: {
  status?: 'active' | 'archived' | 'all';
  search?: string;
}): Promise<EmployeeListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.search) searchParams.set('search', params.search);

  const query = searchParams.toString();
  return apiRequest(`/employees${query ? `?${query}` : ''}`);
}

export async function getEmployee(id: string): Promise<EmployeeDetailResponse> {
  return apiRequest(`/employees/${id}`);
}

// updateEmployee and archiveEmployee removed — employee data managed in app-portal

export async function getEmployeeDocuments(id: string): Promise<{ documents: EmployeeDocument[] }> {
  return apiRequest(`/employees/${id}/documents`);
}

export async function getEmployeeDocumentationStatus(id: string): Promise<{
  documentationStatus: DocumentationStatus;
  requiredDocuments: RequiredDocuments;
}> {
  return apiRequest(`/employees/${id}/documentation-status`);
}

// ============================================================================
// Document API
// ============================================================================

export async function uploadDocument(
  employeeId: string,
  file: File,
  type: 'parental_consent' | 'work_permit' | 'safety_training',
  expiresAt?: string
): Promise<{ document: EmployeeDocument }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);
  if (expiresAt) {
    formData.append('expiresAt', expiresAt);
  }

  return apiRequest(`/employees/${employeeId}/documents`, {
    method: 'POST',
    body: formData,
  });
}

export async function markSafetyTrainingComplete(
  employeeId: string
): Promise<{ message: string; document: EmployeeDocument }> {
  return apiRequest(`/employees/${employeeId}/safety-training`, {
    method: 'POST',
  });
}

export async function getDocument(id: string): Promise<{ document: EmployeeDocument }> {
  return apiRequest(`/documents/${id}`);
}

export async function getDocumentDownloadUrl(
  id: string
): Promise<{ url: string; expiresAt: string }> {
  return apiRequest(`/documents/${id}/download`);
}

export async function invalidateDocument(id: string): Promise<{ message: string }> {
  return apiRequest(`/documents/${id}`, { method: 'DELETE' });
}

// ============================================================================
// Dashboard API
// ============================================================================

export async function getDashboardEmployees(): Promise<EmployeeListResponse> {
  return apiRequest('/dashboard/employees');
}

export async function getDashboardAlerts(): Promise<DashboardAlertsResponse> {
  return apiRequest('/dashboard/alerts');
}

export async function getDashboardStats(): Promise<{
  stats: {
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
  };
}> {
  return apiRequest('/dashboard/stats');
}

// ============================================================================
// Task Code API
// ============================================================================

export async function getTaskCodes(params?: TaskCodeListParams): Promise<TaskCodeListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.isAgricultural) searchParams.set('isAgricultural', params.isAgricultural);
  if (params?.isHazardous) searchParams.set('isHazardous', params.isHazardous);
  if (params?.forAge !== undefined) searchParams.set('forAge', params.forAge.toString());
  if (params?.includeInactive) searchParams.set('includeInactive', params.includeInactive);
  if (params?.search) searchParams.set('search', params.search);

  const query = searchParams.toString();
  return apiRequest(`/task-codes${query ? `?${query}` : ''}`);
}

export async function getTaskCode(id: string): Promise<TaskCodeDetailResponse> {
  return apiRequest(`/task-codes/${id}`);
}

export async function getTaskCodeByCode(
  code: string
): Promise<{ taskCode: TaskCodeWithCurrentRate }> {
  return apiRequest(`/task-codes/by-code/${code}`);
}

export async function createTaskCode(
  data: CreateTaskCodeRequest
): Promise<{ taskCode: TaskCodeWithCurrentRate }> {
  return apiRequest('/task-codes', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateTaskCode(
  id: string,
  data: UpdateTaskCodeRequest
): Promise<{ taskCode: TaskCodeWithCurrentRate }> {
  return apiRequest(`/task-codes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function addTaskCodeRate(
  id: string,
  data: AddRateRequest
): Promise<{ rate: TaskCodeRate }> {
  return apiRequest(`/task-codes/${id}/rates`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getTaskCodeRates(id: string): Promise<{ rates: TaskCodeRate[] }> {
  return apiRequest(`/task-codes/${id}/rates`);
}

export async function getTaskCodesForEmployee(
  employeeId: string,
  workDate?: string
): Promise<TaskCodeListResponse> {
  const params = workDate ? `?workDate=${workDate}` : '';
  return apiRequest(`/task-codes/for-employee/${employeeId}${params}`);
}

// ============================================================================
// Timesheet API
// ============================================================================

/**
 * Get list of employee's timesheets.
 */
export async function getTimesheets(params?: TimesheetListParams): Promise<TimesheetListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString());
  if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString());

  const query = searchParams.toString();
  return apiRequest(`/timesheets${query ? `?${query}` : ''}`);
}

/**
 * Get or create timesheet for the current week.
 */
export async function getCurrentTimesheet(): Promise<TimesheetWithEntries> {
  return apiRequest('/timesheets/current');
}

/**
 * Get or create timesheet for a specific week.
 */
export async function getTimesheetByWeek(weekStartDate: string): Promise<TimesheetWithEntries> {
  return apiRequest(`/timesheets/week/${weekStartDate}`);
}

/**
 * Get timesheet by ID with entries.
 */
export async function getTimesheetById(id: string): Promise<TimesheetWithEntries> {
  return apiRequest(`/timesheets/${id}`);
}

/**
 * Create a new entry on a timesheet.
 */
export async function createTimesheetEntry(
  timesheetId: string,
  entry: CreateEntryRequest
): Promise<{ entry: TimesheetEntry }> {
  return apiRequest(`/timesheets/${timesheetId}/entries`, {
    method: 'POST',
    body: JSON.stringify(entry),
  });
}

/**
 * Bulk create response type.
 */
export interface BulkCreateEntriesResponse {
  entries: TimesheetEntry[];
  created: number;
  failed: number;
  errors: Array<{ index: number; error: string }>;
}

/**
 * Create multiple entries on a timesheet at once.
 * Used for multi-day drag operations in timeline UI.
 */
export async function createTimesheetEntriesBulk(
  timesheetId: string,
  entries: CreateEntryRequest[]
): Promise<BulkCreateEntriesResponse> {
  return apiRequest(`/timesheets/${timesheetId}/entries/bulk`, {
    method: 'POST',
    body: JSON.stringify({ entries }),
  });
}

/**
 * Update an entry on a timesheet.
 */
export async function updateTimesheetEntry(
  timesheetId: string,
  entryId: string,
  updates: UpdateEntryRequest
): Promise<{ entry: TimesheetEntry }> {
  return apiRequest(`/timesheets/${timesheetId}/entries/${entryId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

/**
 * Delete an entry from a timesheet.
 */
export async function deleteTimesheetEntry(timesheetId: string, entryId: string): Promise<void> {
  return apiRequest(`/timesheets/${timesheetId}/entries/${entryId}`, {
    method: 'DELETE',
  });
}

/**
 * Export timesheet entries as CSV.
 * Returns the CSV content as a Blob for download.
 */
export async function exportTimesheetEntries(timesheetId: string): Promise<Blob> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}/timesheets/${timesheetId}/entries/export`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({
      error: 'Unknown error',
      message: response.statusText,
    }))) as ApiError;

    throw new ApiRequestError(error.message || 'Export failed', response.status, error.error);
  }

  return response.blob();
}

/**
 * Get totals for a timesheet.
 */
export async function getTimesheetTotals(timesheetId: string): Promise<TimesheetTotals> {
  return apiRequest(`/timesheets/${timesheetId}/totals`);
}

/**
 * Get week information for a timesheet.
 */
export async function getTimesheetWeekInfo(timesheetId: string): Promise<WeekInfo> {
  return apiRequest(`/timesheets/${timesheetId}/week-info`);
}

/**
 * Compliance violation from the API.
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
 * Result of submitting a timesheet.
 */
export interface SubmitTimesheetResult {
  passed: boolean;
  message?: string;
  status?: string;
  violations?: ComplianceViolation[];
  summary?: {
    total: number;
    passed: number;
    failed: number;
    notApplicable: number;
  };
  complianceSummary?: {
    total: number;
    passed: number;
    notApplicable: number;
  };
}

/**
 * Result of validating a timesheet.
 */
export interface ValidateTimesheetResult {
  valid: boolean;
  violations: ComplianceViolation[];
}

/**
 * Submit a timesheet for compliance check and review.
 */
export async function submitTimesheet(timesheetId: string): Promise<SubmitTimesheetResult> {
  try {
    return await apiRequest(`/timesheets/${timesheetId}/submit`, {
      method: 'POST',
    });
  } catch (error) {
    // Handle compliance check failures specially
    if (error instanceof ApiRequestError && error.status === 400) {
      // The response body should contain the compliance errors
      // Re-throw with parsed violations if present
      throw error;
    }
    throw error;
  }
}

/**
 * Validate a timesheet without submitting.
 */
export async function validateTimesheet(timesheetId: string): Promise<ValidateTimesheetResult> {
  return apiRequest(`/timesheets/${timesheetId}/validate`, {
    method: 'POST',
  });
}

// ============================================================================
// Entry Compliance Preview API (for Timeline UI Phase 3)
// ============================================================================

import type { EntryPreviewRequest, EntryCompliancePreview } from '@renewal/types';

/**
 * Preview compliance for a proposed entry without saving.
 * Returns violations, warnings, limits, and requirements.
 */
export async function previewEntryCompliance(
  timesheetId: string,
  entry: EntryPreviewRequest
): Promise<EntryCompliancePreview> {
  return apiRequest(`/timesheets/${timesheetId}/entries/preview`, {
    method: 'POST',
    body: JSON.stringify(entry),
  });
}

// ============================================================================
// Supervisor Review API
// ============================================================================

import type {
  ReviewQueueItem,
  TimesheetReviewData,
  ApproveTimesheetResponse,
  RejectTimesheetResponse,
  UnlockWeekResponse,
  ComplianceCheckLog,
} from '@renewal/types';

/**
 * Review queue response.
 */
export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
  total: number;
}

/**
 * Get list of timesheets awaiting review.
 */
export async function getReviewQueue(params?: {
  employeeId?: string;
}): Promise<ReviewQueueResponse> {
  const searchParams = new URLSearchParams();
  if (params?.employeeId) searchParams.set('employeeId', params.employeeId);

  const query = searchParams.toString();
  return apiRequest(`/supervisor/review-queue${query ? `?${query}` : ''}`);
}

/**
 * Get count of timesheets pending review.
 */
export async function getPendingReviewCount(): Promise<{ count: number }> {
  return apiRequest('/supervisor/review-count');
}

/**
 * Get a timesheet for supervisor review with full details.
 */
export async function getTimesheetForReview(timesheetId: string): Promise<TimesheetReviewData> {
  return apiRequest(`/supervisor/review/${timesheetId}`);
}

/**
 * Get compliance logs for a timesheet.
 */
export async function getComplianceLogs(
  timesheetId: string
): Promise<{ logs: ComplianceCheckLog[] }> {
  return apiRequest(`/supervisor/review/${timesheetId}/compliance`);
}

/**
 * Approve a submitted timesheet.
 */
export async function approveTimesheet(
  timesheetId: string,
  notes?: string
): Promise<ApproveTimesheetResponse> {
  return apiRequest(`/supervisor/review/${timesheetId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

/**
 * Reject a submitted timesheet.
 */
export async function rejectTimesheet(
  timesheetId: string,
  notes: string
): Promise<RejectTimesheetResponse> {
  return apiRequest(`/supervisor/review/${timesheetId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

/**
 * Unlock a historical week for an employee.
 */
export async function unlockWeek(
  employeeId: string,
  weekStartDate: string
): Promise<UnlockWeekResponse> {
  return apiRequest('/supervisor/unlock-week', {
    method: 'POST',
    body: JSON.stringify({ employeeId, weekStartDate }),
  });
}

// ============================================================================
// Payroll API
// ============================================================================

import type {
  PayrollReportResponse,
  PayrollRecordResponse,
  PayrollRecalculateResponse,
  ApproveTimesheetWithPayrollResponse,
} from '@renewal/types';

/**
 * Get payroll record for a specific timesheet.
 */
export async function getPayrollRecord(timesheetId: string): Promise<PayrollRecordResponse> {
  return apiRequest(`/payroll/timesheet/${timesheetId}`);
}

/**
 * Age band type for filtering.
 */
export type AgeBand = '12-13' | '14-15' | '16-17' | '18+';

/**
 * Get payroll report with filters.
 */
export async function getPayrollReport(params: {
  startDate: string;
  endDate: string;
  employeeId?: string;
  ageBand?: AgeBand;
}): Promise<PayrollReportResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('startDate', params.startDate);
  searchParams.set('endDate', params.endDate);
  if (params.employeeId) searchParams.set('employeeId', params.employeeId);
  if (params.ageBand) searchParams.set('ageBand', params.ageBand);

  return apiRequest(`/payroll/report?${searchParams.toString()}`);
}

/**
 * Export payroll records as CSV.
 * Returns the CSV content as a Blob for download.
 */
export async function exportPayrollCSV(params: {
  startDate: string;
  endDate: string;
  employeeId?: string;
  ageBand?: AgeBand;
}): Promise<Blob> {
  const token = getAuthToken();
  const headers: Record<string, string> = {};

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  headers['Content-Type'] = 'application/json';

  // Add CSRF token for POST request
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(`${API_BASE}/payroll/export`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({
      error: 'Unknown error',
      message: response.statusText,
    }))) as ApiError;

    throw new ApiRequestError(error.message || 'Export failed', response.status, error.error);
  }

  return response.blob();
}

/**
 * Recalculate payroll for an approved timesheet.
 */
export async function recalculatePayroll(timesheetId: string): Promise<PayrollRecalculateResponse> {
  return apiRequest(`/payroll/recalculate/${timesheetId}`, {
    method: 'POST',
  });
}

/**
 * Approve timesheet and get payroll result.
 * This is an enhanced version of approveTimesheet that includes payroll info.
 */
export async function approveTimesheetWithPayroll(
  timesheetId: string,
  notes?: string
): Promise<ApproveTimesheetWithPayrollResponse> {
  return apiRequest(`/supervisor/review/${timesheetId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

// ============================================================================
// Funds (financial-system integration)
// ============================================================================

// ============================================================================
// Financial Status API (staging sync)
// ============================================================================

export interface FinancialStatusRecord {
  id: string;
  sourceRecordId: string;
  fundId: number;
  amount: string;
  status: string;
  syncedAt: string;
  lastCheckedAt: string | null;
  metadata: unknown;
}

export interface TimesheetFinancialStatusResponse {
  timesheetId: string;
  records: FinancialStatusRecord[];
  allPosted: boolean;
}

/**
 * Get financial system staging status for a timesheet.
 */
export async function getTimesheetFinancialStatus(
  timesheetId: string,
  refresh = false
): Promise<TimesheetFinancialStatusResponse> {
  const params = refresh ? '?refresh=true' : '';
  return apiRequest(`/timesheets/${timesheetId}/financial-status${params}`);
}

// ============================================================================
// Funds (financial-system integration)
// ============================================================================

export async function getFunds(): Promise<FundListResponse> {
  return apiRequest('/funds');
}

export async function syncFunds(): Promise<FundSyncResponse> {
  return apiRequest('/funds/sync', { method: 'POST' });
}
