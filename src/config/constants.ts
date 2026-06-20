import type { AppData } from '../types.js'

export const STORAGE_KEY = 'linkvault_v2'
export const CAT_ALL = 'all'
export const CAT_UNCATEGORIZED = 'uncategorized'
export const ATTR_IS_GROUP = 'is-group'
export const MAX_SUGGESTIONS = 8
export const TOAST_FADE_MS = 2200
export const TOAST_REMOVE_MS = 2600
export const PAYLOAD_KEY = 'application/x-linkvault'
export const DRAG_SRC_DETAIL = '__detail__'
export const UI_STATE_KEY = 'lv_uiState'
export const MAX_UNDO = 20
export const UNDO_WINDOW = 500
export const MAX_UNDO_BYTES = 512 * 1024

export const ACTIONS: Record<string, string> = {
  VISIT: 'visit',
  EDIT: 'edit',
  DELETE: 'delete',
  MOVE_TO_CAT: 'moveToCat',
  SHARE_GROUP: 'shareGroup',
  ADD_BOOKMARK: 'addbookmark',
  ADD_GROUP: 'addgroup',
  ADD_CAT: 'addcat',
  MULTI_SELECT: 'multiSelect',
}

const WELCOME_NOTES = '<h1>欢迎使用 LinkVault</h1>'
  + '<p>一个<span style="color: #3B82F6">全能型</span>书签与收藏管理工具，帮你<span style="color: #22C55E">高效</span>整理网络资源。</p>'
  + '<h2>核心功能</h2>'
  + '<ul>'
  + '<li><strong>书签收藏</strong> — 一键收藏网址，自动获取图标与域名</li>'
  + '<li><strong>组编辑器</strong> — 支持<u>标题</u>、<strong>加粗</strong>、<span style="color: #EAB308">颜色</span>、<u>下划线</u>等富文本格式</li>'
  + '<li><strong>内联卡片</strong> — 将书签或组引用嵌入笔记，可拖拽排序</li>'
  + '<li><strong>属性标签</strong> — 自定义属性筛选，快速定位目标书签</li>'
  + '<li><strong>响应式设计</strong> — 桌面端与移动端<span style="color: #A855F7">完美适配</span></li>'
  + '</ul>'
  + '<h2>快速上手</h2>'
  + '<ol>'
  + '<li>点击 <strong>+</strong> 按钮新建书签或组</li>'
  + '<li>将书签<span style="color: #F97316">拖拽</span>到组卡片上即可加入</li>'
  + '<li>聚焦组后使用<u>富文本工具栏</u>编辑内容</li>'
  + '<li>在编辑器中输入 <strong>@</strong> 快速搜索插入书签</li>'
  + '</ol>'
  + '<h2>待办清单</h2>'
  + '<ul data-type="taskList">'
  + '<li data-type="taskItem" data-checked="true">浏览下方示例书签</li>'
  + '<li data-type="taskItem" data-checked="false">创建自己的收藏组</li>'
  + '<li data-type="taskItem" data-checked="false">试试拖拽排序卡片</li>'
  + '<li data-type="taskItem" data-checked="false">探索属性筛选功能</li>'
  + '</ul>'
  + '<h2>组引用</h2>'
  + '<p>点击组卡片的 <strong>+</strong>，切换到<span style="color: #A855F7">组</span>标签，可搜索并将其他组<u>嵌入</u>当前笔记。支持<strong>跨组引用</strong>与<span style="color: #3B82F6">层级导航</span>，构建知识网络：</p>'
  + '<span class="group-inline-card group-ref-card" contenteditable="false" data-bm-id="ref:sg_tips" draggable="true"><span style="width:16px;height:16px;flex-shrink:0;color:var(--accent)"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21.6602 10.44L20.6802 14.62C19.8402 18.23 18.1802 19.69 15.0602 19.39C14.5602 19.35 14.0202 19.26 13.4402 19.12L11.7602 18.72C7.59018 17.73 6.30018 15.67 7.28018 11.49L8.26018 7.30001C8.46018 6.45001 8.70018 5.71001 9.00018 5.10001C10.1702 2.68001 12.1602 2.03001 15.5002 2.82001L17.1702 3.21001C21.3602 4.19001 22.6402 6.26001 21.6602 10.44Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path opacity="0.4" d="M15.0603 19.3901C14.4403 19.8101 13.6603 20.1601 12.7103 20.4701L11.1303 20.9901C7.16034 22.2701 5.07034 21.2001 3.78034 17.2301L2.50034 13.2801C1.22034 9.3101 2.28034 7.2101 6.25034 5.9301L7.83034 5.4101C8.24034 5.2801 8.63034 5.1701 9.00034 5.1001C8.70034 5.7101 8.46034 6.4501 8.26034 7.3001L7.28034 11.4901C6.30034 15.6701 7.59034 17.7301 11.7603 18.7201L13.4403 19.1201C14.0203 19.2601 14.5603 19.3501 15.0603 19.3901Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="gic-name">使用技巧</span><span class="gic-count">2个书签</span><span class="gic-btn">详</span></span>'
  + '<h2>示例书签</h2>'
  + '<p><span style="color: #EC4899">拖拽</span>它们到组中，或直接点击访问：</p>'
  + '<span class="group-inline-card" contenteditable="false" data-bm-id="b1" draggable="true"><img src="https://api.xinac.net/icon/?url=github.com" alt=""><span class="gic-name">GitHub</span><span class="gic-domain">github.com</span><span class="gic-btn">详</span></span> '
  + '<span class="group-inline-card" contenteditable="false" data-bm-id="b2" draggable="true"><img src="https://api.xinac.net/icon/?url=mail.qq.com" alt=""><span class="gic-name">QQ邮箱</span><span class="gic-domain">mail.qq.com</span><span class="gic-btn">详</span></span> '
  + '<span class="group-inline-card" contenteditable="false" data-bm-id="b3" draggable="true"><img src="https://api.xinac.net/icon/?url=www.deepseek.com" alt=""><span class="gic-name">DeepSeek</span><span class="gic-domain">deepseek.com</span><span class="gic-btn">详</span></span> '
  + '<span class="group-inline-card" contenteditable="false" data-bm-id="b4" draggable="true"><img src="https://api.xinac.net/icon/?url=www.douyin.com" alt=""><span class="gic-name">抖音</span><span class="gic-domain">douyin.com</span><span class="gic-btn">详</span></span> '
  + '<span class="group-inline-card" contenteditable="false" data-bm-id="b5" draggable="true"><img src="https://api.xinac.net/icon/?url=store.steampowered.com" alt=""><span class="gic-name">Steam</span><span class="gic-domain">steampowered.com</span><span class="gic-btn">详</span></span>'

const TIPS_NOTES = '<h1>LinkVault 使用指南</h1>'
  + '<h2>组功能详解</h2>'
  + '<p><strong>组</strong>是 LinkVault 的核心组织单元，相当于一个<u>富文本笔记本</u> + <u>书签收纳夹</u>的结合体。</p>'
  + '<h3>组编辑器</h3>'
  + '<ul>'
  + '<li><strong>聚焦</strong> — 点击组图标的笔记按钮进入<u>全屏编辑模式</u>，侧边栏显示格式工具栏</li>'
  + '<li><strong>富文本</strong> — 支持<span style="color: #3B82F6">H1/H2/H3 标题</span>、<strong>加粗</strong>、<u>下划线</u>、<span style="color: #EAB308">9 种文字颜色</span>、有序/无序/待办列表</li>'
  + '<li><strong>输入 @</strong> — 在编辑器中输入 <span style="color: #A855F7">@</span> 触发书签搜索弹窗，快速插入内联卡片</li>'
  + '<li><strong>输入 #</strong> — 输入 <span style="color: #A855F7">#</span> 可搜索并插入<u>其他组引用</u>，构建层级知识网络</li>'
  + '<li><strong>组引用卡片</strong> — 点击组卡片的 <strong>+</strong> 弹出框切换到<span style="color: #22C55E">组</span>标签，搜索已有组嵌入为引用卡片</li>'
  + '<li><strong>撤销/前进</strong> — 每个组独立维护编辑历史，支持 <span style="color: #3B82F6">Ctrl+Z / Ctrl+Y</span></li>'
  + '</ul>'
  + '<h3>组操作</h3>'
  + '<ul>'
  + '<li><strong>排序</strong> — 拖拽组卡片头部可与其他组<u>交换位置</u></li>'
  + '<li><strong>编辑属性</strong> — 点击组卡片的编辑按钮修改名称、图标、分类、标签</li>'
  + '<li><strong>组内搜索</strong> — 聚焦组后使用搜索框可<u>过滤组内的书签卡片</u></li>'
  + '<li><strong>批量选中</strong> — 批量模式下可勾选组进行批量移动或删除</li>'
  + '</ul>'
  + '<h2>子书签功能</h2>'
  + '<p><strong>子书签</strong>（嵌套书签）让一个书签下可以挂载多个子链接，适合整理<u>同一网站的不同入口</u>。</p>'
  + '<ul>'
  + '<li><strong>创建方式</strong> — 新建书签时，在"父书签"下拉中选择已有的顶层书签作为父级</li>'
  + '<li><strong>展开折叠</strong> — 列表视图下，含子书签的条目右侧会出现展开按钮</li>'
  + '<li><strong>层级排序</strong> — 子书签与父书签<span style="color: #F97316">在同一 DOM 树中</span>，拖拽可调整父子关系</li>'
  + '<li><strong>独立属性</strong> — 子书签拥有独立的图标、URL、备注和属性标签</li>'
  + '<li><span style="color: #EC4899">示例：</span>DeepSeek 书签下有两个子书签（开始对话 + API 开发平台），在列表视图中可展开查看</li>'
  + '</ul>'
  + '<h2>拖拽场景大全</h2>'
  + '<ol>'
  + '<li><strong>书签拖到组顶部</strong> — 书签卡片拖到目标组的<u>头部区域</u>，与组交换位置（排序用）</li>'
  + '<li><strong>书签拖到组正文</strong> — 拖入编辑器区域，<span style="color: #22C55E">将书签作为内联卡片插入</span>，出现在鼠标释放位置</li>'
  + '<li><strong>书签拖到书签</strong> — 同级书签间<u>交换排序位置</u></li>'
  + '<li><strong>组拖到组</strong> — 拖到另一个组卡片上，将源组作为<span style="color: #A855F7">组引用卡片</span>嵌入目标组</li>'
  + '<li><strong>组拖到组头部</strong> — 两组<u>交换位置</u></li>'
  + '<li><strong>书签/组拖到网格</strong> — 拖到卡片网格空白处，将书签<u>移出组</u>（如果来自组内）</li>'
  + '<li><strong>拖到详情面板</strong> — 将书签拖到右侧详情面板临时查看</li>'
  + '<li><strong>内联卡片拖拽</strong> — 在组编辑器内直接拖拽内联卡片<span style="color: #F97316">调整顺序</span></li>'
  + '<li><strong>侧边栏分类拖拽</strong> — 拖拽书签到左侧分类项，修改其所属分类；拖拽分类项可排序</li>'
  + '<li><strong>跨组拖放</strong> — 从一个组拖书签到另一个组 = <u>移动</u>（自动从源组移除）</li>'
  + '</ul>'
  + '<h2>更多实用技巧</h2>'
  + '<ul>'
  + '<li><strong>右键 / 长按菜单</strong> — 桌面右键或移动端长按书签/组卡片，快速<u>打开、编辑、移动、删除</u></li>'
  + '<li><strong>批量管理</strong> — 点击顶部「批量管理」进入多选模式，支持<span style="color: #3B82F6">全选 Ctrl+A</span>、批量移动、批量删除</li>'
  + '<li><strong>详情面板</strong> — 点击书签卡片的「详」按钮，在右侧面板<u>集中预览多个书签</u>，支持拖入批量查看</li>'
  + '<li><strong>内联重命名</strong> — 双击书签或组的名称区域可<span style="color: #22C55E">直接修改标题</span></li>'
  + '<li><strong>属性筛选</strong> — 点击「属性」按钮，勾选标签筛选：<span style="color: #EAB308">需要登录</span>、<span style="color: #22C55E">国内可用</span>、<span style="color: #A855F7">AI</span> 等</li>'
  + '<li><strong>布局切换</strong> — 顶栏切换<span style="color: #3B82F6">网格 / 列表</span>视图；列表视图下点击卡片空白处可展开组</li>'
  + '<li><strong>数据安全</strong> — 书签可设置<u>加密密码</u>（存储时加密）；支持设置<u>主密码</u>保护所有敏感字段</li>'
  + '<li><strong>导入导出</strong> — 支持 JSON 格式<u>导出备份</u>和<u>导入恢复</u>，侧边栏底部可查看存储用量</li>'
  + '<li><strong>主题与外观</strong> — 设置面板支持亮色/暗色/自动主题，多种<u>主题配色</u>自由切换</li>'
  + '<li><strong>移动端适配</strong> — 手机端自动切换列表布局，底部弹出式菜单，<span style="color: #EC4899">Touch 拖拽排序</span></li>'
  + '</ul>'
  + '<h2>快捷键汇总</h2>'
  + '<p><span style="color: #6B7280">（Mac 用户将 Ctrl 替换为 ⌘ Cmd）</span></p>'
  + '<ul>'
  + '<li><span style="color: #3B82F6">Ctrl + K</span>  聚焦搜索框，全局搜索书签与组</li>'
  + '<li><span style="color: #3B82F6">Ctrl + N</span>  打开新建书签弹窗</li>'
  + '<li><span style="color: #3B82F6">Ctrl + B</span>  在组编辑器中<strong>加粗</strong>选中文字</li>'
  + '<li><span style="color: #3B82F6">Ctrl + Shift + 1</span>  设为 <strong>H1</strong> 大标题</li>'
  + '<li><span style="color: #3B82F6">Ctrl + Shift + 2</span>  设为 <strong>H2</strong> 中标题</li>'
  + '<li><span style="color: #3B82F6">Ctrl + Shift + 3</span>  设为 <strong>H3</strong> 小标题</li>'
  + '<li><span style="color: #3B82F6">Ctrl + Z</span>  撤销组内编辑操作</li>'
  + '<li><span style="color: #3B82F6">Ctrl + Y</span>  重做已撤销操作</li>'
  + '<li><span style="color: #EF4444">Esc</span>  关闭弹窗 / 退出聚焦 / 退出批量模式 / 关闭菜单</li>'
  + '<li><span style="color: #3B82F6">Tab</span>  在弹窗的表单字段间<u>循环切换焦点</u></li>'
  + '<li><span style="color: #3B82F6">Ctrl + A</span>  <u>批量模式下</u>全选所有可见卡片</li>'
  + '<li><span style="color: #EF4444">Delete</span>  <u>批量模式下</u>删除所有选中项</li>'
  + '<li><span style="color: #A855F7">@</span>  <u>编辑器内</u>触发书签搜索并内联插入</li>'
  + '<li><span style="color: #A855F7">#</span>  <u>编辑器内</u>触发组搜索并插入组引用</li>'
  + '</ul>'
  + '<p>把下面的书签<span style="color: #F97316">拖到</span>欢迎组里试试看：</p>'
  + '<span class="group-inline-card" contenteditable="false" data-bm-id="b3" draggable="true"><img src="https://api.xinac.net/icon/?url=www.deepseek.com" alt=""><span class="gic-name">DeepSeek</span><span class="gic-domain">deepseek.com</span><span class="gic-btn">详</span></span> '
  + '<span class="group-inline-card" contenteditable="false" data-bm-id="b4" draggable="true"><img src="https://api.xinac.net/icon/?url=www.douyin.com" alt=""><span class="gic-name">抖音</span><span class="gic-domain">douyin.com</span><span class="gic-btn">详</span></span>'

export const DEFAULTS: AppData = {
  categories: [
    { id: 'all', name: '全部', icon: 'grid', color: '#122E8A' },
    { id: 'uncategorized', name: '未分类', icon: 'bookmark', color: '#6E6860' },
    { id: 'email', name: '邮箱', icon: 'mail', color: '#e11d48' },
    { id: 'tools', name: '工具', icon: 'tool', color: '#d97706' },
    { id: 'ai', name: 'AI', icon: 'ai-icon', color: '#8b5cf6' },
    { id: 'social', name: '社交', icon: 'social-icon', color: '#1d9bf0' },
    { id: 'game', name: '游戏平台', icon: 'game-icon', color: '#16a34a' }
  ],
  bookmarks: [
    { id: 'b1', title: 'GitHub', url: 'https://github.com', username: '', password: '', notes: '代码托管平台', icon: '', categoryId: 'tools', parentId: null, order: 0, useCount: 15, attributes: { 'requires-login': true }, isExpanded: false, createdAt: Date.now() - 86400000, updatedAt: Date.now() - 86400000 },
    { id: 'b2', title: 'QQ邮箱', url: 'https://mail.qq.com', username: '@qq.com', password: 'MTIz', notes: '', icon: '', categoryId: 'email', parentId: null, order: 1, useCount: 8, attributes: { 'requires-login': true, 'china-available': true }, isExpanded: false, createdAt: Date.now() - 172800000, updatedAt: Date.now() - 172800000 },
    { id: 'b3', title: 'DeepSeek', url: 'https://www.deepseek.com/', username: '', password: '', notes: 'API key:', icon: '', categoryId: 'ai', parentId: null, order: 2, useCount: 5, attributes: { 'china-available': true, 'ai': true }, isExpanded: false, createdAt: Date.now() - 40000000, updatedAt: Date.now() - 40000000 },
    { id: 'sb1', title: '开始对话', url: 'https://chat.deepseek.com/', username: '', password: '', notes: '', icon: '', categoryId: 'ai', parentId: 'b3', order: 0, useCount: 3, attributes: { 'china-available': true, 'ai': true }, isExpanded: false, createdAt: Date.now() - 30000000, updatedAt: Date.now() - 30000000 },
    { id: 'sb2', title: 'API开发平台', url: 'https://platform.deepseek.com/usage', username: '', password: '', notes: '', icon: '', categoryId: 'ai', parentId: 'b3', order: 1, useCount: 2, attributes: { 'china-available': true, 'ai': true }, isExpanded: false, createdAt: Date.now() - 20000000, updatedAt: Date.now() - 20000000 },
    { id: 'b4', title: '抖音', url: 'https://www.douyin.com', username: '', password: '', notes: '短视频平台', icon: '', categoryId: 'social', parentId: null, order: 3, useCount: 0, attributes: { 'china-available': true }, isExpanded: false, createdAt: Date.now() - 345600000, updatedAt: Date.now() - 345600000 },
    { id: 'b5', title: 'Steam', url: 'https://store.steampowered.com', username: '', password: '', notes: '游戏平台', icon: '', categoryId: 'game', parentId: null, order: 4, useCount: 0, attributes: { 'requires-login': true }, isExpanded: false, createdAt: Date.now() - 100000, updatedAt: Date.now() - 100000 }
  ],
  customAttributes: [
    { id: 'requires-login', name: '需要登录', type: 'boolean' },
    { id: 'china-available', name: '国内可用', type: 'boolean' },
    { id: 'ai', name: 'Ai', type: 'boolean' },
    { id: 'is-group', name: '组', type: 'boolean' }
  ],
  siblingGroups: [
    {
      id: 'sg_welcome', name: '欢迎使用', categoryId: 'uncategorized', icon: '', order: 0, isExpanded: false,
      attributes: { 'is-group': true },
      bookmarkIds: ['b1', 'b2', 'b3', 'b4', 'b5'],
      notes: WELCOME_NOTES,
      updatedAt: 0, useCount: 0,
    },
    {
      id: 'sg_tips', name: '使用技巧', categoryId: 'uncategorized', icon: '', order: 1, isExpanded: false,
      attributes: { 'is-group': true },
      bookmarkIds: ['b3', 'b4'],
      notes: TIPS_NOTES,
      updatedAt: 0, useCount: 0,
    }
  ]
}