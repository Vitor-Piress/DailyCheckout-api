CREATE TYPE "public"."settlement_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "daily_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_date" date NOT NULL,
	"admin_own_services_cents" integer NOT NULL,
	"daily_operators_share_cents" integer NOT NULL,
	"admin_daily_operators_share_cents" integer NOT NULL,
	"admin_total_due_cents" integer NOT NULL,
	"daily_operators_total_due_cents" integer NOT NULL,
	"gross_services_cents" integer NOT NULL,
	"status" "settlement_status" DEFAULT 'closed' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_settlements_date_unique" UNIQUE("settlement_date")
);--> statement-breakpoint
CREATE TABLE "daily_settlement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"gross_services_cents" integer NOT NULL,
	"operator_share_cents" integer NOT NULL,
	"admin_share_cents" integer NOT NULL,
	"service_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_settlement_items_settlement_user_unique" UNIQUE("settlement_id","user_id")
);--> statement-breakpoint
ALTER TABLE "daily_settlements" ADD CONSTRAINT "daily_settlements_closed_by_app_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_settlement_items" ADD CONSTRAINT "daily_settlement_items_settlement_id_daily_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."daily_settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_settlement_items" ADD CONSTRAINT "daily_settlement_items_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;
