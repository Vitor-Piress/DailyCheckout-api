CREATE TYPE "public"."payment_method" AS ENUM('cash', 'pix', 'credit_card', 'debit_card', 'other');--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"description" varchar(200) NOT NULL,
	"amount_cents" integer NOT NULL,
	"category" varchar(100),
	"payment_method" "payment_method" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"canceled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_cents_positive" CHECK ("expenses"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "service_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_type_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"canceled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_records_price_cents_non_negative" CHECK ("service_records"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"price_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_types_price_cents_non_negative" CHECK ("service_types"."price_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_service_type_id_service_types_id_fk" FOREIGN KEY ("service_type_id") REFERENCES "public"."service_types"("id") ON DELETE restrict ON UPDATE no action;