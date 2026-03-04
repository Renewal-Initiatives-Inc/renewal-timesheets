import { pgTable, uuid, varchar, date, timestamp, text } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { employeeStatusEnum, documentTypeEnum } from './enums.js';

export const employees = pgTable('employees', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  dateOfBirth: text('date_of_birth').notNull(), // AES-256-GCM encrypted
  status: employeeStatusEnum('status').notNull().default('active'),
  zitadelId: varchar('zitadel_id', { length: 255 }).unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const employeeDocuments = pgTable('employee_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id, { onDelete: 'restrict' }),
  type: documentTypeEnum('type').notNull(),
  filePath: text('file_path').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  uploadedBy: uuid('uploaded_by')
    .notNull()
    .references(() => employees.id, { onDelete: 'restrict' }),
  expiresAt: date('expires_at'), // nullable, for work permits
  invalidatedAt: timestamp('invalidated_at', { withTimezone: true }), // nullable, for revocation
});

// Relations
export const employeesRelations = relations(employees, ({ many }) => ({
  documents: many(employeeDocuments, { relationName: 'employeeDocuments' }),
  uploadedDocuments: many(employeeDocuments, { relationName: 'uploaderDocuments' }),
}));

export const employeeDocumentsRelations = relations(employeeDocuments, ({ one }) => ({
  employee: one(employees, {
    fields: [employeeDocuments.employeeId],
    references: [employees.id],
    relationName: 'employeeDocuments',
  }),
  uploader: one(employees, {
    fields: [employeeDocuments.uploadedBy],
    references: [employees.id],
    relationName: 'uploaderDocuments',
  }),
}));
