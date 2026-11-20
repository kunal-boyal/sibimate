-- PostGIS provides the geography type and distance queries.
CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TYPE "public"."category_review_status" AS ENUM('approved', 'pending', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."category_source" AS ENUM('seed', 'ai', 'admin');--> statement-breakpoint
CREATE TYPE "public"."interpretation_decision" AS ENUM('accepted', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('upi', 'cash');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."task_actor" AS ENUM('customer', 'helper', 'system', 'admin');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('draft', 'posted', 'matching', 'assigned', 'en_route', 'in_progress', 'completed', 'paid', 'closed', 'expired', 'cancelled', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."verification_level" AS ENUM('basic', 'verified', 'specialised');--> statement-breakpoint
CREATE TABLE "task_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"requires_skilled" boolean DEFAULT false NOT NULL,
	"skill" text,
	"source" "category_source" DEFAULT 'seed' NOT NULL,
	"review_status" "category_review_status" DEFAULT 'approved' NOT NULL,
	"risk_level" "risk_level" DEFAULT 'low' NOT NULL,
	"min_verification_level" "verification_level" DEFAULT 'verified' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"from_status" "task_status",
	"to_status" "task_status" NOT NULL,
	"actor_id" uuid,
	"actor_role" "task_actor" NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_interpretations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"input_text" text NOT NULL,
	"output" jsonb NOT NULL,
	"provider" text NOT NULL,
	"decision" "interpretation_decision",
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"category_id" uuid,
	"interpretation_id" uuid,
	"title" text NOT NULL,
	"description_raw" text NOT NULL,
	"description_refined" text NOT NULL,
	"requires_skilled" boolean NOT NULL,
	"details" jsonb,
	"pickup_point" geography(Point, 4326) NOT NULL,
	"drop_point" geography(Point, 4326),
	"address_enc" text NOT NULL,
	"schedule_at" timestamp with time zone,
	"customer_price" integer NOT NULL,
	"search_radius_m" integer DEFAULT 2000 NOT NULL,
	"helpers_needed" integer DEFAULT 1 NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"status" "task_status" NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_interpretations" ADD CONSTRAINT "task_interpretations_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_category_id_task_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."task_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_interpretation_id_task_interpretations_id_fk" FOREIGN KEY ("interpretation_id") REFERENCES "public"."task_interpretations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_events_task_id_idx" ON "task_events" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_interpretations_customer_id_idx" ON "task_interpretations" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_customer_idempotency_key_idx" ON "tasks" USING btree ("customer_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "tasks_customer_created_at_idx" ON "tasks" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_pickup_point_idx" ON "tasks" USING gist ("pickup_point");