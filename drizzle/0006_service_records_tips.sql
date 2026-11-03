ALTER TABLE "service_records" ADD COLUMN "tip_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "service_records" ADD COLUMN "tip_payment_method" "payment_method";--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_tip_cents_bounds" CHECK ("service_records"."tip_cents" >= 0 AND "service_records"."tip_cents" <= 50000);--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_tip_payment_method_consistency" CHECK (("service_records"."tip_cents" = 0 AND "service_records"."tip_payment_method" IS NULL) OR ("service_records"."tip_cents" > 0 AND "service_records"."tip_payment_method" IS NOT NULL AND "service_records"."tip_payment_method" <> 'boleto'));--> statement-breakpoint
ALTER TABLE "daily_settlements" ADD COLUMN "admin_tips_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_settlements" ADD COLUMN "daily_operators_tips_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_settlements" ADD COLUMN "unidentified_tips_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_settlements" ADD COLUMN "tips_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_settlement_items" ADD COLUMN "tips_cents" integer DEFAULT 0 NOT NULL;

