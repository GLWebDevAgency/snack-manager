-- Common receipt, not a synthetic Verify challenge. All writes remain atomic
-- with publication. An older writer must be stopped before reopening the pilot.
ALTER TABLE customer.sessions ADD CONSTRAINT sessions_publication_binding_unique
  UNIQUE (parent_ref,tenant_ref,id,browser_ref,browser_hash,browser_generation);
--> statement-breakpoint
CREATE TABLE "customer"."session_publications" (
  parent_ref text NOT NULL,
  tenant_ref text NOT NULL,
  session_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  check_id uuid NOT NULL,
  browser_ref uuid NOT NULL,
  browser_hash text NOT NULL CHECK (browser_hash ~ '^[a-f0-9]{64}$'),
  browser_generation bigint NOT NULL CHECK (browser_generation BETWEEN 1 AND 9007199254740991),
  intent_generation bigint GENERATED ALWAYS AS (browser_generation-1) STORED,
  method text NOT NULL CHECK (method IN ('phone','passkey','recovery')),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (parent_ref,tenant_ref,session_id),
  UNIQUE (parent_ref,tenant_ref,operation_id,check_id),
  UNIQUE (parent_ref,tenant_ref,browser_hash,browser_generation),
  FOREIGN KEY (parent_ref,tenant_ref,session_id,browser_ref,browser_hash,browser_generation)
    REFERENCES customer.sessions(parent_ref,tenant_ref,id,browser_ref,browser_hash,browser_generation),
  FOREIGN KEY (parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,intent_generation)
    REFERENCES customer.verification_intents(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,browser_generation)
);
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_session_publication"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Session publication is immutable' USING ERRCODE='23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER session_publication_immutable BEFORE UPDATE OR DELETE ON customer.session_publications
  FOR EACH ROW EXECUTE FUNCTION customer.preserve_session_publication();
--> statement-breakpoint
CREATE TRIGGER session_publication_no_truncate BEFORE TRUNCATE ON customer.session_publications
  FOR EACH STATEMENT EXECUTE FUNCTION customer.preserve_session_publication();
--> statement-breakpoint
-- Drizzle runs the entire migration in one transaction. The non-BYPASSRLS
-- migration owner needs to see all scopes; ordinary runtime roles remain under
-- ENABLE RLS throughout. FORCE is restored before commit (and by rollback).
ALTER TABLE customer.sessions NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.accounts NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.verified_contacts NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.browser_contexts NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.browser_preparations NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.verification_intents NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.challenges NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.check_attempts NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO customer.session_publications(parent_ref,tenant_ref,session_id,operation_id,check_id,
  browser_ref,browser_hash,browser_generation,method,published_at)
SELECT s.parent_ref,s.tenant_ref,s.id,c.intent_operation_id,k.id,
  s.browser_ref,s.browser_hash,s.browser_generation,'phone',s.created_at
FROM customer.sessions s
JOIN customer.accounts a ON (a.parent_ref,a.tenant_ref,a.id)=(s.parent_ref,s.tenant_ref,s.account_id)
JOIN customer.verified_contacts v ON (v.parent_ref,v.tenant_ref,v.account_id)=(a.parent_ref,a.tenant_ref,a.id)
JOIN customer.browser_contexts b ON (b.parent_ref,b.tenant_ref,b.browser_hash,b.generation,b.current_session_id)
  =(s.parent_ref,s.tenant_ref,s.browser_hash,s.browser_generation,s.id)
JOIN customer.browser_preparations p ON (p.parent_ref,p.tenant_ref,p.browser_ref,p.browser_hash)
  =(s.parent_ref,s.tenant_ref,s.browser_ref,s.browser_hash)
JOIN customer.check_attempts k ON (k.parent_ref,k.tenant_ref,k.session_id)=(s.parent_ref,s.tenant_ref,s.id)
JOIN customer.challenges c ON (c.parent_ref,c.tenant_ref,c.id,c.check_id)=(k.parent_ref,k.tenant_ref,k.challenge_id,k.id)
JOIN customer.verification_intents i ON (i.parent_ref,i.tenant_ref,i.operation_id,i.browser_ref,i.browser_hash,i.browser_generation)
  =(c.parent_ref,c.tenant_ref,c.intent_operation_id,c.browser_ref,c.browser_hash,c.browser_generation)
WHERE s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND a.active AND s.account_version=a.session_version
  AND p.confirmed_at IS NOT NULL AND p.expires_at>clock_timestamp()
  AND k.state='approved' AND k.request_hash IS NOT NULL AND c.state='consumed'
  AND i.state='consumed' AND i.proof_hash IS NOT NULL
  AND (c.browser_ref,c.browser_hash,c.browser_generation+1)=(s.browser_ref,s.browser_hash,s.browser_generation)
  AND c.phone_hash=v.phone_hash;
--> statement-breakpoint
ALTER TABLE customer.sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.accounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.verified_contacts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.browser_contexts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.browser_preparations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.verification_intents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.challenges FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.check_attempts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.session_publications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.session_publications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON customer.session_publications
  USING (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true))
  WITH CHECK (tenant_ref=current_setting('app.tenant_ref',true) AND parent_ref=current_setting('app.customer_parent_ref',true));
