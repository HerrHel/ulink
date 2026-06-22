-- LinkVault 数据库 Schema
-- 在 Supabase Dashboard → SQL Editor 中执行此文件

-- 启用 UUID 扩展（Supabase 默认已启用）
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 分类表 ──
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '',
  color TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 书签表 ──
CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  username TEXT DEFAULT '',
  password JSONB DEFAULT '""',
  notes TEXT DEFAULT '',
  icon TEXT DEFAULT '',
  category_id TEXT DEFAULT 'uncategorized',
  parent_id TEXT,
  "order" INTEGER DEFAULT 0,
  use_count INTEGER DEFAULT 0,
  attributes JSONB DEFAULT '{}',
  is_expanded BOOLEAN DEFAULT FALSE,
  created_at_num BIGINT DEFAULT 0,
  updated_at_num BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 组表 ──
CREATE TABLE IF NOT EXISTS sibling_groups (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  category_id TEXT DEFAULT 'uncategorized',
  icon TEXT DEFAULT '',
  "order" INTEGER DEFAULT 0,
  is_expanded BOOLEAN DEFAULT FALSE,
  attributes JSONB DEFAULT '{}',
  bookmark_ids JSONB DEFAULT '[]',
  notes TEXT DEFAULT '',
  use_count INTEGER DEFAULT 0,
  updated_at_num BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 自定义属性表 ──
CREATE TABLE IF NOT EXISTS custom_attributes (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'boolean',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 主密码金丝雀表（加密验证用）──
CREATE TABLE IF NOT EXISTS user_security (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  master_canary JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 索引 ──
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(user_id, category_id);
CREATE INDEX IF NOT EXISTS idx_sibling_groups_user ON sibling_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_attributes_user ON custom_attributes(user_id);

-- ── RLS 策略（行级安全）──
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sibling_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_security ENABLE ROW LEVEL SECURITY;

-- categories 策略
CREATE POLICY "Users can view own categories" ON categories
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own categories" ON categories
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own categories" ON categories
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own categories" ON categories
  FOR DELETE USING (auth.uid() = user_id);

-- bookmarks 策略
CREATE POLICY "Users can view own bookmarks" ON bookmarks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own bookmarks" ON bookmarks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own bookmarks" ON bookmarks
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own bookmarks" ON bookmarks
  FOR DELETE USING (auth.uid() = user_id);

-- sibling_groups 策略
CREATE POLICY "Users can view own sibling_groups" ON sibling_groups
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sibling_groups" ON sibling_groups
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sibling_groups" ON sibling_groups
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sibling_groups" ON sibling_groups
  FOR DELETE USING (auth.uid() = user_id);

-- custom_attributes 策略
CREATE POLICY "Users can view own custom_attributes" ON custom_attributes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own custom_attributes" ON custom_attributes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own custom_attributes" ON custom_attributes
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own custom_attributes" ON custom_attributes
  FOR DELETE USING (auth.uid() = user_id);

-- user_security 策略
CREATE POLICY "Users can view own security" ON user_security
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own security" ON user_security
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own security" ON user_security
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own security" ON user_security
  FOR DELETE USING (auth.uid() = user_id);

-- ── updated_at 自动更新触发器 ──
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bookmarks_updated_at
  BEFORE UPDATE ON bookmarks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sibling_groups_updated_at
  BEFORE UPDATE ON sibling_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_custom_attributes_updated_at
  BEFORE UPDATE ON custom_attributes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_user_security_updated_at
  BEFORE UPDATE ON user_security FOR EACH ROW EXECUTE FUNCTION update_updated_at();
