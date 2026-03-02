import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import { useTimesheet } from '../hooks/useTimesheet.js';
import { useTaskCodesForEmployee } from '../hooks/useTaskCodes.js';
import { WeekSelector } from '../components/WeekSelector.js';
import { TimelineView } from '../components/TimelineView.js';
import { EntryFormModal } from '../components/EntryFormModal.js';
import { HourLimitsDisplay } from '../components/HourLimitsDisplay.js';
import { TaskColorLegend } from '../components/TaskColorLegend.js';
import {
  ComplianceErrorDisplay,
  type ComplianceViolation,
} from '../components/ComplianceErrorDisplay.js';
import { submitTimesheet, exportTimesheetEntries, ApiRequestError } from '../api/client.js';
import type {
  CreateEntryRequest,
  UpdateEntryRequest,
  AgeBand,
  TimesheetEntryWithTaskCode,
} from '@renewal/types';
import './Timesheet.css';

/**
 * Calculate age from date of birth
 */
function calculateAge(dateOfBirth: string, asOfDate: string): number {
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
 * Get age band from age
 */
function getAgeBand(age: number): AgeBand {
  if (age >= 18) return '18+';
  if (age >= 16) return '16-17';
  if (age >= 14) return '14-15';
  return '12-13';
}

/**
 * Check if a date is a default school day
 */
function isDefaultSchoolDay(dateStr: string): boolean {
  const date = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = date.getDay();

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  const month = date.getMonth();
  const day = date.getDate();

  if (month > 7 || (month === 7 && day >= 28)) {
    return true;
  }
  if (month < 5 || (month === 5 && day <= 20)) {
    return true;
  }

  return false;
}

export function Timesheet() {
  const { weekStartDate } = useParams<{ weekStartDate?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const {
    timesheet,
    totals,
    loading,
    error,
    saving,
    addEntry,
    addMultipleEntries,
    updateEntry,
    updateEntriesSchoolDay,
    deleteEntry,
    previewEntry,
    refresh,
  } = useTimesheet({ weekStartDate });

  // Load task codes for the timeline view (wait until timesheet loaded to avoid double-fetch)
  const { taskCodes, loading: taskCodesLoading } = useTaskCodesForEmployee(
    timesheet ? user?.id : undefined,
    timesheet?.weekStartDate
  );

  const [editingEntry, setEditingEntry] = useState<TimesheetEntryWithTaskCode | null>(null);
  const [complianceErrors, setComplianceErrors] = useState<ComplianceViolation[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const handleWeekChange = (newWeekStartDate: string) => {
    if (newWeekStartDate === timesheet?.weekStartDate) return;
    navigate(`/timesheet/${newWeekStartDate}`);
  };

  // Handler for timeline view entries (directly adds without modal)
  const handleTimelineAddEntry = async (entry: {
    workDate: string;
    taskCodeId: string;
    startTime: string;
    endTime: string;
    isSchoolDay: boolean;
    supervisorPresentName?: string | null;
    mealBreakConfirmed?: boolean | null;
    notes?: string | null;
    fundId?: number | null;
  }) => {
    await addEntry(entry as CreateEntryRequest);
  };

  // Handler for bulk timeline entries (multi-day drag)
  const handleTimelineAddMultipleEntries = async (
    entries: Array<{
      workDate: string;
      taskCodeId: string;
      startTime: string;
      endTime: string;
      isSchoolDay: boolean;
      supervisorPresentName?: string | null;
      mealBreakConfirmed?: boolean | null;
      notes?: string | null;
      fundId?: number | null;
    }>
  ) => {
    await addMultipleEntries(entries as CreateEntryRequest[]);
  };

  const handleUpdateEntry = async (updates: CreateEntryRequest | UpdateEntryRequest) => {
    if (!editingEntry) return;
    await updateEntry(editingEntry.id, updates as UpdateEntryRequest);
    setEditingEntry(null);
  };

  const handleDeleteEntry = async (entryId: string) => {
    await deleteEntry(entryId);
  };

  const handleEditEntry = (entryId: string) => {
    if (!timesheet) return;
    const entry = timesheet.entries.find((e) => e.id === entryId);
    if (entry) {
      setEditingEntry(entry);
    }
  };

  const handleSubmit = async () => {
    if (!timesheet) return;

    setSubmitting(true);
    setComplianceErrors([]);
    setSubmitSuccess(false);

    try {
      const result = await submitTimesheet(timesheet.id);
      if (result.passed) {
        setSubmitSuccess(true);
        // Refresh to get updated status
        refresh();
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        // Check for compliance violations in the response body
        const violations = err.responseBody['violations'] as ComplianceViolation[] | undefined;
        if (violations && violations.length > 0) {
          setComplianceErrors(violations);
        } else {
          setComplianceErrors([
            {
              ruleId: 'ERROR',
              ruleName: 'Submission Error',
              message: err.message,
              remediation: 'Please try again or contact your supervisor.',
            },
          ]);
        }
      } else {
        setComplianceErrors([
          {
            ruleId: 'ERROR',
            ruleName: 'Submission Error',
            message: 'An unexpected error occurred.',
            remediation: 'Please try again or contact your supervisor.',
          },
        ]);
      }
      // Refresh to ensure state sync after failed submission
      refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportEntries = async () => {
    if (!timesheet) return;
    try {
      const blob = await exportTimesheetEntries(timesheet.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `timesheet-entries-${timesheet.weekStartDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      // Silently fail - the CSV isn't critical enough to show an error banner
    }
  };

  const scrollToEntry = (entryId: string) => {
    const element = document.querySelector(`[data-entry-id="${entryId}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  if (loading || taskCodesLoading) {
    return (
      <div className="timesheet-page">
        <div className="loading">Loading timesheet...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="timesheet-page">
        <div className="error-message">
          <p>Error: {error}</p>
          <button onClick={refresh} className="retry-button" data-testid="timesheet-retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!timesheet || !totals) {
    return (
      <div className="timesheet-page">
        <div className="error-message">
          <p>Timesheet not found</p>
        </div>
      </div>
    );
  }

  const employeeAge = user ? calculateAge(user.dateOfBirth, timesheet.weekStartDate) : 18;
  const ageBand = getAgeBand(employeeAge);
  const isEditable = timesheet.status === 'open';

  return (
    <div className="timesheet-page">
      <header className="page-header">
        <h1>My Timesheet</h1>
        <WeekSelector selectedWeek={timesheet.weekStartDate} onWeekChange={handleWeekChange} />
        {saving && <span className="saving-indicator">Saving...</span>}
      </header>

      {timesheet.birthdayInWeek && (
        <div className="birthday-alert">
          <span className="birthday-icon">&#127874;</span>
          <div className="birthday-message">
            <strong>Birthday this week!</strong>
            <p>
              You turn {timesheet.birthdayInWeek.newAge} on{' '}
              {new Date(timesheet.birthdayInWeek.date + 'T00:00:00').toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
              . Different hour limits may apply before and after your birthday.
            </p>
          </div>
        </div>
      )}

      {!isEditable && timesheet.status === 'submitted' && (
        <div className="status-alert status-alert--submitted" data-testid="status-submitted">
          <span className="status-icon">&#9889;</span>
          <div className="status-message">
            <strong>Submitted for Review</strong>
            <p>This timesheet is awaiting supervisor approval and cannot be edited.</p>
            {timesheet.submittedAt && (
              <p className="status-timestamp">
                Submitted on{' '}
                {new Date(timesheet.submittedAt).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            )}
          </div>
        </div>
      )}

      {!isEditable && timesheet.status === 'approved' && (
        <div className="status-alert status-alert--approved" data-testid="status-approved">
          <span className="status-icon">&#10003;</span>
          <div className="status-message">
            <strong>Approved</strong>
            <p>This timesheet has been approved by your supervisor.</p>
            {timesheet.reviewedAt && (
              <p className="status-timestamp">
                Approved on{' '}
                {new Date(timesheet.reviewedAt).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            )}
            {timesheet.supervisorNotes && (
              <p className="supervisor-notes">
                <strong>Supervisor notes:</strong> {timesheet.supervisorNotes}
              </p>
            )}
          </div>
        </div>
      )}

      {timesheet.status === 'open' && timesheet.supervisorNotes && timesheet.reviewedAt && (
        <div className="status-alert status-alert--rejected" data-testid="status-rejected">
          <span className="status-icon">&#9888;</span>
          <div className="status-message">
            <strong>Returned for Revision</strong>
            <p>
              Your supervisor has returned this timesheet with feedback. Please review the notes
              below, make any necessary corrections, and resubmit.
            </p>
            {timesheet.reviewedAt && (
              <p className="status-timestamp">
                Returned on{' '}
                {new Date(timesheet.reviewedAt).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            )}
            <div className="supervisor-feedback">
              <strong>Supervisor feedback:</strong>
              <p className="feedback-text">{timesheet.supervisorNotes}</p>
            </div>
            <p className="resubmit-hint">
              Make your corrections and click "Submit for Review" when ready.
            </p>
          </div>
        </div>
      )}

      {submitSuccess && (
        <div className="success-alert" data-testid="submit-success-alert">
          <span className="success-icon">&#10003;</span>
          <div className="success-message">
            <strong>Timesheet submitted successfully!</strong>
            <p>Your timesheet has been sent to your supervisor for review.</p>
          </div>
        </div>
      )}

      {complianceErrors.length > 0 && (
        <ComplianceErrorDisplay
          violations={complianceErrors}
          onClose={() => setComplianceErrors([])}
          onEntryClick={scrollToEntry}
        />
      )}

      <div className="timesheet-content">
        <div className="timesheet-main">
          <TimelineView
            timesheet={timesheet}
            totals={totals}
            employeeAge={employeeAge}
            taskCodes={taskCodes}
            onAddEntry={handleTimelineAddEntry}
            onAddMultipleEntries={handleTimelineAddMultipleEntries}
            onPreviewEntry={previewEntry}
            onUpdateEntriesSchoolDay={updateEntriesSchoolDay}
            onEditEntry={handleEditEntry}
            onDeleteEntry={handleDeleteEntry}
            disabled={!isEditable}
          />
        </div>

        <aside className="timesheet-sidebar">
          <HourLimitsDisplay
            totals={{ weekly: totals.weekly, daily: totals.daily }}
            limits={totals.limits}
            ageBand={ageBand}
          />
          {timesheet.entries.length > 0 && (
            <TaskColorLegend entries={timesheet.entries} />
          )}
        </aside>
      </div>

      {isEditable && (
        <div className="timesheet-actions">
          <button
            className="submit-button"
            onClick={handleSubmit}
            disabled={submitting || timesheet.entries.length === 0}
            data-testid="submit-timesheet-button"
          >
            {submitting ? 'Submitting...' : 'Submit for Review'}
          </button>
          <p className="submit-hint">
            Once submitted, your timesheet will be reviewed by your supervisor.
          </p>
        </div>
      )}

      {timesheet.entries.length > 0 && (
        <div className="timesheet-export">
          <button
            className="export-button"
            onClick={handleExportEntries}
            disabled={submitting}
            data-testid="export-entries-button"
          >
            Export Entries CSV
          </button>
        </div>
      )}

      {/* Edit entry modal - used when clicking on existing time blocks */}
      {editingEntry && user && (
        <EntryFormModal
          isOpen={true}
          onClose={() => setEditingEntry(null)}
          onSubmit={handleUpdateEntry}
          entry={editingEntry}
          date={editingEntry.workDate}
          employeeId={user.id}
          employeeAge={calculateAge(user.dateOfBirth, editingEntry.workDate)}
          isSchoolDay={editingEntry.isSchoolDay}
        />
      )}
    </div>
  );
}
