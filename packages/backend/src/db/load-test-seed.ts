/**
 * Load Testing Data Generation Script.
 *
 * Generates a large dataset for performance testing:
 * - 50 employees across all age bands
 * - 8 weeks of timesheets per employee
 * - Multiple timesheet entries per day
 * - Compliance check logs
 * - Alerts
 *
 * Run with: npx tsx packages/backend/src/db/load-test-seed.ts
 *
 * WARNING: This creates a lot of data. Use on test databases only.
 */

import { db, schema } from './index.js';
import { eq } from 'drizzle-orm';
import { encryptDob } from '../utils/encryption.js';

const {
  employees,
  employeeDocuments,
  taskCodes,
  timesheets,
  timesheetEntries,
  complianceCheckLogs,
  alertNotificationLogs,
} = schema;

// Configuration
const CONFIG = {
  employeeCount: 50,
  weeksOfData: 8,
  entriesPerDay: { min: 1, max: 3 },
};

// Helper functions
function dobForAge(age: number): string {
  const today = new Date();
  const year = today.getFullYear() - age;
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
  return encryptDob(`${year}-${month}-${day}`);
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getSunday(weeksAgo: number): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysToLastSunday = dayOfWeek;
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - daysToLastSunday - weeksAgo * 7);
  return lastSunday.toISOString().split('T')[0]!;
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0]!;
}

function formatTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

// Names for generating employees
const firstNames = [
  'Alex',
  'Blake',
  'Casey',
  'Dana',
  'Ellis',
  'Finley',
  'Gray',
  'Harper',
  'Indigo',
  'Jordan',
  'Kelly',
  'Logan',
  'Morgan',
  'Noah',
  'Oakley',
  'Parker',
  'Quinn',
  'Riley',
  'Sage',
  'Taylor',
  'Uma',
  'Val',
  'Winter',
  'Xander',
  'Yuki',
  'Zephyr',
  'Arden',
  'Bailey',
  'Cameron',
  'Drew',
  'Emerson',
  'Flynn',
  'Greer',
  'Hayden',
  'Ivory',
  'Jesse',
  'Kai',
  'Lane',
  'Max',
  'Nico',
  'Ollie',
  'Peyton',
  'Rain',
  'Skylar',
  'Toby',
  'Uriel',
  'Vic',
  'Wren',
  'Xena',
  'Yara',
];

async function loadTestSeed() {
  console.log('Starting load test data generation...');
  console.log(`Target: ${CONFIG.employeeCount} employees, ${CONFIG.weeksOfData} weeks of data\n`);

  // Check if load test data already exists
  const existingLoadTestEmployee = await db
    .select()
    .from(employees)
    .where(eq(employees.email, 'loadtest.employee1@renewal.org'))
    .limit(1);

  if (existingLoadTestEmployee.length > 0) {
    console.log('Load test data already exists. Run cleanup first if you want to regenerate.');
    process.exit(0);
  }

  // Get existing task codes (assume seed.ts was run first)
  const existingTaskCodes = await db.select().from(taskCodes);
  if (existingTaskCodes.length === 0) {
    console.error('No task codes found. Run npm run db:seed first.');
    process.exit(1);
  }

  // Get existing supervisor for document uploads (find by seed email)
  const supervisor = await db
    .select()
    .from(employees)
    .where(eq(employees.email, 'sarah.supervisor@renewal.org'))
    .limit(1);

  if (supervisor.length === 0) {
    console.error('No supervisor found. Run npm run db:seed first.');
    process.exit(1);
  }

  const supervisorId = supervisor[0]!.id;

  // Filter task codes by age
  const _taskCodesByMinAge = existingTaskCodes.reduce(
    (acc, tc) => {
      const minAge = tc.minAgeAllowed;
      if (!acc[minAge]) acc[minAge] = [];
      acc[minAge]!.push(tc);
      return acc;
    },
    {} as Record<number, typeof existingTaskCodes>
  );

  // Generate employees
  console.log('Creating employees...');
  const employeeData = [];
  const ageBands = [12, 13, 14, 15, 16, 17, 18, 22]; // Include adults

  for (let i = 0; i < CONFIG.employeeCount; i++) {
    const age = ageBands[i % ageBands.length]!;
    const name = `${firstNames[i % firstNames.length]} LoadTest${i + 1}`;
    employeeData.push({
      name,
      email: `loadtest.employee${i + 1}@renewal.org`,
      dateOfBirth: dobForAge(age),
    });
  }

  const insertedEmployees = await db.insert(employees).values(employeeData).returning();
  console.log(`  Created ${insertedEmployees.length} employees`);

  // Create documents for minors
  console.log('Creating employee documents...');
  const minors = insertedEmployees.filter((e) => {
    const age = new Date().getFullYear() - parseInt(e.dateOfBirth.split('-')[0]!);
    return age < 18;
  });

  const documentData = minors.map((minor) => ({
    employeeId: minor.id,
    type: 'parental_consent' as const,
    filePath: `/documents/consent/${minor.id}.pdf`,
    uploadedBy: supervisorId,
  }));

  if (documentData.length > 0) {
    await db.insert(employeeDocuments).values(documentData);
  }
  console.log(`  Created ${documentData.length} documents`);

  // Generate timesheets and entries
  console.log('Creating timesheets and entries...');
  let timesheetCount = 0;
  let entryCount = 0;
  let complianceLogCount = 0;

  for (const employee of insertedEmployees) {
    const employeeAge = new Date().getFullYear() - parseInt(employee.dateOfBirth.split('-')[0]!);

    // Get task codes this employee can use
    const allowedTaskCodes = existingTaskCodes.filter((tc) => tc.minAgeAllowed <= employeeAge);
    if (allowedTaskCodes.length === 0) continue;

    for (let week = 0; week < CONFIG.weeksOfData; week++) {
      const weekStartDate = getSunday(week);

      // Create timesheet
      const [timesheet] = await db
        .insert(timesheets)
        .values({
          employeeId: employee.id,
          weekStartDate,
          status: week === 0 ? 'open' : week < 3 ? 'submitted' : 'approved',
          submittedAt: week > 0 ? new Date() : null,
          reviewedBy: week >= 3 ? supervisorId : null,
          reviewedAt: week >= 3 ? new Date() : null,
        })
        .returning();

      timesheetCount++;

      // Generate entries for random days of the week (not all 7 days)
      const workDays = randomInt(3, 5);
      const daysWorked = new Set<number>();
      while (daysWorked.size < workDays) {
        daysWorked.add(randomInt(0, 6));
      }

      const entries = [];
      for (const dayOffset of daysWorked) {
        const workDate = addDays(weekStartDate, dayOffset);
        const numEntries = randomInt(CONFIG.entriesPerDay.min, CONFIG.entriesPerDay.max);

        let currentStartHour = 8; // Start at 8 AM

        for (let e = 0; e < numEntries; e++) {
          const taskCode = allowedTaskCodes[randomInt(0, allowedTaskCodes.length - 1)]!;
          const duration = randomInt(1, 3); // 1-3 hours per entry

          const startHour = currentStartHour;
          const endHour = Math.min(startHour + duration, 17); // Don't go past 5 PM

          if (startHour >= endHour) break;

          const hours = (endHour - startHour).toFixed(2);

          entries.push({
            timesheetId: timesheet!.id,
            workDate,
            taskCodeId: taskCode.id,
            startTime: formatTime(startHour, 0),
            endTime: formatTime(endHour, 0),
            hours,
            isSchoolDay: dayOffset >= 1 && dayOffset <= 5 && Math.random() > 0.3,
            supervisorPresentName:
              taskCode.supervisorRequired !== 'none' ? 'Sarah Supervisor' : null,
            mealBreakConfirmed: duration >= 5 ? true : null,
          });

          currentStartHour = endHour + 0.5; // 30 min break between entries
        }
      }

      if (entries.length > 0) {
        await db.insert(timesheetEntries).values(entries);
        entryCount += entries.length;
      }

      // Add compliance logs for submitted/approved timesheets
      if (timesheet!.status !== 'open') {
        const rules = ['RULE-001', 'RULE-002', 'RULE-003', 'RULE-008', 'RULE-009'];
        const complianceLogs = rules.map((ruleId) => ({
          timesheetId: timesheet!.id,
          ruleId,
          result: 'pass' as const,
          details: {
            ruleDescription: `Compliance check ${ruleId}`,
            checkedValues: { employeeAge },
          },
          employeeAgeOnDate: employeeAge,
        }));

        await db.insert(complianceCheckLogs).values(complianceLogs);
        complianceLogCount += complianceLogs.length;
      }
    }

    // Progress indicator
    if (insertedEmployees.indexOf(employee) % 10 === 0) {
      console.log(
        `  Progress: ${insertedEmployees.indexOf(employee) + 1}/${insertedEmployees.length} employees`
      );
    }
  }

  console.log(`  Created ${timesheetCount} timesheets`);
  console.log(`  Created ${entryCount} timesheet entries`);
  console.log(`  Created ${complianceLogCount} compliance logs`);

  // Generate some alert notification logs
  console.log('Creating alert notification logs...');
  const alertTypes = ['missing_document', 'expiring_document', 'age_transition'] as const;

  const alertData = insertedEmployees.slice(0, 20).map((employee, i) => ({
    alertType: alertTypes[i % alertTypes.length]!,
    employeeId: employee.id,
    sentTo: `supervisor${i % 3}@renewal.org`,
    alertKey: `loadtest-alert-${employee.id}-${i}`,
  }));

  await db.insert(alertNotificationLogs).values(alertData);
  console.log(`  Created ${alertData.length} alert notification logs`);

  console.log('\nLoad test data generation completed!');
  console.log('\nSummary:');
  console.log(`- ${insertedEmployees.length} employees`);
  console.log(`- ${documentData.length} documents`);
  console.log(`- ${timesheetCount} timesheets`);
  console.log(`- ${entryCount} timesheet entries`);
  console.log(`- ${complianceLogCount} compliance logs`);
  console.log(`- ${alertData.length} alert notification logs`);

  process.exit(0);
}

loadTestSeed().catch((error) => {
  console.error('Load test seed failed:', error);
  process.exit(1);
});
