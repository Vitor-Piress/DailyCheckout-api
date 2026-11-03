ALTER TYPE "public"."payment_method" ADD VALUE IF NOT EXISTS 'boleto';--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "due_date" date;--> statement-breakpoint
UPDATE "expenses" SET "due_date" = ("occurred_at" AT TIME ZONE 'America/Sao_Paulo')::date WHERE "due_date" IS NULL;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "due_date" SET NOT NULL;

