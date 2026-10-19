-- Initial schema. Hierarchy: workspace -> brand -> product -> creative.
-- Script content (hooks, lead, body, CTA, shooting notes, research) lives in a Yjs document
-- per creative (creative_docs.state). Derived plain text is cached on creatives for search/listing.

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  color text NOT NULL DEFAULT '#2563eb',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  used_by uuid REFERENCES users(id),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  logo_file_id uuid,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX brands_ws ON brands(workspace_id);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  image_file_id uuid,
  -- Shared product dossier: { benefits, features, audiences, offer, links, sources, materials }
  dossier jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Optimistic concurrency for dossier/details edits (rejects silent overwrites).
  revision integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX products_brand ON products(brand_id);

CREATE TABLE creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  angle text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'writing'
    CHECK (status IN ('writing', 'ready_to_shoot', 'editing', 'published')),
  source_creative_id uuid REFERENCES creatives(id) ON DELETE SET NULL,
  source_kind text CHECK (source_kind IN ('duplicate', 'short')),
  short_target text,
  -- Derived from the Yjs document on every store:
  plain_text text NOT NULL DEFAULT '',
  content_hash text NOT NULL DEFAULT '',
  -- Approval tracking:
  approved_version_id uuid,
  approved_hash text,
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  needs_review boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  content_updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX creatives_product ON creatives(product_id);
CREATE INDEX creatives_ws_updated ON creatives(workspace_id, content_updated_at DESC);

CREATE TABLE creative_docs (
  creative_id uuid PRIMARY KEY REFERENCES creatives(id) ON DELETE CASCADE,
  state bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE creative_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  state bytea NOT NULL,
  snapshot jsonb NOT NULL,
  content_hash text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('created', 'auto', 'manual', 'approval', 'pre_restore', 'restore', 'ai_applied')),
  label text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX versions_creative ON creative_versions(creative_id, created_at DESC);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES creative_versions(id),
  content_hash text NOT NULL,
  approved_by uuid NOT NULL REFERENCES users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX comments_creative ON comments(creative_id, created_at);

-- Uploaded files (stored via the storage module) and external links.
CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  original_name text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('file', 'link')),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  url text,
  file_id uuid REFERENCES files(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX assets_creative ON assets(creative_id);

CREATE TABLE ai_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('assistant', 'research')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creative_id, kind)
);

CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  user_id uuid REFERENCES users(id),
  content text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_thread ON ai_messages(thread_id, created_at);

CREATE TABLE ai_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creative_id uuid NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  message_id uuid REFERENCES ai_messages(id) ON DELETE SET NULL,
  origin text NOT NULL CHECK (origin IN ('chat', 'proactive')),
  kind text NOT NULL CHECK (kind IN ('new_hook', 'rewrite', 'note')),
  -- 'lead' | 'body' | 'cta' | 'hook:<id>' | null for notes / new hooks
  target text,
  base_text text,
  text text NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'added_as_hook', 'rejected', 'dismissed')),
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_suggestions_creative ON ai_suggestions(creative_id, created_at DESC);

CREATE TABLE ai_checks (
  creative_id uuid PRIMARY KEY REFERENCES creatives(id) ON DELETE CASCADE,
  last_hash text NOT NULL,
  last_at timestamptz NOT NULL DEFAULT now()
);

-- "Preferences & working methods" memory used by the assistant.
CREATE TABLE preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('style', 'method', 'example', 'brand_guideline', 'avoid', 'imported')),
  title text NOT NULL,
  content text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX preferences_ws ON preferences(workspace_id);

CREATE TABLE activity (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  creative_id uuid REFERENCES creatives(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_creative ON activity(creative_id, created_at DESC);
CREATE INDEX activity_ws ON activity(workspace_id, created_at DESC);

-- Read-only tokens for future external access (REST / MCP bridge).
CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['read'],
  created_by uuid REFERENCES users(id),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
