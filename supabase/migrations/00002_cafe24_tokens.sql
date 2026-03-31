-- Cafe24 OAuth token storage
CREATE TABLE IF NOT EXISTS cafe24_tokens (
  mall_id       TEXT PRIMARY KEY,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  scopes        TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
