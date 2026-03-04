import { eq, and, gte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { getDocumentationStatus } from './documentation-status.service.js';
import {
  sendWorkPermitExpirationAlert,
  sendAgeTransitionAlert,
  sendMissingDocumentAlert,
} from './email.service.js';
import { calculateAge } from '../utils/age.js';
import type { DashboardAlert, AlertType } from '@renewal/types';

const { employees, alertNotificationLogs } = schema;

// Number of days to wait before sending the same alert again
const DEDUPLICATION_WINDOW_DAYS = 7;

interface AlertWithKey extends DashboardAlert {
  alertKey: string;
  expirationDate?: string;
  daysRemaining?: number;
}

interface NotificationResult {
  alertCount: number;
  emailsSent: number;
  errors: string[];
}

/**
 * Generate all current alerts for active employees.
 * This is similar to the dashboard alerts endpoint but includes
 * additional data needed for email notifications.
 */
export async function generateAlerts(): Promise<AlertWithKey[]> {
  const alerts: AlertWithKey[] = [];

  // Get all active employees
  const employeeList = await db.query.employees.findMany({
    where: eq(employees.status, 'active'),
  });

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0]!;

  for (const employee of employeeList) {
    const age = calculateAge(employee.dateOfBirth, todayStr);

    // Skip adults - no documentation requirements
    if (age >= 18) continue;

    // Get documentation status
    try {
      const docStatus = await getDocumentationStatus(employee.id);

      // Collect missing documents for a single alert
      const missingDocLabels: string[] = [];
      for (const missingType of docStatus.missingDocuments) {
        const docLabel =
          missingType === 'parental_consent'
            ? 'Parental consent form'
            : missingType === 'work_permit'
              ? 'Work permit'
              : 'Safety training verification';
        missingDocLabels.push(docLabel);
      }

      // Create a single alert for all missing documents
      if (missingDocLabels.length > 0) {
        alerts.push({
          type: 'missing_document' as AlertType,
          employeeId: employee.id,
          employeeName: employee.name,
          message: `Missing: ${missingDocLabels.join(', ')}`,
          alertKey: `missing_document:${employee.id}:${todayStr}`,
        });
      }

      // Alert for expiring documents
      for (const expiring of docStatus.expiringDocuments) {
        const docLabel =
          expiring.type === 'parental_consent'
            ? 'Parental consent'
            : expiring.type === 'work_permit'
              ? 'Work permit'
              : 'Safety training';

        alerts.push({
          type: 'expiring_document' as AlertType,
          employeeId: employee.id,
          employeeName: employee.name,
          message: `${docLabel} expires in ${expiring.daysUntilExpiry} days`,
          dueDate: expiring.expiresAt,
          alertKey: `expiring_document:${employee.id}:${expiring.type}:${expiring.expiresAt}`,
          expirationDate: expiring.expiresAt,
          daysRemaining: expiring.daysUntilExpiry,
        });
      }
    } catch {
      // If we can't get status, skip this employee
    }

    // Check for upcoming 14th birthday (age transition requiring work permit)
    if (age === 13) {
      // Check if 14th birthday is within next 30 days
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      const dob = new Date(employee.dateOfBirth + 'T00:00:00');
      const birthday14 = new Date(dob);
      birthday14.setFullYear(birthday14.getFullYear() + 14);

      if (birthday14 >= today && birthday14 <= thirtyDaysFromNow) {
        const daysUntil = Math.ceil(
          (birthday14.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        const birthdayStr = birthday14.toISOString().split('T')[0]!;
        alerts.push({
          type: 'age_transition' as AlertType,
          employeeId: employee.id,
          employeeName: employee.name,
          message: `Turns 14 in ${daysUntil} days - will need work permit`,
          dueDate: birthdayStr,
          alertKey: `age_transition:${employee.id}:${birthdayStr}`,
          expirationDate: birthdayStr,
          daysRemaining: daysUntil,
        });
      }
    }
  }

  return alerts;
}

/**
 * Get all supervisors. Uses SUPERVISOR_EMAILS env var (comma-separated)
 * since supervisor role is managed in Zitadel, not in the local DB.
 */
async function getSupervisors(): Promise<Array<{ id: string; name: string; email: string }>> {
  const supervisorEmails = process.env['SUPERVISOR_EMAILS'];
  if (!supervisorEmails) {
    console.warn('SUPERVISOR_EMAILS not set — no alert notifications will be sent');
    return [];
  }

  const emails = supervisorEmails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const supervisors: Array<{ id: string; name: string; email: string }> = [];

  for (const email of emails) {
    const emp = await db.query.employees.findFirst({
      where: eq(employees.email, email),
    });
    if (emp) {
      supervisors.push({ id: emp.id, name: emp.name, email: emp.email });
    }
  }

  return supervisors;
}

/**
 * Check if an alert has been sent recently.
 */
async function wasAlertSentRecently(alertKey: string, supervisorEmail: string): Promise<boolean> {
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - DEDUPLICATION_WINDOW_DAYS);

  const existing = await db.query.alertNotificationLogs.findFirst({
    where: and(
      eq(alertNotificationLogs.alertKey, alertKey),
      eq(alertNotificationLogs.sentTo, supervisorEmail),
      gte(alertNotificationLogs.sentAt, windowStart)
    ),
  });

  return !!existing;
}

/**
 * Log that an alert notification was sent.
 */
async function logAlertSent(
  alertType: 'missing_document' | 'expiring_document' | 'age_transition',
  employeeId: string,
  supervisorEmail: string,
  alertKey: string
): Promise<void> {
  await db.insert(alertNotificationLogs).values({
    alertType,
    employeeId,
    sentTo: supervisorEmail,
    alertKey,
  });
}

/**
 * Send alert emails for a single alert to all supervisors.
 */
async function sendAlertToSupervisors(
  alert: AlertWithKey,
  supervisors: Array<{ id: string; name: string; email: string }>
): Promise<{ sent: number; skipped: number; errors: string[] }> {
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const supervisor of supervisors) {
    // Check if already sent recently
    const alreadySent = await wasAlertSentRecently(alert.alertKey, supervisor.email);
    if (alreadySent) {
      skipped++;
      continue;
    }

    let success = false;

    try {
      if (alert.type === 'missing_document') {
        // Extract missing documents from the message
        const missingDocs = alert.message.replace('Missing: ', '').split(', ');
        success = await sendMissingDocumentAlert(
          supervisor.email,
          supervisor.name,
          alert.employeeName,
          missingDocs
        );
      } else if (
        alert.type === 'expiring_document' &&
        alert.expirationDate &&
        alert.daysRemaining !== undefined
      ) {
        success = await sendWorkPermitExpirationAlert(
          supervisor.email,
          supervisor.name,
          alert.employeeName,
          alert.expirationDate,
          alert.daysRemaining
        );
      } else if (
        alert.type === 'age_transition' &&
        alert.expirationDate &&
        alert.daysRemaining !== undefined
      ) {
        success = await sendAgeTransitionAlert(
          supervisor.email,
          supervisor.name,
          alert.employeeName,
          alert.expirationDate,
          alert.daysRemaining
        );
      }

      if (success) {
        await logAlertSent(alert.type, alert.employeeId, supervisor.email, alert.alertKey);
        sent++;
      } else {
        errors.push(
          `Failed to send ${alert.type} alert for ${alert.employeeName} to ${supervisor.email}`
        );
      }
    } catch (error) {
      errors.push(
        `Error sending ${alert.type} alert for ${alert.employeeName} to ${supervisor.email}: ${error}`
      );
    }
  }

  return { sent, skipped, errors };
}

/**
 * Generate alerts and send email notifications to all supervisors.
 * This is the main function called by the cron job.
 */
export async function generateAndSendAlerts(): Promise<NotificationResult> {
  const result: NotificationResult = {
    alertCount: 0,
    emailsSent: 0,
    errors: [],
  };

  try {
    // Generate all alerts
    const alerts = await generateAlerts();
    result.alertCount = alerts.length;

    if (alerts.length === 0) {
      return result;
    }

    // Get all supervisors
    const supervisors = await getSupervisors();

    if (supervisors.length === 0) {
      result.errors.push('No supervisors found to notify');
      return result;
    }

    // Send alerts to all supervisors
    for (const alert of alerts) {
      const sendResult = await sendAlertToSupervisors(alert, supervisors);
      result.emailsSent += sendResult.sent;
      result.errors.push(...sendResult.errors);
    }

    return result;
  } catch (error) {
    result.errors.push(`Fatal error in generateAndSendAlerts: ${error}`);
    return result;
  }
}
