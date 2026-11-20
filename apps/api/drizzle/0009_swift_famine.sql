ALTER TABLE "tasks" ADD COLUMN "customer_radius_m" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "customer_radius_cap" boolean DEFAULT false NOT NULL;