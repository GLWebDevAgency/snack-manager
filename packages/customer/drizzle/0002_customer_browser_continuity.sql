-- Existing challenges/sessions keep NULL bindings: no inferred browser or revival.
CREATE TABLE "customer"."browser_contexts" (
  parent_ref text NOT NULL REFERENCES customer.parent_budgets(parent_ref),
  tenant_ref text NOT NULL CHECK (length(tenant_ref) BETWEEN 1 AND 160),
  browser_hash text NOT NULL CHECK (browser_hash ~ '^[a-f0-9]{64}$'),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation BETWEEN 0 AND 9007199254740991),
  current_session_id uuid,
  PRIMARY KEY (parent_ref, tenant_ref, browser_hash)
);
--> statement-breakpoint
ALTER TABLE customer.challenges ADD COLUMN browser_generation bigint
  CHECK (browser_generation BETWEEN 0 AND 9007199254740989);
--> statement-breakpoint
-- The generated nullable key preserves legacy rows without inventing contexts.
ALTER TABLE customer.challenges ADD COLUMN browser_context_hash text
  GENERATED ALWAYS AS (CASE WHEN browser_generation IS NULL THEN NULL ELSE browser_hash END) STORED,
  ADD CONSTRAINT challenges_browser_context_fk FOREIGN KEY (parent_ref,tenant_ref,browser_context_hash)
    REFERENCES customer.browser_contexts(parent_ref,tenant_ref,browser_hash);
--> statement-breakpoint
ALTER TABLE customer.sessions ADD COLUMN browser_hash text CHECK (browser_hash ~ '^[a-f0-9]{64}$'),
  ADD COLUMN browser_generation bigint CHECK (browser_generation BETWEEN 1 AND 9007199254740991),
  ADD CONSTRAINT sessions_browser_binding_pair CHECK ((browser_hash IS NULL) = (browser_generation IS NULL)),
  ADD CONSTRAINT sessions_browser_context_fk FOREIGN KEY (parent_ref,tenant_ref,browser_hash)
    REFERENCES customer.browser_contexts(parent_ref,tenant_ref,browser_hash),
  ADD CONSTRAINT sessions_browser_publication_unique UNIQUE (parent_ref,tenant_ref,browser_hash,browser_generation,id);
--> statement-breakpoint
ALTER TABLE customer.browser_contexts ADD CONSTRAINT browser_current_session_fk
  FOREIGN KEY (parent_ref,tenant_ref,browser_hash,generation,current_session_id)
  REFERENCES customer.sessions(parent_ref,tenant_ref,browser_hash,browser_generation,id);
--> statement-breakpoint
CREATE FUNCTION "customer"."preserve_browser_context"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Browser continuity is monotone' USING ERRCODE = '23514';
  END IF;
  IF (NEW.parent_ref,NEW.tenant_ref,NEW.browser_hash) IS DISTINCT FROM (OLD.parent_ref,OLD.tenant_ref,OLD.browser_hash)
    OR NEW.generation < OLD.generation OR NEW.generation > OLD.generation + 1
    OR (NEW.current_session_id IS DISTINCT FROM OLD.current_session_id AND NEW.generation <> OLD.generation + 1) THEN
    RAISE EXCEPTION 'Browser continuity is monotone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER browser_context_monotone BEFORE UPDATE OR DELETE ON customer.browser_contexts
  FOR EACH ROW EXECUTE FUNCTION customer.preserve_browser_context();
--> statement-breakpoint
ALTER TABLE customer.browser_contexts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE customer.browser_contexts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON customer.browser_contexts
  USING (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true))
  WITH CHECK (tenant_ref = current_setting('app.tenant_ref', true) AND parent_ref = current_setting('app.customer_parent_ref', true));
