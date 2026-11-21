CREATE TABLE "admin_credentials" (
	"id" text PRIMARY KEY,
	"password_hash" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"token_hash" text PRIMARY KEY,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" text PRIMARY KEY,
	"access_token_hash" text NOT NULL,
	"date" text NOT NULL,
	"time" text NOT NULL,
	"service_id" text NOT NULL,
	"service_title" text NOT NULL,
	"duration" integer NOT NULL,
	"price" integer NOT NULL,
	"patient_name" text NOT NULL,
	"patient_rut" text DEFAULT '' NOT NULL,
	"patient_email" text NOT NULL,
	"patient_phone" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"transfer_ref" text,
	"paid_at" timestamp with time zone,
	"boleta_name" text,
	"boleta_uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"id" text PRIMARY KEY,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_date_time_unique" ON "bookings" ("date","time");