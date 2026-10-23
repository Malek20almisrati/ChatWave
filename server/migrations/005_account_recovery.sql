ALTER TABLE otp_challenges
  ADD COLUMN recovery_token_hash bytea,
  ADD COLUMN recovery_token_expires_at timestamptz;

CREATE FUNCTION complete_account_recovery(p_token_hash bytea, p_password_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_challenge otp_challenges%ROWTYPE;
BEGIN
  SELECT * INTO target_challenge
    FROM otp_challenges
   WHERE purpose = 'recovery'
     AND recovery_token_hash = p_token_hash
     AND recovery_token_expires_at > now()
     AND verified_at IS NOT NULL
     AND consumed_at IS NULL
   FOR UPDATE;
  IF NOT FOUND OR target_challenge.user_id IS NULL THEN RETURN false; END IF;
  PERFORM set_config('app.user_id', target_challenge.user_id::text, true);
  UPDATE users SET password_hash = p_password_hash, status = 'active', updated_at = now()
   WHERE id = target_challenge.user_id AND status IN ('active', 'deactivated');
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE account_sessions SET revoked_at = now()
   WHERE user_id = target_challenge.user_id AND revoked_at IS NULL;
  UPDATE otp_challenges SET consumed_at = now(), recovery_token_hash = NULL
   WHERE id = target_challenge.id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION complete_account_recovery(bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_account_recovery(bytea, text) TO chatwave_app;

CREATE FUNCTION deactivate_account(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid THEN RETURN false; END IF;
  UPDATE users SET status = 'deactivated', updated_at = now() WHERE id = p_user_id AND status = 'active';
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE account_sessions SET revoked_at = now() WHERE user_id = p_user_id AND revoked_at IS NULL;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION deactivate_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION deactivate_account(uuid) TO chatwave_app;
