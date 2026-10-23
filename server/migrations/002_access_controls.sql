CREATE TABLE country_age_rules (
  country_code char(2) PRIMARY KEY,
  minimum_age smallint NOT NULL CHECK (minimum_age BETWEEN 13 AND 18),
  verified_guardian_required boolean NOT NULL DEFAULT false,
  source_url text NOT NULL,
  reviewed_at date NOT NULL,
  active boolean NOT NULL DEFAULT false
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE users ADD COLUMN avatar_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL;
CREATE INDEX users_avatar_media_idx ON users (avatar_media_id) WHERE avatar_media_id IS NOT NULL;
CREATE POLICY users_read_visible ON users FOR SELECT
  USING (
    id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR visibility = 'public'
    OR EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.state = 'accepted'
        AND ((f.requester_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND f.recipient_id = users.id)
          OR (f.recipient_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND f.requester_id = users.id))
    )
  );
CREATE POLICY users_insert_self ON users FOR INSERT
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY users_update_self ON users FOR UPDATE
  USING (id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE account_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_self ON account_sessions
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE FUNCTION lookup_user_by_phone(p_phone text)
RETURNS TABLE (id uuid, password_hash text, status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.password_hash, u.status
  FROM users u
  WHERE u.phone_e164 = p_phone
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION lookup_user_by_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_user_by_phone(text) TO chatwave_app;

CREATE FUNCTION resolve_session(p_token_hash bytea)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.user_id
  FROM account_sessions s
  JOIN users u ON u.id = s.user_id AND u.status = 'active'
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION resolve_session(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_session(bytea) TO chatwave_app;

CREATE FUNCTION lookup_user_card_by_username(p_username text)
RETURNS TABLE (id uuid, username text, display_name text, visibility audience_scope)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.username, u.display_name, u.visibility
  FROM users u
  WHERE lower(u.username) = lower(p_username) AND u.status = 'active'
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION lookup_user_card_by_username(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_user_card_by_username(text) TO chatwave_app;

CREATE FUNCTION lookup_user_card_by_id(p_user_id uuid)
RETURNS TABLE (id uuid, username text, display_name text, visibility audience_scope)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.username, u.display_name, u.visibility
  FROM users u
  WHERE u.id = p_user_id AND u.status = 'active'
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION lookup_user_card_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_user_card_by_id(uuid) TO chatwave_app;

CREATE FUNCTION complete_media_upload(p_asset_id uuid, p_owner_id uuid, p_byte_size bigint, p_mime_type text)
RETURNS TABLE (id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE media_assets
  SET state = 'quarantined', uploaded_at = now()
  WHERE media_assets.id = p_asset_id
    AND media_assets.owner_id = p_owner_id
    AND p_owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND media_assets.state = 'pending_upload'
    AND media_assets.byte_size = p_byte_size
    AND media_assets.declared_mime_type = p_mime_type
  RETURNING media_assets.id
$$;
REVOKE ALL ON FUNCTION complete_media_upload(uuid, uuid, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_media_upload(uuid, uuid, bigint, text) TO chatwave_app;

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships FORCE ROW LEVEL SECURITY;
CREATE POLICY friendships_read_participant ON friendships FOR SELECT
  USING (requester_id = NULLIF(current_setting('app.user_id', true), '')::uuid OR recipient_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY friendships_request_self ON friendships FOR INSERT
  WITH CHECK (requester_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND state = 'pending');
CREATE POLICY friendships_accept_incoming ON friendships FOR UPDATE
  USING (recipient_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND state = 'pending')
  WITH CHECK (recipient_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND state IN ('accepted', 'blocked'));

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts FORCE ROW LEVEL SECURITY;
CREATE POLICY posts_read_audience ON posts FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      author_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      OR audience = 'public'
      OR (audience = 'friends' AND EXISTS (
        SELECT 1 FROM friendships f
        WHERE f.state = 'accepted'
          AND ((f.requester_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND f.recipient_id = posts.author_id)
            OR (f.recipient_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND f.requester_id = posts.author_id))
      ))
    )
  );
CREATE POLICY posts_insert_self ON posts FOR INSERT
  WITH CHECK (author_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY posts_update_self ON posts FOR UPDATE
  USING (author_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (author_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY conversations_for_members ON conversations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversation_members cm
    WHERE cm.conversation_id = conversations.id
      AND cm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND cm.left_at IS NULL
  ));
CREATE POLICY conversations_created_by_self ON conversations FOR INSERT
  WITH CHECK (created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members FORCE ROW LEVEL SECURITY;
CREATE POLICY conversation_members_self ON conversation_members
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_members.conversation_id
        AND c.created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY messages_for_members ON messages FOR SELECT
  USING (deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM conversation_members cm
    WHERE cm.conversation_id = messages.conversation_id
      AND cm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND cm.left_at IS NULL
  ));
CREATE POLICY messages_insert_as_self ON messages FOR INSERT
  WITH CHECK (
    sender_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM conversation_members cm
      WHERE cm.conversation_id = messages.conversation_id
        AND cm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND cm.left_at IS NULL
    )
  );

ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories FORCE ROW LEVEL SECURITY;
CREATE POLICY stories_read_audience ON stories FOR SELECT
  USING (
    expires_at > now()
    AND (
      owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      OR audience = 'public'
      OR (audience = 'friends' AND EXISTS (
        SELECT 1 FROM friendships f
        WHERE f.state = 'accepted'
          AND ((f.requester_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND f.recipient_id = stories.owner_id)
            OR (f.recipient_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND f.requester_id = stories.owner_id))
      ))
    )
  );
CREATE POLICY stories_insert_self ON stories FOR INSERT
  WITH CHECK (
    owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND expires_at > now()
    AND EXISTS (SELECT 1 FROM media_assets a WHERE a.id = stories.media_id AND a.owner_id = stories.owner_id AND a.kind IN ('image', 'video') AND a.state = 'ready')
  );

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY media_read_authorized ON media_assets FOR SELECT
  USING (
    owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM post_media pm JOIN posts p ON p.id = pm.post_id WHERE pm.media_id = media_assets.id)
    OR EXISTS (SELECT 1 FROM users u WHERE u.avatar_media_id = media_assets.id)
    OR EXISTS (
      SELECT 1 FROM message_media mm
      JOIN messages m ON m.id = mm.message_id
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
      WHERE mm.media_id = media_assets.id
        AND cm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND cm.left_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM stories s
      WHERE s.media_id = media_assets.id
        AND s.expires_at > now()
        AND (s.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
          OR s.audience = 'public'
          OR (s.audience = 'friends' AND EXISTS (
            SELECT 1 FROM friendships f
            WHERE f.state = 'accepted'
              AND ((f.requester_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND f.recipient_id = s.owner_id)
                OR (f.recipient_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND f.requester_id = s.owner_id))
          )))
    )
  );
CREATE POLICY media_insert_owner ON media_assets FOR INSERT
  WITH CHECK (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY media_quarantine_completion ON media_assets FOR UPDATE
  USING (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND state = 'pending_upload')
  WITH CHECK (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND state = 'quarantined');
CREATE POLICY media_delete_owner ON media_assets FOR DELETE
  USING (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND state IN ('pending_upload', 'quarantined', 'rejected'));

ALTER TABLE post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_reactions FORCE ROW LEVEL SECURITY;
CREATE POLICY post_reactions_read_visible ON post_reactions FOR SELECT
  USING (EXISTS (SELECT 1 FROM posts p WHERE p.id = post_reactions.post_id));
CREATE POLICY post_reactions_write_self ON post_reactions FOR INSERT
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND EXISTS (SELECT 1 FROM posts p WHERE p.id = post_reactions.post_id));
CREATE POLICY post_reactions_update_self ON post_reactions FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY post_reactions_delete_self ON post_reactions FOR DELETE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY post_comments_read_visible ON post_comments FOR SELECT
  USING (deleted_at IS NULL AND EXISTS (SELECT 1 FROM posts p WHERE p.id = post_comments.post_id));
CREATE POLICY post_comments_insert_self ON post_comments FOR INSERT
  WITH CHECK (author_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND EXISTS (SELECT 1 FROM posts p WHERE p.id = post_comments.post_id));
CREATE POLICY post_comments_update_self ON post_comments FOR UPDATE
  USING (author_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (author_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY post_comments_delete_self ON post_comments FOR DELETE
  USING (author_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels FORCE ROW LEVEL SECURITY;
CREATE POLICY channels_read_audience ON channels FOR SELECT
  USING (
    owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR visibility = 'public'
    OR (visibility = 'friends' AND EXISTS (
      SELECT 1 FROM friendships f WHERE f.state = 'accepted'
        AND ((f.requester_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND f.recipient_id = channels.owner_id)
          OR (f.recipient_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND f.requester_id = channels.owner_id))
    ))
  );
CREATE POLICY channels_insert_owner ON channels FOR INSERT
  WITH CHECK (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY channels_update_owner ON channels FOR UPDATE
  USING (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY channels_delete_owner ON channels FOR DELETE
  USING (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE channel_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_videos FORCE ROW LEVEL SECURITY;
CREATE POLICY channel_videos_read_audience ON channel_videos FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM channels c WHERE c.id = channel_videos.channel_id AND (
      c.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      OR (c.visibility = 'public' AND channel_videos.audience = 'public')
      OR (c.visibility IN ('friends', 'public') AND channel_videos.audience IN ('friends', 'public') AND EXISTS (
        SELECT 1 FROM friendships f WHERE f.state = 'accepted'
          AND ((f.requester_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND f.recipient_id = c.owner_id)
            OR (f.recipient_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND f.requester_id = c.owner_id))
      ))
    )
  ));
CREATE POLICY channel_videos_insert_owner ON channel_videos FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM channels c WHERE c.id = channel_videos.channel_id AND c.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM media_assets a WHERE a.id = channel_videos.media_id AND a.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND a.kind = 'video' AND a.state = 'ready')
  );
CREATE POLICY channel_videos_update_owner ON channel_videos FOR UPDATE
  USING (EXISTS (SELECT 1 FROM channels c WHERE c.id = channel_videos.channel_id AND c.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM channels c WHERE c.id = channel_videos.channel_id AND c.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
CREATE POLICY channel_videos_delete_owner ON channel_videos FOR DELETE
  USING (EXISTS (SELECT 1 FROM channels c WHERE c.id = channel_videos.channel_id AND c.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid));

ALTER TABLE user_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_interests FORCE ROW LEVEL SECURITY;
CREATE POLICY interests_self ON user_interests
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_media FORCE ROW LEVEL SECURITY;
CREATE POLICY post_media_by_visible_post ON post_media FOR SELECT
  USING (EXISTS (SELECT 1 FROM posts p WHERE p.id = post_media.post_id));
CREATE POLICY post_media_by_own_post ON post_media FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM posts p WHERE p.id = post_media.post_id AND p.author_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM media_assets a WHERE a.id = post_media.media_id AND a.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND a.state = 'ready')
  );

ALTER TABLE message_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_media FORCE ROW LEVEL SECURITY;
CREATE POLICY message_media_for_members ON message_media FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
    WHERE m.id = message_media.message_id
      AND cm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND cm.left_at IS NULL
  ));
CREATE POLICY message_media_by_own_message ON message_media FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM messages m JOIN media_assets a ON a.id = message_media.media_id
    WHERE m.id = message_media.message_id
      AND m.sender_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND a.owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND a.state = 'ready'
  ));

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
CREATE POLICY reports_reporter_read ON reports FOR SELECT
  USING (reporter_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY reports_reporter_insert ON reports FOR INSERT
  WITH CHECK (reporter_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

GRANT SELECT ON country_age_rules TO chatwave_app;
GRANT SELECT, INSERT ON users TO chatwave_app;
GRANT UPDATE (display_name, username, bio, visibility, avatar_media_id, updated_at) ON users TO chatwave_app;
GRANT SELECT, INSERT, UPDATE ON otp_challenges, account_sessions TO chatwave_app;
GRANT SELECT, INSERT ON user_interests TO chatwave_app;
GRANT SELECT, INSERT ON friendships TO chatwave_app;
GRANT UPDATE (state, updated_at) ON friendships TO chatwave_app;
GRANT SELECT, INSERT ON posts TO chatwave_app;
GRANT SELECT, INSERT ON conversations, conversation_members, messages TO chatwave_app;
GRANT SELECT, INSERT ON media_assets TO chatwave_app;
GRANT DELETE ON media_assets TO chatwave_app;
GRANT SELECT, INSERT ON post_media, message_media TO chatwave_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON post_reactions, post_comments TO chatwave_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON stories, channels, channel_videos TO chatwave_app;
GRANT SELECT, INSERT ON reports TO chatwave_app;
REVOKE ALL ON guardian_verifications, chatwave_migrations FROM chatwave_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO chatwave_app;
