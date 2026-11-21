import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Public site content edited from the admin panel (profile, services, prices, schedule, bank details).
// A single row with id "main" holds the whole settings document.
export const siteSettings = pgTable("site_settings", {
  id: text().primaryKey(),
  data: jsonb().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Administrator password (stored only as a salted scrypt hash) plus brute-force lockout state.
export const adminCredentials = pgTable("admin_credentials", {
  id: text().primaryKey(),
  passwordHash: text("password_hash").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Logged-in administrator sessions. Only a SHA-256 hash of the cookie token is stored.
export const adminSessions = pgTable("admin_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Patient appointments. The unique (date, time) index guarantees a slot can only be booked once.
export const bookings = pgTable(
  "bookings",
  {
    id: text().primaryKey(),
    accessTokenHash: text("access_token_hash").notNull(),
    date: text().notNull(),
    time: text().notNull(),
    serviceId: text("service_id").notNull(),
    serviceTitle: text("service_title").notNull(),
    duration: integer().notNull(),
    price: integer().notNull(),
    patientName: text("patient_name").notNull(),
    patientRut: text("patient_rut").notNull().default(""),
    patientEmail: text("patient_email").notNull(),
    patientPhone: text("patient_phone").notNull(),
    reason: text().notNull().default(""),
    paymentStatus: text("payment_status").notNull().default("pending"),
    transferRef: text("transfer_ref"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    boletaName: text("boleta_name"),
    boletaUploadedAt: timestamp("boleta_uploaded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("bookings_date_time_unique").on(t.date, t.time)],
);
