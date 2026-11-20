CREATE TYPE "public"."admin_role" AS ENUM('owner', 'operations', 'verifier', 'finance');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."helper_status" AS ENUM('pending', 'active', 'paused', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."skill_tag" AS ENUM('unskilled', 'skilled');--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" text NOT NULL,
	"totp_last_step" integer DEFAULT 0 NOT NULL,
	"role" "admin_role" NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"helper_id" uuid NOT NULL,
	"agreed_price" integer NOT NULL,
	"commission_bps" integer NOT NULL,
	"commission" integer NOT NULL,
	"status" "booking_status" DEFAULT 'active' NOT NULL,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"code_locked_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "helper_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_tag" "skill_tag" DEFAULT 'unskilled' NOT NULL,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"verification_level" "verification_level" DEFAULT 'basic' NOT NULL,
	"status" "helper_status" DEFAULT 'pending' NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"cancelled_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "helper_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_helper_id_helper_profiles_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."helper_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_profiles" ADD CONSTRAINT "helper_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_active_per_task_idx" ON "bookings" USING btree ("task_id") WHERE "bookings"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_active_per_helper_idx" ON "bookings" USING btree ("helper_id") WHERE "bookings"."status" = 'active';--> statement-breakpoint
CREATE INDEX "bookings_helper_created_at_idx" ON "bookings" USING btree ("helper_id","created_at");