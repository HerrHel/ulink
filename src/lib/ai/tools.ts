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
      description: '对用户的书签资产全库进行健康体检，输出健康评分、重复项、未分类项、标签覆盖度与垃圾项统计，并提供体检行动建议卡片。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inbox_zero',
      description: '执行收件箱清零分析：扫描未分类书签（Inbox），基于历史域名与分类相似度进行智能聚类，识别同站子页并归入其主页面下（建立子链接从属关系），生成一键归类建议卡片（应用归类与嵌套前需用户确认，可撤销）。',
      parameters: {
        type: 'object',
        properties: {},
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
      description: '扫描全库重复书签（相同或等价 URL），生成待用户确认的合并卡片；合并不会自动执行，需用户点击确认后才移入回收站（可撤销）。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'heal_deadlinks',
      description: '死链自愈中枢：针对已标记失效的书签，生成候选平替方案卡片；替换 URL/标题/备注前需用户确认，且操作可撤销。',
      parameters: {
        type: 'object',
        properties: {},
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
      description: '导出用户全量书签、笔记与分类数据备份（执行前会请求用户二次确认，用户拒绝则不导出）。',
      parameters: {
        type: 'object',
        properties: {},
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
]
