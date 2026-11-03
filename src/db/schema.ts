import {
  boolean,
  check,
  date,
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
  "boleto",
  "other",
]);

export const appUserRoleEnum = pgEnum("app_user_role", [
  "admin",
  "daily_operator",
]);

export const settlementStatusEnum = pgEnum("settlement_status", [
  "open",
  "closed",
]);

export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authUserId: varchar("auth_user_id", { length: 255 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    role: appUserRoleEnum("role").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("app_users_auth_user_id_unique").on(table.authUserId),
  ],
);

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
    createdBy: uuid("created_by").references(() => appUsers.id, {
      onDelete: "restrict",
    }),
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
    dueDate: date("due_date", { mode: "string" }).notNull(),
    createdBy: uuid("created_by").references(() => appUsers.id, {
      onDelete: "restrict",
    }),
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

export const dailySettlements = pgTable(
  "daily_settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    settlementDate: timestamp("settlement_date", {
      withTimezone: false,
      mode: "string",
    }).notNull(),
    adminOwnServicesCents: integer("admin_own_services_cents").notNull(),
    dailyOperatorsShareCents: integer("daily_operators_share_cents").notNull(),
    adminDailyOperatorsShareCents: integer(
      "admin_daily_operators_share_cents",
    ).notNull(),
    adminTotalDueCents: integer("admin_total_due_cents").notNull(),
    dailyOperatorsTotalDueCents: integer(
      "daily_operators_total_due_cents",
    ).notNull(),
    unidentifiedServicesCents: integer("unidentified_services_cents")
      .notNull()
      .default(0),
    unidentifiedServiceCount: integer("unidentified_service_count")
      .notNull()
      .default(0),
    grossServicesCents: integer("gross_services_cents").notNull(),
    status: settlementStatusEnum("status").notNull().default("closed"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => appUsers.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("daily_settlements_date_unique").on(table.settlementDate),
  ],
);

export const dailySettlementItems = pgTable(
  "daily_settlement_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => dailySettlements.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    grossServicesCents: integer("gross_services_cents").notNull(),
    operatorShareCents: integer("operator_share_cents").notNull(),
    adminShareCents: integer("admin_share_cents").notNull(),
    serviceCount: integer("service_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("daily_settlement_items_settlement_user_unique").on(
      table.settlementId,
      table.userId,
    ),
  ],
);
