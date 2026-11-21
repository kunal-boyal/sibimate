CREATE TABLE "commission_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"helper_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"amount_due" integer NOT NULL,
	"settled_at" timestamp with time zone,
	"settled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_ledger_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_helper_id_helper_profiles_id_fk" FOREIGN KEY ("helper_id") REFERENCES "public"."helper_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_settled_by_admin_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_ledger_helper_open_idx" ON "commission_ledger" USING btree ("helper_id") WHERE "commission_ledger"."settled_at" is null;
--> statement-breakpoint
-- Cash jobs paid before the ledger existed: the helper still owes their commission.
INSERT INTO "commission_ledger" ("helper_id", "booking_id", "amount_due", "created_at") SELECT "bookings"."helper_id", "bookings"."id", "bookings"."commission", "bookings"."paid_at" FROM "bookings" INNER JOIN "tasks" ON "tasks"."id" = "bookings"."task_id" WHERE "tasks"."payment_method" = 'cash' AND "bookings"."paid_at" IS NOT NULL ON CONFLICT DO NOTHING;
