import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "pix",
  "credit_card",
  "debit_card",
  "other",
]);

export const serviceTypes = pgTable(
  "service_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("service_types_price_cents_non_negative", sql`${table.priceCents} >= 0`),
    unique("service_types_name_unique").on(table.name),
  ],
);

export const serviceRecords = pgTable(
  "service_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serviceTypeId: uuid("service_type_id")
      .notNull()
      .references(() => serviceTypes.id, { onDelete: "restrict" }),
    priceCents: integer("price_cents").notNull(),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text("notes"),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("service_records_price_cents_non_negative", sql`${table.priceCents} >= 0`),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    description: varchar("description", { length: 200 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    category: varchar("category", { length: 100 }),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text("notes"),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("expenses_amount_cents_positive", sql`${table.amountCents} > 0`),
  ],
);
