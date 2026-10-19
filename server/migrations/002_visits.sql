-- Per-user "continue where you left off".
CREATE TABLE creative_visits (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creative_id uuid NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  visited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, creative_id)
);
