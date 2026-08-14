CREATE TABLE "node_types" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"outputs" jsonb NOT NULL,
	"parameter_schema" jsonb NOT NULL,
	"output_schema" jsonb NOT NULL,
	CONSTRAINT "node_types_id_version_pk" PRIMARY KEY("id","version"),
	CONSTRAINT "node_types_category_check" CHECK ("node_types"."category" IN ('trigger', 'action', 'logic'))
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"graph" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
