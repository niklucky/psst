ALTER TABLE "vault_members" ADD COLUMN "invite_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_members" ADD COLUMN "sender_public_key" text;
