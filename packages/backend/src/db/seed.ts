/**
 * Database seed script for development and testing.
 *
 * Creates test employees across all age bands and task codes
 * with initial rates for compliance rule testing.
 *
 * Run with: npm run db:seed
 *
 * Auth is handled by Zitadel SSO — no local credentials.
 */

import { db, schema } from './index.js';
import { eq } from 'drizzle-orm';
import { encryptDob } from '../utils/encryption.js';

const { employees, employeeDocuments, taskCodes, taskCodeRates } = schema;

// Calculate date of birth for a target age, encrypted for storage
function dobForAge(age: number): string {
  const today = new Date();
  const year = today.getFullYear() - age;
  return encryptDob(`${year}-01-15`);
}

// Calculate DOB for someone who will turn 14 in 2 weeks (for age transition testing)
function dobForUpcomingBirthday(): string {
  const today = new Date();
  today.setDate(today.getDate() + 14);
  const year = today.getFullYear() - 14;
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return encryptDob(`${year}-${month}-${day}`);
}

async function seed() {
  console.log('Starting database seed...');

  // Check if already seeded by looking for the supervisor
  const existingSupervisor = await db
    .select()
    .from(employees)
    .where(eq(employees.email, 'sarah.supervisor@renewal.org'))
    .limit(1);

  if (existingSupervisor.length > 0) {
    console.log('Database already seeded. Skipping...');
    console.log('To reseed, delete existing data first.');
    process.exit(0);
  }

  // Create employees across all age bands
  console.log('Creating test employees...');

  const testEmployees = [
    {
      name: 'Sarah Supervisor',
      email: 'sarah.supervisor@renewal.org',
      dateOfBirth: dobForAge(35),
    },
    {
      name: 'Alex Age12',
      email: 'alex.age12@renewal.org',
      dateOfBirth: dobForAge(12),
    },
    {
      name: 'Blake Age13',
      email: 'blake.age13@renewal.org',
      dateOfBirth: dobForAge(13),
    },
    {
      name: 'Casey Age14',
      email: 'casey.age14@renewal.org',
      dateOfBirth: dobForAge(14),
    },
    {
      name: 'Dana Age15',
      email: 'dana.age15@renewal.org',
      dateOfBirth: dobForAge(15),
    },
    {
      name: 'Ellis Age16',
      email: 'ellis.age16@renewal.org',
      dateOfBirth: dobForAge(16),
    },
    {
      name: 'Finley Age17',
      email: 'finley.age17@renewal.org',
      dateOfBirth: dobForAge(17),
    },
    {
      name: 'Gray Adult',
      email: 'gray.adult@renewal.org',
      dateOfBirth: dobForAge(22),
    },
    {
      name: 'Harper BirthdaySoon',
      email: 'harper.birthdaysoon@renewal.org',
      dateOfBirth: dobForUpcomingBirthday(),
    },
  ];

  const insertedEmployees = await db.insert(employees).values(testEmployees).returning();
  console.log(`Created ${insertedEmployees.length} employees`);

  const supervisor = insertedEmployees.find((e) => e.email === 'sarah.supervisor@renewal.org')!;

  // Create parental consent documents for minors
  console.log('Creating employee documents...');
  const minors = insertedEmployees.filter(
    (e) => e.email !== 'sarah.supervisor@renewal.org' && e.name !== 'Gray Adult'
  );

  const documents = minors.map((minor) => ({
    employeeId: minor.id,
    type: 'parental_consent' as const,
    filePath: `/documents/consent/${minor.id}.pdf`,
    uploadedBy: supervisor.id,
  }));

  const insertedDocs = await db.insert(employeeDocuments).values(documents).returning();
  console.log(`Created ${insertedDocs.length} documents`);

  // Create task codes - aligned with official Rate Card (MA, 2026)
  console.log('Creating task codes...');

  const taskCodeData = [
    // F1: Field Help (Agricultural)
    {
      code: 'F1',
      name: 'Field Help',
      description: 'Hand weeding, transplanting, light harvesting; no powered equipment',
      isAgricultural: true,
      isHazardous: false,
      supervisorRequired: 'for_minors' as const,
      soloCashHandling: false,
      drivingRequired: false,
      powerMachinery: false,
      minAgeAllowed: 12,
      isActive: true,
    },
    // G1: Grounds / Paths (Non-Agricultural)
    {
      code: 'G1',
      name: 'Grounds / Paths',
      description: 'Raking, mulching, trail upkeep, hand-tool care; no powered mowers or trimmers',
      isAgricultural: false,
      isHazardous: false,
      supervisorRequired: 'for_minors' as const,
      soloCashHandling: false,
      drivingRequired: false,
      powerMachinery: false,
      minAgeAllowed: 12,
      isActive: true,
    },
    // C1: Cleaning / Sanitation (Non-Agricultural)
    {
      code: 'C1',
      name: 'Cleaning / Sanitation',
      description: 'Sweeping, mopping, tidying common areas; no industrial chemicals',
      isAgricultural: false,
      isHazardous: false,
      supervisorRequired: 'for_minors' as const,
      soloCashHandling: false,
      drivingRequired: false,
      powerMachinery: false,
      minAgeAllowed: 12,
      isActive: true,
    },
    // P1: Post-Harvest Wash / Pack (Non-Agricultural)
    {
      code: 'P1',
      name: 'Post-Harvest Wash / Pack',
      description: 'Washing, packing, labeling produce; packshed assistance',
      isAgricultural: false,
      isHazardous: false,
      supervisorRequired: 'for_minors' as const,
      soloCashHandling: false,
      drivingRequired: false,
      powerMachinery: false,
      minAgeAllowed: 12,
      isActive: true,
    },
    // R1: CSA Assembly / Fulfillment (Non-Agricultural)
    {
      code: 'R1',
      name: 'CSA Assembly / Fulfillment',
      description: 'Weighing, labeling, assembling CSA boxes; staging orders',
      isAgricultural: false,
      isHazardous: false,
      supervisorRequired: 'for_minors' as const,
      soloCashHandling: false,
      drivingRequired: false,
      powerMachinery: false,
      minAgeAllowed: 12,
      isActive: true,
    },
    // R2: Farmers' Market / Retail (Non-Agricultural) - Cash handling, min age 14
    {
      code: 'R2',
      name: "Farmers' Market / Retail",
      description: 'Booth setup, stocking, greeting, cashiering',
      isAgricultural: false,
      isHazardous: false,
      supervisorRequired: 'always' as const,
      soloCashHandling: true,
      drivingRequired: false,
      powerMachinery: false,
      minAgeAllowed: 14,
      isActive: true,
    },
    // O1: Office / Data Entry (Non-Agricultural)
    {
      code: 'O1',
      name: 'Office / Data Entry',
      description: 'Logs, inventory sheets, basic spreadsheets',
      isAgricultural: false,
      isHazardous: false,
      supervisorRequired: 'for_minors' as const,
      soloCashHandling: false,
      drivingRequired: false,
      powerMachinery: false,
      minAgeAllowed: 12,
      isActive: true,
    },
    // O2: Website / Online Promotion (Non-Agricultural) - min age 14
    {
      code: 'O2',
      name: 'Website / Online Promotion',
      description: 'CMS edits, product posts, photo captions; no coding',
      isAgricultural: false,
      isHazardous: false,
      supervisorRequired: 'for_minors' as const,
      soloCashHandling: false,
      drivingRequired: false,
      powerMachinery: false,
      minAgeAllowed: 14,
      isActive: true,
    },
    // L1: Light Loading / Stock Movement (Non-Agricultural) - min age 14
    {
      code: 'L1',
      name: 'Light Loading / Stock Movement',
      description: 'Carrying/loading ≤50 lbs; team lifts; no forklifts/tractors',
      isAgricultural: false,
      isHazardous: false,
      supervisorRequired: 'for_minors' as const,
      soloCashHandling: false,
      drivingRequired: false,
      powerMachinery: false,
      minAgeAllowed: 14,
      isActive: true,
    },
  ];

  const insertedTaskCodes = await db.insert(taskCodes).values(taskCodeData).returning();
  console.log(`Created ${insertedTaskCodes.length} task codes`);

  // Create initial rates for each task code - aligned with official Rate Card (MA, 2026)
  console.log('Creating task code rates...');

  // Rate card mapping per task code (based on BLS OEWS data and MA market rates)
  const rateCardRates: Record<string, string> = {
    F1: '20.00', // Field Help - Agricultural
    G1: '23.00', // Grounds / Paths - Non-Ag (BLS Landscaping median $22.41)
    C1: '20.00', // Cleaning / Sanitation - Non-Ag (BLS Janitors mean $20.23)
    P1: '20.00', // Post-Harvest Wash / Pack - Non-Ag
    R1: '20.00', // CSA Assembly / Fulfillment - Non-Ag (BLS Stockers mean $19.24)
    R2: '20.00', // Farmers' Market / Retail - Non-Ag (BLS Retail mean $19.47)
    O1: '24.00', // Office / Data Entry - Non-Ag (BLS Office Clerks mean $24.75)
    O2: '29.50', // Website / Online Promotion - Non-Ag (higher skill)
    L1: '21.50', // Light Loading / Stock Movement - Non-Ag (BLS Laborers mean $21.46)
  };

  const today = new Date().toISOString().split('T')[0]!;
  const rates = insertedTaskCodes.map((tc) => ({
    taskCodeId: tc.id,
    hourlyRate: rateCardRates[tc.code] || '15.00',
    effectiveDate: today,
    justificationNotes: 'Rate Card v2.0 (Jan 2026) - aligned with BLS OEWS MA market data',
  }));

  const insertedRates = await db.insert(taskCodeRates).values(rates).returning();
  console.log(`Created ${insertedRates.length} task code rates`);

  console.log('\nSeed completed successfully!');
  console.log('\nSummary:');
  console.log(
    `- ${insertedEmployees.length} employees (1 supervisor, ${minors.length} minors, 1 adult)`
  );
  console.log(`- ${insertedDocs.length} documents (parental consent for minors)`);
  console.log(`- ${insertedTaskCodes.length} task codes`);
  console.log(`- ${insertedRates.length} task code rates`);
  console.log('\nAuth: Zitadel SSO (no local credentials)');

  process.exit(0);
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
