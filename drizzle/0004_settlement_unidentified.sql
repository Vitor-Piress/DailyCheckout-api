ALTER TABLE "daily_settlements" ADD COLUMN "unidentified_services_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_settlements" ADD COLUMN "unidentified_service_count" integer DEFAULT 0 NOT NULL;
