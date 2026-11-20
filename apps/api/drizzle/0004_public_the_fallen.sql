CREATE TYPE "public"."offer_status" AS ENUM('notified', 'quoted', 'accepted', 'declined', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TABLE "helper_availability" (
	"helper_id" uuid PRIMARY KEY NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"last_location" geography(Point, 4326),
	"radius_m" integer DEFAULT 5000 NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"helper_id" uuid NOT NULL,
	"ring" integer NOT NULL,
	"status" "offer_status" DEFAULT 'notified' NOT NULL,
	"price" integer,
	"eta_min" integer,
	"distance_m" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "helper_availability" ADD CONSTRAINT "helper_availability_helper_id_helper_profiles_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."helper_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_offers" ADD CONSTRAINT "task_offers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_offers" ADD CONSTRAINT "task_offers_helper_id_helper_profiles_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."helper_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helper_availability_location_idx" ON "helper_availability" USING gist ("last_location");--> statement-breakpoint
CREATE UNIQUE INDEX "task_offers_task_helper_idx" ON "task_offers" USING btree ("task_id","helper_id");--> statement-breakpoint
CREATE INDEX "task_offers_helper_status_idx" ON "task_offers" USING btree ("helper_id","status");