import type { FastifyInstance } from "fastify";

export async function registerSchemas(app: FastifyInstance) {
  await app.addSchema({
    $id: "PaymentMethod",
    type: "string",
    enum: ["cash", "pix", "credit_card", "debit_card", "other"],
  });
  await app.addSchema({
    $id: "ErrorResponse",
    type: "object",
    properties: {
      error: { type: "string" },
      details: { type: "array", items: { type: "object" } },
    },
    required: ["error"],
  });
  await app.addSchema({
    $id: "ServiceType",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      description: { type: ["string", "null"] },
      priceCents: { type: "integer", minimum: 0 },
    },
    required: ["id", "name", "priceCents"],
  });
  await app.addSchema({
    $id: "CreateServiceRecordInput",
    type: "object",
    properties: {
      serviceTypeId: { type: "string", format: "uuid" },
      paymentMethod: { $ref: "PaymentMethod#" },
      occurredAt: { type: "string", format: "date-time" },
      notes: { type: "string", maxLength: 500 },
    },
    required: ["serviceTypeId", "paymentMethod"],
  });
  await app.addSchema({
    $id: "ServiceRecordAuthor",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      role: { type: "string", enum: ["admin", "daily_operator"] },
    },
    required: ["id", "name", "role"],
  });
  await app.addSchema({
    $id: "ServiceRecord",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      serviceTypeId: { type: "string", format: "uuid" },
      serviceName: { type: "string" },
      priceCents: { type: "integer", minimum: 0 },
      paymentMethod: { $ref: "PaymentMethod#" },
      occurredAt: { type: "string", format: "date-time" },
      notes: { type: ["string", "null"] },
      createdAt: { type: "string", format: "date-time" },
      createdBy: { anyOf: [{ $ref: "ServiceRecordAuthor#" }, { type: "null" }] },
    },
    required: [
      "id",
      "serviceTypeId",
      "priceCents",
      "paymentMethod",
      "occurredAt",
      "createdAt",
      "createdBy",
    ],
  });
  await app.addSchema({
    $id: "CreateExpenseInput",
    type: "object",
    properties: {
      description: { type: "string", minLength: 1, maxLength: 200 },
      amountCents: { type: "integer", minimum: 1 },
      category: { type: "string", minLength: 1, maxLength: 100 },
      paymentMethod: { $ref: "PaymentMethod#" },
      occurredAt: { type: "string", format: "date-time" },
      notes: { type: "string", maxLength: 500 },
    },
    required: ["description", "amountCents", "paymentMethod"],
  });
  await app.addSchema({
    $id: "Expense",
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      description: { type: "string" },
      amountCents: { type: "integer", minimum: 1 },
      category: { type: ["string", "null"] },
      paymentMethod: { $ref: "PaymentMethod#" },
      occurredAt: { type: "string", format: "date-time" },
      notes: { type: ["string", "null"] },
      createdAt: { type: "string", format: "date-time" },
    },
    required: ["id", "description", "amountCents", "paymentMethod", "occurredAt", "createdAt"],
  });
  await app.addSchema({
    $id: "DailyReport",
    type: "object",
    properties: {
      date: { type: "string", format: "date" },
      services: { type: "array", items: { $ref: "ServiceSummary#" } },
      paymentMethods: { type: "array", items: { $ref: "PaymentSummary#" } },
      serviceCount: { type: "integer" },
      grossRevenueCents: { type: "integer" },
      users: { type: "array", items: { $ref: "UserReportSummary#" } },
    },
    required: [
      "date",
      "services",
      "paymentMethods",
      "serviceCount",
      "grossRevenueCents",
      "users",
    ],
  });
  await app.addSchema({
    $id: "UserServiceSummary",
    type: "object",
    properties: {
      serviceTypeId: { type: "string", format: "uuid" },
      serviceName: { type: "string" },
      quantity: { type: "integer", minimum: 0 },
      totalCents: { type: "integer", minimum: 0 },
    },
    required: ["serviceTypeId", "serviceName", "quantity", "totalCents"],
  });
  await app.addSchema({
    $id: "UserReportSummary",
    type: "object",
    properties: {
      userId: { type: ["string", "null"], format: "uuid" },
      userName: { type: "string" },
      role: { type: ["string", "null"], enum: ["admin", "daily_operator", null] },
      serviceCount: { type: "integer", minimum: 0 },
      grossRevenueCents: { type: "integer", minimum: 0 },
      services: { type: "array", items: { $ref: "UserServiceSummary#" } },
    },
    required: [
      "userId",
      "userName",
      "role",
      "serviceCount",
      "grossRevenueCents",
      "services",
    ],
  });
  await app.addSchema({
    $id: "ServiceSummary",
    type: "object",
    properties: {
      serviceTypeId: { type: "string", format: "uuid" },
      serviceName: { type: "string" },
      quantity: { type: "integer", minimum: 0 },
      totalCents: { type: "integer", minimum: 0 },
    },
    required: ["serviceTypeId", "serviceName", "quantity", "totalCents"],
  });
  await app.addSchema({
    $id: "PaymentSummary",
    type: "object",
    properties: {
      paymentMethod: { $ref: "PaymentMethod#" },
      quantity: { type: "integer", minimum: 0 },
      totalCents: { type: "integer", minimum: 0 },
    },
    required: ["paymentMethod", "quantity", "totalCents"],
  });
  await app.addSchema({
    $id: "PeriodicReport",
    type: "object",
    properties: {
      period: {
        type: "string",
        enum: ["week", "month", "quarter", "semester", "year"],
      },
      startDate: { type: "string", format: "date" },
      endDate: { type: "string", format: "date" },
      serviceCount: { type: "integer" },
      grossRevenueCents: { type: "integer" },
      expenseCount: { type: "integer" },
      expensesCents: { type: "integer" },
      netRevenueCents: { type: "integer" },
      expensesByPaymentMethod: {
        type: "array",
        items: { $ref: "PaymentSummary#" },
      },
      users: { type: "array", items: { $ref: "UserReportSummary#" } },
    },
    required: [
      "period",
      "startDate",
      "endDate",
      "serviceCount",
      "grossRevenueCents",
      "expenseCount",
      "expensesCents",
      "netRevenueCents",
      "expensesByPaymentMethod",
      "users",
    ],
  });
}
