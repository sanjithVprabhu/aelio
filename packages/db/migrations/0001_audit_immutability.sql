-- Enforce append-only semantics on audit tables at the database layer.
-- Applied after the audit_events and action_invocations tables are created.

CREATE OR REPLACE FUNCTION reject_audit_modifications()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_modifications();

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_modifications();

CREATE TRIGGER action_invocations_no_update
  BEFORE UPDATE ON action_invocations
  FOR EACH ROW EXECUTE FUNCTION reject_audit_modifications();

CREATE TRIGGER action_invocations_no_delete
  BEFORE DELETE ON action_invocations
  FOR EACH ROW EXECUTE FUNCTION reject_audit_modifications();
