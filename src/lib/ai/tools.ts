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
 * 8. export_data: 导出全量书签数据
 */

export interface AgentToolParamProperty {
  type: string
  description: string
  enum?: string[]
  items?: { type: string }
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
      description: '执行收件箱清零分析：扫描未分类书签（Inbox），基于历史域名与分类相似度进行智能聚类，生成一键归类建议卡片。',
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
      description: '根据主题装配专属工作台（笔记组 SiblingGroup），将推荐的候选书签批量存入并生成包含随文内嵌卡片的精美笔记。',
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
      description: '扫描全库重复书签（相同或等价 URL），保留最新或信息最完备的实例，一键清理冗余重复副本。',
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
      description: '死链自愈中枢：检查库中被标记为失效死链的书签，通过 Wayback Machine 历史快照或挖掘现役活跃平替方案进行修复。',
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
      description: '导出用户全量书签、笔记与分类数据备份。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
]
