ALTER TABLE conversations
  ADD COLUMN description varchar(500) NOT NULL DEFAULT '',
  ADD COLUMN visibility audience_scope NOT NULL DEFAULT 'private',
  ADD COLUMN join_mode text NOT NULL DEFAULT 'invite' CHECK (join_mode IN ('invite', 'request', 'open')),
  ADD COLUMN allow_forwarding boolean NOT NULL DEFAULT true,
  ADD COLUMN invite_token text UNIQUE,
  ADD COLUMN avatar_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL;

ALTER TABLE conversations ADD CONSTRAINT conversations_visibility_kind_check
  CHECK (kind = 'group' OR (visibility = 'private' AND join_mode = 'invite' AND invite_token IS NULL));

CREATE TABLE group_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (conversation_id, user_id)
);
CREATE INDEX group_join_requests_pending_idx ON group_join_requests (conversation_id, created_at) WHERE status = 'pending';

CREATE TABLE channel_admins (
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE FUNCTION is_conversation_manager(p_conversation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_members cm
    WHERE cm.conversation_id = p_conversation_id AND cm.user_id = p_user_id
      AND cm.left_at IS NULL AND cm.role IN ('owner', 'admin')
  )
$$;
REVOKE ALL ON FUNCTION is_conversation_manager(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_conversation_manager(uuid, uuid) TO chatwave_app;

ALTER TABLE channels
  ADD COLUMN avatar_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  ADD COLUMN invite_token text UNIQUE,
  ADD COLUMN allow_forwarding boolean NOT NULL DEFAULT true;

CREATE TABLE channel_subscribers (
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
ALTER TABLE channel_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_subscribers FORCE ROW LEVEL SECURITY;
CREATE POLICY channel_subscribers_read_self_or_owner ON channel_subscribers FOR SELECT
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM channels c WHERE c.id = channel_subscribers.channel_id AND c.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  );
CREATE POLICY channel_subscribers_insert_self ON channel_subscribers FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY channel_subscribers_delete_self ON channel_subscribers FOR DELETE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
GRANT SELECT, INSERT, DELETE ON channel_subscribers TO chatwave_app;

CREATE FUNCTION join_channel_by_link(p_user_id uuid, p_username text, p_invite_token text)
RETURNS TABLE (channel_id uuid, title varchar(80), username varchar(24), visibility audience_scope)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_channel channels%ROWTYPE;
BEGIN
  IF p_user_id IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid THEN RETURN; END IF;
  SELECT * INTO target_channel FROM channels c
   WHERE (p_invite_token IS NOT NULL AND c.invite_token = p_invite_token)
      OR (p_invite_token IS NULL AND lower(c.username) = lower(p_username) AND c.visibility = 'public')
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO channel_subscribers (channel_id, user_id) VALUES (target_channel.id, p_user_id) ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT target_channel.id, target_channel.title, target_channel.username, target_channel.visibility;
END;
$$;
REVOKE ALL ON FUNCTION join_channel_by_link(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION join_channel_by_link(uuid, text, text) TO chatwave_app;

CREATE POLICY conversations_group_manager_update ON conversations FOR UPDATE
  USING (
    kind = 'group'
    AND is_conversation_manager(conversations.id, NULLIF(current_setting('app.user_id', true), '')::uuid)
  )
  WITH CHECK (kind = 'group');
GRANT UPDATE (title, description, visibility, join_mode, allow_forwarding, invite_token, avatar_media_id) ON conversations TO chatwave_app;

ALTER TABLE group_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_join_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY group_join_requests_participant_read ON group_join_requests FOR SELECT
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = group_join_requests.conversation_id
        AND cm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND cm.left_at IS NULL AND cm.role IN ('owner', 'admin')
    )
  );
GRANT SELECT ON group_join_requests TO chatwave_app;

CREATE POLICY conversation_members_manager_read ON conversation_members FOR SELECT
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR is_conversation_manager(conversation_members.conversation_id, NULLIF(current_setting('app.user_id', true), '')::uuid)
  );

CREATE FUNCTION set_group_member_role(p_owner_id uuid, p_group_id uuid, p_member_id uuid, p_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_owner_id IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid
    OR p_role NOT IN ('admin', 'member')
    OR NOT EXISTS (SELECT 1 FROM conversations WHERE id = p_group_id AND kind = 'group' AND created_by = p_owner_id)
    OR NOT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = p_group_id AND user_id = p_member_id AND left_at IS NULL) THEN
    RETURN false;
  END IF;
  UPDATE conversation_members SET role = p_role
    WHERE conversation_id = p_group_id AND user_id = p_member_id AND role <> 'owner';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION set_group_member_role(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_group_member_role(uuid, uuid, uuid, text) TO chatwave_app;

CREATE FUNCTION join_group_by_token(p_user_id uuid, p_token text)
RETURNS TABLE (conversation_id uuid, title varchar(80), state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_group conversations%ROWTYPE;
BEGIN
  IF p_user_id IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid THEN
    RETURN;
  END IF;
  SELECT * INTO target_group FROM conversations
    WHERE kind = 'group' AND invite_token = p_token AND archived_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = target_group.id AND cm.user_id = p_user_id AND cm.left_at IS NULL) THEN
    RETURN QUERY SELECT target_group.id, target_group.title, 'member'::text;
    RETURN;
  END IF;
  IF target_group.join_mode = 'request' THEN
    INSERT INTO group_join_requests (conversation_id, user_id, status)
      VALUES (target_group.id, p_user_id, 'pending')
      ON CONFLICT (conversation_id, user_id) DO UPDATE SET status = 'pending', created_at = now(), reviewed_at = NULL, reviewed_by = NULL;
    RETURN QUERY SELECT target_group.id, target_group.title, 'requested'::text;
    RETURN;
  END IF;
  IF target_group.join_mode = 'open' AND target_group.visibility <> 'public' THEN RETURN; END IF;
  INSERT INTO conversation_members (conversation_id, user_id, role)
    VALUES (target_group.id, p_user_id, 'member') ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT target_group.id, target_group.title, 'joined'::text;
END;
$$;
REVOKE ALL ON FUNCTION join_group_by_token(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION join_group_by_token(uuid, text) TO chatwave_app;

CREATE FUNCTION review_group_join_request(p_manager_id uuid, p_request_id uuid, p_accept boolean)
RETURNS TABLE (conversation_id uuid, user_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_request group_join_requests%ROWTYPE;
BEGIN
  IF p_manager_id IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid THEN RETURN; END IF;
  SELECT * INTO target_request FROM group_join_requests WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = target_request.conversation_id
      AND cm.user_id = p_manager_id AND cm.left_at IS NULL AND cm.role IN ('owner', 'admin')
  ) THEN RETURN; END IF;
  IF p_accept THEN
    INSERT INTO conversation_members (conversation_id, user_id, role)
      VALUES (target_request.conversation_id, target_request.user_id, 'member') ON CONFLICT DO NOTHING;
  END IF;
  UPDATE group_join_requests SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
    reviewed_at = now(), reviewed_by = p_manager_id WHERE id = target_request.id;
  RETURN QUERY SELECT target_request.conversation_id, target_request.user_id,
    CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END::text;
END;
$$;
REVOKE ALL ON FUNCTION review_group_join_request(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION review_group_join_request(uuid, uuid, boolean) TO chatwave_app;

CREATE FUNCTION set_channel_admin(p_owner_id uuid, p_channel_id uuid, p_user_id uuid, p_is_admin boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_owner_id IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid
    OR NOT EXISTS (SELECT 1 FROM channels WHERE id = p_channel_id AND owner_id = p_owner_id)
    OR p_user_id = p_owner_id THEN RETURN false; END IF;
  IF p_is_admin THEN
    INSERT INTO channel_admins (channel_id, user_id, granted_by) VALUES (p_channel_id, p_user_id, p_owner_id)
      ON CONFLICT (channel_id, user_id) DO NOTHING;
  ELSE
    DELETE FROM channel_admins WHERE channel_id = p_channel_id AND user_id = p_user_id;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION set_channel_admin(uuid, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_channel_admin(uuid, uuid, uuid, boolean) TO chatwave_app;

ALTER TABLE channel_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_admins FORCE ROW LEVEL SECURITY;
CREATE POLICY channel_admins_read_self_or_owner ON channel_admins FOR SELECT
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM channels c WHERE c.id = channel_admins.channel_id AND c.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  );
GRANT SELECT ON channel_admins TO chatwave_app;

DROP POLICY channel_videos_insert_owner ON channel_videos;
CREATE POLICY channel_videos_insert_managers ON channel_videos FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM channels c WHERE c.id = channel_videos.channel_id
        AND (c.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
          OR EXISTS (SELECT 1 FROM channel_admins a WHERE a.channel_id = c.id AND a.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
    )
    AND EXISTS (SELECT 1 FROM media_assets a WHERE a.id = channel_videos.media_id AND a.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND a.kind = 'video' AND a.state = 'ready')
  );
