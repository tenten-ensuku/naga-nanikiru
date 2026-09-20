-- Account-scoped notifications. Original questions, comments and attempts are untouched.
CREATE TABLE notification_preferences (
 user_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 created_comments INTEGER NOT NULL DEFAULT 1 CHECK(created_comments IN (0,1)),
 managed_comments INTEGER NOT NULL DEFAULT 1 CHECK(managed_comments IN (0,1)),
 conversation_comments INTEGER NOT NULL DEFAULT 1 CHECK(conversation_comments IN (0,1)),
 added_questions INTEGER NOT NULL DEFAULT 0 CHECK(added_questions IN (0,1)),
 access_requests INTEGER NOT NULL DEFAULT 1 CHECK(access_requests IN (0,1))
);
CREATE TABLE notification_subscriptions (
 user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,collection_id)
);
CREATE TABLE account_notifications (
 id TEXT PRIMARY KEY,
 recipient_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 actor_id TEXT,
 kind TEXT NOT NULL,
 event_id TEXT NOT NULL,
 collection_id TEXT NOT NULL,
 question_id TEXT,
 comment_id TEXT,
 request_id TEXT,
 created_at TEXT NOT NULL,
 read_at TEXT,
 UNIQUE(recipient_id,kind,event_id)
);
CREATE INDEX account_notifications_inbox ON account_notifications(recipient_id,created_at DESC,id DESC);
CREATE INDEX account_notifications_unread ON account_notifications(recipient_id,read_at);
CREATE INDEX comments_notification_participants ON comments(question_id,user_id) WHERE deleted_at IS NULL;
INSERT INTO account_notifications(id,recipient_id,actor_id,kind,event_id,collection_id,request_id,created_at,read_at)
 SELECT id,recipient_id,actor_id,kind,id,collection_id,request_id,created_at,read_at FROM collection_access_notifications;
-- Cover legacy requests arriving between the migration and Worker deployment.
CREATE TRIGGER legacy_notification_insert_v314 AFTER INSERT ON collection_access_notifications BEGIN
 INSERT OR IGNORE INTO account_notifications(id,recipient_id,actor_id,kind,event_id,collection_id,request_id,created_at,read_at)
 VALUES(NEW.id,NEW.recipient_id,NEW.actor_id,NEW.kind,NEW.id,NEW.collection_id,NEW.request_id,NEW.created_at,NEW.read_at);
END;
CREATE TRIGGER legacy_notification_read_v314 AFTER UPDATE OF read_at ON collection_access_notifications BEGIN
 UPDATE account_notifications SET read_at=COALESCE(read_at,NEW.read_at) WHERE id=NEW.id;
END;
