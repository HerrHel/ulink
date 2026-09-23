import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const SOFTWARE_NAME = process.argv[2] || '与链个人书签管理软件'
const VERSION = process.argv[3] || 'V1.0'

const shotsDir = path.resolve('outputs/shots')

function getBase64Img(filename) {
  const p = path.join(shotsDir, filename)
  if (!fs.existsSync(p)) return ''
  const buf = fs.readFileSync(p)
  return `data:image/png;base64,${buf.toString('base64')}`
}

const imgWelcome = getBase64Img('01_welcome.png')
const imgDashboard = getBase64Img('02_main_dashboard.png')
const imgAddModal = getBase64Img('03_modal_add_bookmark.png')
const imgSearch = getBase64Img('04_search_filter.png')
const imgCategory = getBase64Img('05_category_modal.png')
const imgSettings = getBase64Img('06_settings_panel.png')

const pages = [
  // Page 1: 封面
  `
  <div class="manual-page cover-page">
    <div class="cover-content">
      <div class="cover-logo-space"></div>
      <h1 class="cover-title">${SOFTWARE_NAME}</h1>
      <h2 class="cover-subtitle">用户使用说明书</h2>
      <div class="cover-meta">
        <p><span>软件版本：</span><strong>${VERSION}</strong></p>
        <p><span>文档类型：</span><strong>用户操作使用手册</strong></p>
        <p><span>编写日期：</span><strong>2026年9月</strong></p>
      </div>
    </div>
  </div>
  `,

  // Page 2: 目录
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h2 class="section-title">目 录</h2>
      <div class="toc-list">
        <div class="toc-item"><span>第一章 软件概述与运行环境</span><span class="dots"></span><span>3</span></div>
        <div class="toc-subitem"><span>1.1 软件简介与核心定位</span><span class="dots"></span><span>3</span></div>
        <div class="toc-subitem"><span>1.2 运行环境与硬件要求</span><span class="dots"></span><span>3</span></div>
        <div class="toc-item"><span>第二章 快速启动与主工作台</span><span class="dots"></span><span>4</span></div>
        <div class="toc-subitem"><span>2.1 系统启动与初次引导</span><span class="dots"></span><span>4</span></div>
        <div class="toc-subitem"><span>2.2 主界面布局与功能分区</span><span class="dots"></span><span>5</span></div>
        <div class="toc-item"><span>第三章 书签全生命周期管理</span><span class="dots"></span><span>6</span></div>
        <div class="toc-subitem"><span>3.1 新建书签与录入信息</span><span class="dots"></span><span>6</span></div>
        <div class="toc-subitem"><span>3.2 书签层级归属与子网站管理</span><span class="dots"></span><span>7</span></div>
        <div class="toc-subitem"><span>3.3 编辑、置顶与软删除操作</span><span class="dots"></span><span>8</span></div>
        <div class="toc-item"><span>第四章 分类导航与属性标签</span><span class="dots"></span><span>9</span></div>
        <div class="toc-subitem"><span>4.1 分类新增与自定义管理</span><span class="dots"></span><span>9</span></div>
        <div class="toc-subitem"><span>4.2 属性标记与多维筛选</span><span class="dots"></span><span>10</span></div>
        <div class="toc-item"><span>第五章 智能检索与秒级定位</span><span class="dots"></span><span>11</span></div>
        <div class="toc-subitem"><span>5.1 拼音与汉字智能模糊检索</span><span class="dots"></span><span>11</span></div>
        <div class="toc-subitem"><span>5.2 组合筛选与实时匹配</span><span class="dots"></span><span>12</span></div>
        <div class="toc-item"><span>第六章 系统配置与数据安全维护</span><span class="dots"></span><span>13</span></div>
        <div class="toc-subitem"><span>6.1 视图切换与显示排序偏好</span><span class="dots"></span><span>13</span></div>
        <div class="toc-subitem"><span>6.2 端到端数据加密与保险箱</span><span class="dots"></span><span>14</span></div>
        <div class="toc-subitem"><span>6.3 死链检测与数据备份导出</span><span class="dots"></span><span>15</span></div>
      </div>
    </div>
    <div class="footer">第 2 页 共 15 页</div>
  </div>
  `,

  // Page 3: 第一章 软件概述与运行环境
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h2 class="section-title">第一章 软件概述与运行环境</h2>
      
      <h3 class="subsection-title">1.1 软件简介与核心定位</h3>
      <p class="paragraph">${SOFTWARE_NAME}是一款现代化的个人书签与数字知识沉淀系统。系统针对现代互联网用户日常浏览中收藏零散、检索繁琐、多端不同步以及隐私安全无法保障等痛点，提供了多层级书签分组、拼音汉字模糊检索、端到端高强度加密以及大容量离线本地持久化等完整功能。</p>
      <p class="paragraph">系统采用渐进式 Web 架构开发，同时支持桌面 PC 端与移动端设备直接通过主流现代浏览器即开即用，保障个人网络数字资产的安全存储与高效调取。</p>

      <h3 class="subsection-title">1.2 运行硬件要求</h3>
      <p class="paragraph">本软件对终端硬件配置要求平易通用，推荐配置如下：</p>
      <table class="manual-table">
        <tr><th>硬件组件</th><th>最低配置要求</th><th>推荐配置</th></tr>
        <tr><td>中央处理器 (CPU)</td><td>1.0 GHz 以上双核处理器</td><td>2.0 GHz 以上四核处理器</td></tr>
        <tr><td>系统运行内存 (RAM)</td><td>2 GB 以上</td><td>4 GB 及以上</td></tr>
        <tr><td>可用存储空间</td><td>500 MB 可用硬盘空间</td><td>1 GB 及以上固态存储</td></tr>
        <tr><td>显示分辨率</td><td>1024 × 768 像素</td><td>1920 × 1080 像素及以上</td></tr>
      </table>

      <h3 class="subsection-title">1.3 软件与支撑环境</h3>
      <table class="manual-table">
        <tr><th>环境项目</th><th>规范与要求</th></tr>
        <tr><td>操作系统环境</td><td>Windows 10 / 11、macOS 11+、Linux、Android 9+、iOS 14+</td></tr>
        <tr><td>支撑浏览器</td><td>Google Chrome 90+、Microsoft Edge 90+、Safari 14+、Firefox 90+</td></tr>
        <tr><td>网络环境</td><td>单机运行支持完全离线；使用多端实时云同步时需保证互联网连接</td></tr>
      </table>
    </div>
    <div class="footer">第 3 页 共 15 页</div>
  </div>
  `,

  // Page 4: 第二章 快速启动与主工作台 (2.1)
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h2 class="section-title">第二章 快速启动与主工作台</h2>
      
      <h3 class="subsection-title">2.1 系统启动与初次引导</h3>
      <p class="paragraph">用户在浏览器中打开软件运行地址后，系统将自动进行 IndexedDB 本地数据库的初始化检测。若系统检测到当前为首次使用，将主动弹出欢迎引导界面，向用户展示系统定位及快速上手途径。</p>
      
      <div class="img-container">
        <img src="${imgWelcome}" alt="初次使用引导界面" class="manual-img" />
        <p class="img-caption">图 2-1 软件初次启动欢迎与导入引导界面</p>
      </div>

      <p class="paragraph"><strong>操作指引：</strong></p>
      <ul class="manual-list">
        <li><strong>全新开始：</strong>点击该选项，系统将自动植入示例数据，方便用户熟悉卡片结构与层级逻辑；</li>
        <li><strong>从其他工具导入：</strong>若用户此前已在其他浏览器或其他书签服务中积累了数据，可点击直接打开文件导入面板；</li>
        <li><strong>跳过直接开始：</strong>直接关闭引导并进入主工作台空白界面。</li>
      </ul>
    </div>
    <div class="footer">第 4 页 共 15 页</div>
  </div>
  `,

  // Page 5: 第二章 快速启动与主工作台 (2.2)
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h3 class="subsection-title">2.2 主界面布局与功能分区</h3>
      <p class="paragraph">进入系统后，主工作台呈现清晰的三段式设计，布局紧凑直观，各功能分区职责分明：</p>
      
      <div class="img-container">
        <img src="${imgDashboard}" alt="系统主工作台界面" class="manual-img" />
        <p class="img-caption">图 2-2 系统主工作台界面整体布局</p>
      </div>

      <p class="paragraph"><strong>界面核心分区说明：</strong></p>
      <ol class="manual-list">
        <li><strong>左侧分类导航栏：</strong>提供系统分类视图列表，支持按分类统计书签数量，底部常驻分类管理与深浅主题切换入口；</li>
        <li><strong>顶部核心操作栏：</strong>居中布置全局智能搜索输入框，右上角提供登录状态指示、全局快捷功能及加号新建菜单；</li>
        <li><strong>中央书签展示区：</strong>以响应式卡片网格呈现所有已收录的书签与组别，卡片清晰展示站点图标、标题、域名、属性芯片、访问计数及快捷操作按钮。</li>
      </ol>
    </div>
    <div class="footer">第 5 页 共 15 页</div>
  </div>
  `,

  // Page 6: 第三章 书签全生命周期管理 (3.1)
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h2 class="section-title">第三章 书签全生命周期管理</h2>
      
      <h3 class="subsection-title">3.1 新建书签与录入信息</h3>
      <p class="paragraph">用户可通过点击界面右上角的「+」操作按钮，在下拉菜单中选择「新建书签」，系统将弹出规范的新增模态对话框。</p>
      
      <div class="img-container">
        <img src="${imgAddModal}" alt="添加书签对话框" class="manual-img" />
        <p class="img-caption">图 3-1 添加书签详细表单界面</p>
      </div>

      <p class="paragraph"><strong>表单字段录入说明：</strong></p>
      <ul class="manual-list">
        <li><strong>网址 (必填)：</strong>输入目标网站的 URL 地址，系统支持智能协议前缀补全；</li>
        <li><strong>网站名称：</strong>输入自定义书签标题；若留空，系统将自动尝试通过网络嗅探填充站点默认标题；</li>
        <li><strong>账户与密码：</strong>在开启端到端加密机制后，支持安全存放该网站对应的敏感凭据信息；</li>
        <li><strong>备注：</strong>用户可在此输入针对该站点的文字说明或操作备忘。</li>
      </ul>
    </div>
    <div class="footer">第 6 页 共 15 页</div>
  </div>
  `,

  // Page 7: 第三章 书签全生命周期管理 (3.2)
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h3 class="subsection-title">3.2 书签层级归属与子网站管理</h3>
      <p class="paragraph">传统浏览器书签仅支持平铺或单层目录，${SOFTWARE_NAME}创新支持树形父子层级嵌套，特别适用于管理大型平台旗下的多个细分子产品。</p>
      
      <p class="paragraph"><strong>操作流程：</strong></p>
      <ol class="manual-list">
        <li>在新建或编辑书签对话框中，定位至「父级 (子网站)」下拉选择器；</li>
        <li>从当前已存在的书签列表中挑选目标父书签（例如将“API 开发平台”指定到“DeepSeek”主体下）；</li>
        <li>系统底层将自动触发循环引用安全检测，防止把自身或后代节点误设为父级；</li>
        <li>点击「保存」按钮，子书签将整齐嵌套显示在父卡片底部，支持一键折叠或展开。</li>
      </ol>

      <h3 class="subsection-title">3.3 图标嗅探与个性化定制</h3>
      <p class="paragraph">系统在书签录入时会自动嗅探网站高清 Favicon 图标并进行本地持久化缓存。若因目标网络跨域或无有效图标，用户可在「自定义图标」栏直接录入特定的图片 URL，系统将优先采用自定义图标渲染。</p>
    </div>
    <div class="footer">第 7 页 共 15 页</div>
  </div>
  `,

  // Page 8: 第三章 书签全生命周期管理 (3.3)
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h3 class="subsection-title">3.4 编辑、置顶与软删除机制</h3>
      <p class="paragraph">在主工作台的书签卡片上，每个卡片底部均配有一组快捷操作工具栏：</p>
      
      <p class="paragraph"><strong>核心操作步骤：</strong></p>
      <ul class="manual-list">
        <li><strong>快速编辑：</strong>点击卡片右下角的「编辑」图标，即可重新调出表单，修改标题、链接、备注等信息；</li>
        <li><strong>拖拽排序：</strong>鼠标悬停在卡片或通过拖拽手柄按住拖动，可实时调整卡片在视图中的先后顺序，松开后系统自动持久化 order 序号；</li>
        <li><strong>软删除放入回收站：</strong>点击卡片上的「删除」图标，系统将执行安全软删除逻辑（为该记录标记 deletedAt 时间戳），相关联的子书签与分组映射暂存保存，数据并不会立即物理丢失；</li>
        <li><strong>回收站还原：</strong>用户在侧边栏进入回收站后，可对误删的书签执行一键还原，所有层级关系自动恢复如初。</li>
      </ul>

      <h3 class="subsection-title">3.5 访问频次统计与置顶</h3>
      <p class="paragraph">用户每次点击卡片访问外部目标网址时，系统将自动对 'useCount' 计数器累加 1，并在卡片左下角直观显示访问次数（如“5次”）。用户亦可点击置顶选项，将高频核心书签固定展示在视图首位。</p>
    </div>
    <div class="footer">第 8 页 共 15 页</div>
  </div>
  `,

  // Page 9: 第四章 分类导航与属性标签 (4.1)
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h2 class="section-title">第四章 分类导航与属性标签</h2>
      
      <h3 class="subsection-title">4.1 分类新增与自定义管理</h3>
      <p class="paragraph">系统左侧侧边栏承载全部分类导航。用户点击左下角的「管理分类」按钮，即可唤出分类管理弹窗，自由对分类体系进行增删改查。</p>
      
      <div class="img-container">
        <img src="${imgCategory}" alt="分类管理对话框" class="manual-img" />
        <p class="img-caption">图 4-1 分类管理与个性化维护弹窗</p>
      </div>

      <p class="paragraph"><strong>管理操作步骤：</strong></p>
      <ol class="manual-list">
        <li><strong>新建分类：</strong>在顶部输入框输入新的分类名称（如“工作资源”），点击「添加」按钮即可即时生效；</li>
        <li><strong>重命名分类：</strong>点击任一分类条目右侧的编辑图标，直接在行内输入新名称并确认；</li>
        <li><strong>删除分类：</strong>点击分类右侧删除图标，系统具备安全防损机制：删除分类不会随之删除其包含的书签，所有原本属于该分类的书签将自动平滑回退至「未分类」中。</li>
      </ol>
    </div>
    <div class="footer">第 9 页 共 15 页</div>
  </div>
  `,

  // Page 10: 第四章 分类导航与属性标签 (4.2)
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h3 class="subsection-title">4.2 属性标记与多维筛选</h3>
      <p class="paragraph">为了打破传统书签单维度目录分类的局限性，本系统设计了基于 Boolean 属性标签的轻量元数据管理机制。</p>
      
      <p class="paragraph"><strong>属性标签特性与应用：</strong></p>
      <ul class="manual-list">
        <li><strong>属性定义：</strong>系统允许用户自定义业务属性（如“需要登录”、“AI”、“常用工具”等）；</li>
        <li><strong>书签打标：</strong>在书签编辑表单中，用户只需单击对应的属性芯片，即可为当前书签绑定该属性；</li>
        <li><strong>视图筛选芯片：</strong>主界面左上方常驻「属性」筛选条，点击展开后可多选特定属性芯片；</li>
        <li><strong>即时动态响应：</strong>系统基于响应式状态流，在勾选属性后毫秒级重构当前卡片列表，仅展示符合全部选中属性条件的书签组合。</li>
      </ul>

      <h3 class="subsection-title">4.3 私密分类空间</h3>
      <p class="paragraph">在分类管理弹窗的右上角，系统提供了「私密空间」切换通道。对于不想在日常公开界面展示的个人敏感资产，可将其归入私密空间中，配合主密码锁定功能，实现物理级的数据隔离浏览。</p>
    </div>
    <div class="footer">第 10 页 共 15 页</div>
  </div>
  `,

  // Page 11: 第五章 智能检索与秒级定位 (5.1)
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h2 class="section-title">第五章 智能检索与秒级定位</h2>
      
      <h3 class="subsection-title">5.1 拼音与汉字智能模糊检索</h3>
      <p class="paragraph">系统在顶部导航栏中央设立了常驻全局搜索框。为提升海量书签下的检索效率，底层深度集成了拼音分词与高性能模糊匹配算法。</p>
      
      <div class="img-container">
        <img src="${imgSearch}" alt="搜索与模糊匹配结果" class="manual-img" />
        <p class="img-caption">图 5-1 关键词实时搜索与即时结果联动</p>
      </div>

      <p class="paragraph"><strong>检索能力特点：</strong></p>
      <ul class="manual-list">
        <li><strong>拼音首字母检索：</strong>用户无需切换输入法，输入站点拼音首字母（例如输入“qq”或“steam”）即可立即命中对应网站；</li>
        <li><strong>多字段联合检索：</strong>搜索匹配范围覆盖网站标题、域名 URL、备注文本及属性标签，全面提升查准率；</li>
        <li><strong>按需异步加载：</strong>拼音与分词库采用懒加载机制，只有在用户首次点击搜索框时才触发动态拉取，保障软件首屏加载秒开。</li>
      </ul>
    </div>
    <div class="footer">第 11 页 共 15 页</div>
  </div>
  `,

  // Page 12: 第五章 智能检索与秒级定位 (5.2)
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h3 class="subsection-title">5.2 快捷键与命令面板协同</h3>
      <p class="paragraph">为满足效率型极客用户的键盘化操作需求，系统内置了完备的全局快捷键体系：</p>
      
      <table class="manual-table">
        <tr><th>快捷键组合</th><th>功能动作</th><th>使用场景说明</th></tr>
        <tr><td><kbd>/</kbd> 或 <kbd>Ctrl</kbd> + <kbd>K</kbd></td><td>聚焦主搜索框</td><td>随时一键调起搜索焦点并清空原有文字</td></tr>
        <tr><td><kbd>Ctrl</kbd> + <kbd>N</kbd></td><td>打开新建书签模态框</td><td>无需使用鼠标点击加号，直接进入录入模式</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>退出弹窗 / 清除搜索</td><td>快速收起当前所有活动对话框并重置视图</td></tr>
        <tr><td><kbd>Ctrl</kbd> + <kbd>B</kbd></td><td>批量管理模式切换</td><td>开启多选复选框，执行批量移动或删除</td></tr>
      </table>

      <h3 class="subsection-title">5.3 搜索结果防抖与性能保障</h3>
      <p class="paragraph">在书签库达到数千条规模时，系统在输入监听层实施了合理的防抖 (Debounce) 调度，避免用户连续键入过程中频繁重建倒排索引，使得中低端移动设备也能保持 60 FPS 顺滑打字体验。</p>
    </div>
    <div class="footer">第 12 页 共 15 页</div>
  </div>
  `,

  // Page 13: 第六章 系统配置与数据安全维护 (6.1)
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h2 class="section-title">第六章 系统配置与数据安全维护</h2>
      
      <h3 class="subsection-title">6.1 视图与排序偏好设置</h3>
      <p class="paragraph">点击主界面右上角齿轮图标，即可滑出「系统设置」侧边抽屉面板。面板内汇集了个性化偏好、安全状态及系统维护项。</p>
      
      <div class="img-container">
        <img src="${imgSettings}" alt="系统设置面板" class="manual-img" />
        <p class="img-caption">图 6-1 系统设置抽屉面板功能选项</p>
      </div>

      <p class="paragraph"><strong>核心配置模块：</strong></p>
      <ul class="manual-list">
        <li><strong>主题风格切换：</strong>支持浅色、深色、效率及舒适四种视觉排版预设，亦可勾选「跟随系统」自动按操作系统昼夜模式适配；</li>
        <li><strong>卡片视图形态：</strong>提供网格卡片、紧凑列表等多种呈现方式，适应不同屏幕宽度下的阅读偏好；</li>
        <li><strong>多维排序规则：</strong>支持按自定义顺序、名称字典序、更新时间（新到旧/旧到新）及访问频次倒序排列，支持开启「组置顶」。</li>
      </ul>
    </div>
    <div class="footer">第 13 页 共 15 页</div>
  </div>
  `,

  // Page 14: 第六章 系统配置与数据安全维护 (6.2)
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h3 class="subsection-title">6.2 端到端数据加密与密码保险箱</h3>
      <p class="paragraph">系统将用户隐私视为最高优先级，内置符合现代安全标准的密码保险箱模块，为账号信息与隐私备注提供端到端高强度加密防护。</p>
      
      <p class="paragraph"><strong>加密运行机制与使用规范：</strong></p>
      <ol class="manual-list">
        <li><strong>开启主密码保护：</strong>在设置面板点击「开启数据解密」，系统引导用户设定独立的高强度主密码；</li>
        <li><strong>密钥派生标准：</strong>底层采用 PBKDF2 算法结合 600,000 次哈希迭代以及密码学安全随机生成的 32 字节盐值 (Salt)，从主密码派生出 256 位 AES 密钥；</li>
        <li><strong>密文加密存储：</strong>敏感数据采用 AES-256-GCM 算法加密，每次加密均生成独一无二的 12 字节初始向量 (IV)；</li>
        <li><strong>离位锁屏防护：</strong>用户离开电脑或应用切换至后台时，系统将自动进入安全锁定状态，立即从浏览器内存中擦除解密密钥明文，重新键入主密码通过金丝雀校验后方可解锁展示。</li>
      </ol>

      <p class="paragraph"><strong>密文安全隔离原则：</strong><br />未解锁状态下，加密字段在前端仅显示为安全锁定标记，绝不向界面渲染乱码密文字符串，亦绝不进入明文搜索索引中，从源头上杜绝信息泄露风险。</p>
    </div>
    <div class="footer">第 14 页 共 15 页</div>
  </div>
  `,

  // Page 15: 第六章 系统配置与数据安全维护 (6.3)
  `
  <div class="manual-page">
    <div class="header"><span>${SOFTWARE_NAME} ${VERSION}</span><span>用户使用说明书</span></div>
    <div class="body-content">
      <h3 class="subsection-title">6.3 链路健康维护与死链检测</h3>
      <p class="paragraph">随着互联网发展，部分早期收藏的网站可能发生停机或域名变更。系统内置「检测死链」静默巡检功能：</p>
      <ul class="manual-list">
        <li>在设置面板中点击「检测死链」按钮，后台将以低并发、不打扰用户的模式探测书签可达性；</li>
        <li>检测到 HTTP 404 或解析失败的目标时，系统会自动在卡片上标示失效预警，方便用户清理。</li>
      </ul>

      <h3 class="subsection-title">6.4 全量数据备份与跨平台迁移</h3>
      <p class="paragraph">为防止平台绑定与意外数据损失，系统秉持数据自主掌控原则，提供了开放的导入导出接口：</p>
      <ol class="manual-list">
        <li><strong>JSON 全量备份导出：</strong>支持将书签、分组树、分类、自定义属性及历史版本整体导出为符合工业标准的 JSON 格式文件，随时供离线归档保存；</li>
        <li><strong>HTML 格式书签文件导入：</strong>兼容 Chrome、Edge、Firefox、Safari 等主流浏览器导出的标准书签 HTML 文件，自动解析文件夹层级并无损导入本系统；</li>
        <li><strong>多端增量云同步：</strong>系统支持配置远程同步通道，借助增量版本对比与时间戳冲突解决机制，在多台终端设备间自动实现数据的安全流转与合并。</li>
      </ol>
    </div>
    <div class="footer">第 15 页 共 15 页</div>
  </div>
  `
]

const TOTAL_PAGES = pages.length

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${SOFTWARE_NAME} ${VERSION} 用户使用说明书</title>
<style>
  @page {
    size: A4 portrait;
    margin: 0;
  }
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
  body {
    background: #f1f5f9;
    font-family: "PingFang SC", "Microsoft YaHei", "SimSun", sans-serif;
    color: #1e293b;
    line-height: 1.6;
  }
  .manual-page {
    width: 210mm;
    height: 297mm;
    margin: 20px auto;
    background: #ffffff;
    padding: 16mm 20mm 15mm 20mm;
    position: relative;
    box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    page-break-after: always;
  }
  @media print {
    body {
      background: none;
    }
    .manual-page {
      margin: 0;
      box-shadow: none;
      width: 210mm;
      height: 297mm;
      page-break-after: always;
      page-break-inside: avoid;
    }
  }

  /* 页眉页脚 */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #334155;
    padding-bottom: 6px;
    margin-bottom: 16px;
    font-size: 9.5pt;
    font-family: "SimSun", "STSong", serif;
    color: #475569;
  }
  .footer {
    position: absolute;
    bottom: 12mm;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 9.5pt;
    font-family: "SimSun", "STSong", serif;
    color: #475569;
  }

  /* 封面 */
  .cover-page {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 40mm 20mm;
  }
  .cover-content {
    margin-top: 50mm;
  }
  .cover-title {
    font-size: 26pt;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 14px;
    letter-spacing: 1px;
  }
  .cover-subtitle {
    font-size: 16pt;
    font-weight: 500;
    color: #3b82f6;
    margin-bottom: 60mm;
    letter-spacing: 2px;
  }
  .cover-meta {
    font-size: 11pt;
    color: #475569;
    text-align: left;
    display: inline-block;
    line-height: 2.2;
    border-top: 2px solid #e2e8f0;
    padding-top: 15px;
    min-width: 240px;
  }
  .cover-meta strong {
    color: #0f172a;
  }

  /* 标题体系 */
  .section-title {
    font-size: 16pt;
    font-weight: 700;
    color: #0f172a;
    border-left: 4px solid #2563eb;
    padding-left: 10px;
    margin-bottom: 14px;
  }
  .subsection-title {
    font-size: 12pt;
    font-weight: 600;
    color: #1e293b;
    margin-top: 14px;
    margin-bottom: 8px;
  }
  .paragraph {
    font-size: 10pt;
    color: #334155;
    text-align: justify;
    margin-bottom: 10px;
    text-indent: 2em;
    line-height: 1.7;
  }

  /* 目录 */
  .toc-list {
    margin-top: 20px;
  }
  .toc-item {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 10.5pt;
    font-weight: 600;
    color: #0f172a;
    margin-top: 10px;
    margin-bottom: 4px;
  }
  .toc-subitem {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 9.5pt;
    color: #475569;
    padding-left: 18px;
    margin-bottom: 4px;
  }
  .dots {
    flex: 1;
    border-bottom: 1px dotted #cbd5e1;
    margin: 0 8px;
  }

  /* 图片与图题 */
  .img-container {
    text-align: center;
    margin: 12px 0;
  }
  .manual-img {
    max-width: 90%;
    max-height: 110mm;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.06);
  }
  .img-caption {
    font-size: 8.5pt;
    color: #64748b;
    margin-top: 6px;
    font-weight: 500;
  }

  /* 列表与表格 */
  .manual-list {
    font-size: 9.5pt;
    color: #334155;
    padding-left: 24px;
    margin-bottom: 10px;
    line-height: 1.65;
  }
  .manual-list li {
    margin-bottom: 4px;
  }
  .manual-table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 9pt;
  }
  .manual-table th, .manual-table td {
    border: 1px solid #cbd5e1;
    padding: 6px 10px;
    text-align: left;
  }
  .manual-table th {
    background: #f8fafc;
    color: #0f172a;
    font-weight: 600;
  }

  kbd {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 8.5pt;
    font-family: monospace;
  }
</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>
`

const outDir = path.resolve('outputs')
const htmlPath = path.join(outDir, '软著用户使用说明书_15页.html')
fs.writeFileSync(htmlPath, html, 'utf-8')
console.log(`Generated HTML at: ${htmlPath}`)

async function exportPdf() {
  console.log('Rendering User Manual PDF with Playwright...')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'load' })
  const pdfPath = path.join(outDir, '软著用户使用说明书_15页.pdf')
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 }
  })
  await browser.close()
  console.log(`Generated User Manual PDF at: ${pdfPath}`)
}

exportPdf().catch(err => {
  console.error('PDF export failed:', err)
  process.exit(1)
})
