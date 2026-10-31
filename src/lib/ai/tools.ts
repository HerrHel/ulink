/**
 * tools.ts — ULink Agent 工业级标准 Function Calling / Tool Calling 规范体系
 *
 * 遵循 OpenAI Tool Calling 标准格式（type: 'function', function: { name, description, parameters }）
 * 支持的大模型自主调用：
 * 1. audit_vault: 全库资产健康体检与评分
 * 2. inbox_zero: 收件箱智能聚类与清零迁移
 * 3. create_workspace: 围绕特定主题装配专属笔记工作台并嵌入工具
 * 4. merge_duplicates: 重复书签智能合并去重
 * 5. heal_deadlinks: 检测死链并推荐/替换为可用平替
 * 6. toggle_theme: 切换系统主题（深色/浅色/自动）
 * 7. change_view: 切换界面布局视图（宫格/列表/紧凑）
 * 8. export_data: 导出全量书签数据（HITL 二次确认后执行）
 * 9. batch_tag_bookmarks: 批量为指定书签写入标签属性（闭环落地）
 * 10. manage_categories: 全能分类管理（创建/重命名/删除/恢复/外观）
 * 11. manage_tags: 全能标签属性管理（创建/重命名/删除/恢复）
 * 12. manage_bookmarks: 全能书签治理（增删改查/移动/父子嵌套/置顶）
 * 13. manage_workspaces: 全能工作台装配（创建/命名/笔记/增删成员）
 * 14. manage_settings: 系统偏好与界面导航（主题/排版/跳转/清空回收站）
 * 15. deep_read_video: 【实验性】视频深度解析（口播 ASR 转写 + 画面网址 OCR，异步任务；需浏览器扩展，B站正式/抖音小红书实验性）
 */

export interface AgentToolParamProperty {
  type: string
  description?: string
  enum?: string[]
  items?: {
    type: string
    description?: string
    properties?: Record<string, AgentToolParamProperty>
    required?: string[]
    items?: { type: string }
  }
}

export interface AgentToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, AgentToolParamProperty>
      required?: string[]
    }
  }
}

export const ULINK_AGENT_TOOLS: AgentToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'audit_vault',
      description: '对用户的书签资产全库进行健康体检，输出健康评分、重复项、未分类项、标签覆盖度与垃圾项统计，并提供体检行动建议卡片。仅在用户有明确全库体检诉求时调用。',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: '触发全库体检的具体用户诉求说明',
          },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inbox_zero',
      description: '执行收件箱清零分析：扫描未分类书签（Inbox），基于历史域名与分类相似度进行智能聚类，识别同站子页并归入其主页面下（建立子链接从属关系），生成一键归类建议卡片（应用归类与嵌套前需用户确认，可撤销）。仅在用户明确要求整理未分类或收件箱时调用。',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: '触发收件箱清零整理的具体用户诉求说明',
          },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_workspace',
      description: '根据主题规划专属工作台（笔记组 SiblingGroup）并生成装配卡片；实际创建笔记组与批量存入书签需用户点击卡片确认后执行（可撤销）。',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: '工作台主题名称，例如“UI设计工作台”、“Python极客开发”',
          },
          targetCategory: {
            type: 'string',
            description: '目标归属分类名称（尽量从用户现有分类中挑选）',
          },
        },
        required: ['topic'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'merge_duplicates',
      description: '扫描全库重复书签（相同或等价 URL），生成待用户确认的合并卡片；合并不会自动执行，需用户点击确认后才移入回收站（可撤销）。仅在用户明确要求查重/合并时调用。',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: '触发查重合并的具体用户诉求说明',
          },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'heal_deadlinks',
      description: '死链自愈中枢：针对用户书签库中已标记失效的书签，生成候选平替方案卡片；替换 URL/标题/备注前需用户确认，且操作可撤销。严禁在用户未明确要求自愈死链时擅自调用。',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: '欲处理的具体失效书签标题、URL 或 ID；若为全库扫描自愈则填 "all"',
          },
          reason: {
            type: 'string',
            description: '触发死链自愈的具体用户诉求说明（必须基于用户明确的操作指令）',
          },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'toggle_theme',
      description: '切换应用程序的主题外观模式。',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            description: '目标主题模式',
            enum: ['dark', 'light', 'auto'],
          },
        },
        required: ['mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_view',
      description: '切换书签列表展示视图布局。',
      parameters: {
        type: 'object',
        properties: {
          layout: {
            type: 'string',
            description: '布局形式',
            enum: ['grid', 'list', 'compact'],
          },
        },
        required: ['layout'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_data',
      description: '导出用户全量书签、笔记与分类数据备份（执行前会请求用户二次确认，用户拒绝则不导出）。仅在用户明确要求备份或导出时调用。',
      parameters: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            description: '导出格式，可选 json 或 html',
            enum: ['json', 'html'],
          },
          reason: {
            type: 'string',
            description: '触发数据导出的具体用户诉求说明',
          },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan_task_dag',
      description: '针对复杂或多步骤的知识治理需求，生成透明的执行规划图（Task DAG Plan），将任务拆解为具有依赖关系的步骤流（如扫描/聚类 -> 差异草稿 -> 批量归档 -> 总结验证）。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: '任务规划计划名称，例如“全库知识资产深度整理流水线”',
          },
          description: {
            type: 'string',
            description: '任务目标与执行意图简述',
          },
          steps: {
            type: 'array',
            description: '规划的步骤列表',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '步骤唯一ID，如 step_scan, step_diff' },
                title: { type: 'string', description: '步骤标题' },
                desc: { type: 'string', description: '步骤说明' },
                actionName: { type: 'string', description: '系统指令或工具名，如 audit_vault, inbox_zero, merge_duplicates, create_workspace' },
                actionArgs: { type: 'object', description: '操作参数' },
                dependsOn: { type: 'array', items: { type: 'string' }, description: '前置依赖的步骤ID列表' },
              },
            },
          },
        },
        required: ['title', 'steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_draft_diff',
      description: '在对知识库书签进行重组、移动、合并等批量操作前，生成可视化虚拟演练草稿层 (Draft Diff Sandbox)，供用户审查具体变更并勾选确认。',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: '演练草稿目标类型',
            enum: ['inbox', 'dedup'],
          },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_webpage',
      description: '抓取并阅读指定公开网址的真实正文 Markdown 内容与元数据（标题、描述、文章正文）。当用户提供了公开网址希望了解或总结内容、或对特定网站进行深度分析时调用。严禁读取私有/内网 IP 地址。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '待抓取阅读的完整公开网址（必须以 http:// 或 https:// 开头）',
          },
          reason: {
            type: 'string',
            description: '抓取该网页正文的具体分析诉求说明',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deep_read_video',
      description:
        '【实验性】视频深度解析（异步任务，分钟级）：下载音视频后做口播语音转写（ASR），并可识别只出现在视频画面里的网址（OCR）。只在用户明确要求「口播/语音转写」「画面里出现的网址」「没有字幕的讲解内容」时调用；普通视频先用常规视频解析（标题/简介/字幕/评论），不要主动调用本工具。需登录且消耗实验性深度解析体验额度（每日 2 次）。注意：需安装「与链」浏览器扩展（仅桌面端），B站正式支持，抖音/小红书实验性且不保证可用；失败或额度用完要如实告知，不得改用其他方式伪造结果。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: '视频平台链接（必须是 http:// 或 https:// 开头的完整网址）',
          },
          question: {
            type: 'string',
            description: '用户希望从口播/画面中回答的具体问题（可选，例如「视频里提到的网站有哪些」）',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_tag_bookmarks',
      description: '为用户书签库中的指定书签批量写入/应用标签属性。当用户确认标签建议方案或明确要求给书签打标签时调用。',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: '待打标签的书签列表',
            items: {
              type: 'object',
              description: '单个书签与其所推荐的标签集合',
              properties: {
                bookmarkId: { type: 'string', description: '书签唯一ID（若已知）' },
                url: { type: 'string', description: '书签URL（用于精准定位书签）' },
                title: { type: 'string', description: '书签标题（辅助定位）' },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '欲应用的标签名称列表，例如 ["工具", "设计"]',
                },
              },
              required: ['tags'],
            },
          },
          reason: {
            type: 'string',
            description: '执行批量打标的具体原因或方案说明',
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_categories',
      description: '全能分类管理：支持创建新分类、重命名分类、删除分类（移入回收站）、恢复分类、修改分类颜色或图标。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '欲执行的分类操作动作',
            enum: ['create', 'rename', 'delete', 'restore', 'update_color', 'update_icon'],
          },
          name: {
            type: 'string',
            description: '目标分类名称或欲创建的分类名称',
          },
          newName: {
            type: 'string',
            description: '重命名时的新分类名称',
          },
          categoryId: {
            type: 'string',
            description: '目标分类ID（若已知）',
          },
          color: {
            type: 'string',
            description: '分类主题色，如十六进制颜色 #122E8A',
          },
          icon: {
            type: 'string',
            description: '分类图标名称',
          },
          reason: {
            type: 'string',
            description: '执行该操作的原因或方案说明',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_tags',
      description: '全能标签与属性管理：支持新建标签属性、重命名标签、删除标签、恢复标签。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '欲执行的标签操作动作',
            enum: ['create', 'rename', 'delete', 'restore'],
          },
          name: {
            type: 'string',
            description: '标签名称或新建标签的名称',
          },
          newName: {
            type: 'string',
            description: '重命名时的新标签名',
          },
          tagId: {
            type: 'string',
            description: '标签ID（若已知）',
          },
          reason: {
            type: 'string',
            description: '操作原因或方案说明',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_bookmarks',
      description: '全能书签治理：支持添加新书签（包含从URL与标题新增）、更新书签资料（标题/URL/备注/图标/标签）、移动至目标分类、建立父子嵌套挂靠、解除父子嵌套为独立顶级书签、置顶/取消置顶、移入回收站、从回收站恢复。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '欲执行的书签操作动作',
            enum: ['add', 'update', 'move', 'delete', 'restore', 'set_parent', 'remove_parent', 'toggle_pin'],
          },
          target: {
            type: 'string',
            description: '欲操作的目标书签名称、网址或ID',
          },
          url: {
            type: 'string',
            description: '添加或更新时的完整网址（必须以 http:// 或 https:// 开头）',
          },
          title: {
            type: 'string',
            description: '添加或更新时的书签标题',
          },
          notes: {
            type: 'string',
            description: '书签备注或客观分析总结',
          },
          icon: {
            type: 'string',
            description: '书签图标 URL（可选）',
          },
          targetCategory: {
            type: 'string',
            description: '欲归属或移动至的目标分类名称',
          },
          targetParent: {
            type: 'string',
            description: '欲挂靠的父书签名称/网址/ID（用于同站子页面嵌套）',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '欲附加或更新的标签属性列表，例如 ["工具", "开源"]',
          },
          reason: {
            type: 'string',
            description: '操作原因说明',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_workspaces',
      description: '全能工作台/笔记组装配：支持围绕特定主题新建工作台（SiblingGroup）、重命名工作台、编辑富文本笔记、向工作台添加工具书签、移出工具书签、删除工作台（移入回收站）、从回收站恢复工作台。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '欲执行的工作台操作动作',
            enum: ['create', 'rename', 'delete', 'restore', 'add_bookmarks', 'remove_bookmarks', 'update_notes'],
          },
          name: {
            type: 'string',
            description: '工作台/笔记组名称',
          },
          newName: {
            type: 'string',
            description: '重命名后的新工作台名称',
          },
          workspaceId: {
            type: 'string',
            description: '工作台ID（若已知）',
          },
          notes: {
            type: 'string',
            description: '工作台内的笔记正文（支持纯文本或 Markdown 格式）',
          },
          targetCategory: {
            type: 'string',
            description: '工作台所属目标分类名称',
          },
          bookmarkQueries: {
            type: 'array',
            items: { type: 'string' },
            description: '欲加入或移除的书签名称/网址/ID列表',
          },
          reason: {
            type: 'string',
            description: '操作原因说明',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_settings',
      description: '全能偏好设置与界面导航调度：支持切换深浅主题外观、切换视图布局（宫格/列表/紧凑）、导航跳转至特定分类或工作台、展开回收站或设置面板、彻底清空回收站、导出全库备份。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: '欲执行的设置或导航动作',
            enum: ['toggle_theme', 'change_view', 'navigate', 'empty_trash', 'export_data'],
          },
          themeMode: {
            type: 'string',
            description: '目标主题模式',
            enum: ['dark', 'light', 'auto'],
          },
          viewLayout: {
            type: 'string',
            description: '目标视图排版布局',
            enum: ['grid', 'list', 'compact'],
          },
          navigateTarget: {
            type: 'string',
            description: '导航目标类型',
            enum: ['category', 'workspace', 'trash', 'settings'],
          },
          targetName: {
            type: 'string',
            description: '欲跳转的目标分类名或工作台名',
          },
          exportFormat: {
            type: 'string',
            description: '导出格式',
            enum: ['json', 'html'],
          },
          reason: {
            type: 'string',
            description: '操作原因说明',
          },
        },
        required: ['action'],
      },
    },
  },
]
