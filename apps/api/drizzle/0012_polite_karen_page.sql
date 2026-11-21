ALTER TABLE "tasks" ADD COLUMN "min_verification_level" "verification_level" DEFAULT 'verified' NOT NULL;
--> statement-breakpoint
-- Tasks already posted take their category's level when an admin approved it, and the safe default otherwise.
UPDATE "tasks" SET "min_verification_level" = "task_categories"."min_verification_level" FROM "task_categories" WHERE "task_categories"."id" = "tasks"."category_id" AND "task_categories"."review_status" = 'approved';
