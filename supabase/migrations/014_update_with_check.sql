-- 014_update_with_check.sql
-- 修复全表 UPDATE 策略缺 WITH CHECK 导致的越权提权：
-- 001_initial_schema.sql 的 bookmarks / sibling_groups / categories /
-- custom_attributes / user_security 5 张表上 FOR UPDATE 策略仅有 USING
-- (auth.uid() = user_id)，仅校验「修改前的行」归属当前用户，对新行不做校验。
-- 已认证用户可把自己某条记录的 user_id 改成他人，转让数据归属绕过 RLS 写入门禁，
-- 或把 deleted_at / updated_at_num 篡改为异常值扰乱同步与软删除。本迁移为这 5 条
-- UPDATE 策略补 WITH CHECK (auth.uid() = user_id)，使新行也被锁定在「本人」范围内。

-- categories
DROP POLICY IF EXISTS "Users can update own categories" ON categories;
CREATE POLICY "Users can update own categories" ON categories
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- bookmarks
DROP POLICY IF EXISTS "Users can update own bookmarks" ON bookmarks;
CREATE POLICY "Users can update own bookmarks" ON bookmarks
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- sibling_groups
DROP POLICY IF EXISTS "Users can update own sibling_groups" ON sibling_groups;
CREATE POLICY "Users can update own sibling_groups" ON sibling_groups
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- custom_attributes
DROP POLICY IF EXISTS "Users can update own custom_attributes" ON custom_attributes;
CREATE POLICY "Users can update own custom_attributes" ON custom_attributes
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- user_security（尤其不可改 user_id，否则可把主密码金丝雀转给他人）
DROP POLICY IF EXISTS "Users can update own security" ON user_security;
CREATE POLICY "Users can update own security" ON user_security
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

SELECT pg_notify('pgrst', 'reload schema');
