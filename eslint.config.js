import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import vue from 'eslint-plugin-vue'

// ── F2-004：flat config 全面改造，统一 .ts/.js/.vue 规则分层 ──
// 分层：
//   A ts/js 基础规则（沿用原 eslint.config.js 全部规则，迁移为 flat 多块）
//   B vue/base     — flat/base 注册 vue-eslint-parser + vue 插件（.vue 模板解析）
//   C vue/recommended — flat/recommended 规则集（推荐主轴）
//   D 高价值规则钉 error — 防遗漏类显式 error 级
//   E 噪音规则 off — 单字组件名、纯格式类（无 Prettier 故保守 off）
//
// .vue 的 <script lang="ts"> 需把 script 块交给 @typescript-eslint/parser：
// plugin-vue 的 flat 配置未设 parserOptions.parser，故手写 .vue 块补上。
// 顺序：vue flat 配置在前（铺 parser + 规则），ts/js 块与 .vue script 块在后覆盖。

export default [
  ...vue.configs['flat/base'],        // B: 注册 vue-eslint-parser + vue 插件
  ...vue.configs['flat/recommended'], // C: recommended 规则集

  // A：ts/js 文件（保留原配置全部规则）
  {
    files: ['src/**/*.{js,ts}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        history: 'readonly', location: 'readonly', localStorage: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        crypto: 'readonly', atob: 'readonly', btoa: 'readonly',
        Image: 'readonly', URL: 'readonly', HTMLElement: 'readonly',
        DOMParser: 'readonly', IntersectionObserver: 'readonly',
        MutationObserver: 'readonly', getComputedStyle: 'readonly',
        fetch: 'readonly', alert: 'readonly', confirm: 'readonly',
        prompt: 'readonly', console: 'readonly', Node: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly',
        FileReader: 'readonly', Blob: 'readonly', File: 'readonly',
        DataTransfer: 'readonly', ClipboardEvent: 'readonly',
        InputEvent: 'readonly', PointerEvent: 'readonly',
        Event: 'readonly', CustomEvent: 'readonly', KeyboardEvent: 'readonly',
        Selection: 'readonly', ResizeObserver: 'readonly',
        performance: 'readonly',
        Worker: 'readonly', self: 'readonly', require: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-undef': 'off', // TypeScript handles this
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-constant-condition': 'warn',
      'no-debugger': 'warn',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-empty': 'warn',
      'no-redeclare': 'error',
      'no-unreachable': 'warn',
      'eqeqeq': ['warn', 'smart'],
      'no-caller': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },

  // .vue 的 <script lang="ts">：vue-eslint-parser 解析模板，
  // script 块交 @typescript-eslint/parser 做类型语法 lint
  {
    files: ['src/**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-undef': 'off', // script 是 TS，交给 @typescript-eslint/no-undef 语义
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },

  // D：高价值规则显式钉 error（防遗漏，即使 recommended 已含也固化级别）
  {
    rules: {
      'vue/require-v-for-key': 'error',
      'vue/no-template-key': 'error',
      'vue/no-unused-components': 'error',
      'vue/no-unused-vars': 'error',
      'vue/no-mutating-props': 'error',
      'vue/no-arrow-functions-in-watch': 'error',
      'vue/no-side-effects-in-computed-properties': 'error',
    },
  },

  // E：噪音规则 off
  {
    rules: {
      'vue/multi-word-component-names': 'off', // 本项目 App.vue 等单文件组件
      // 纯格式类：本项目无 Prettier，格式类保守 off，避免与手写风格冲突的噪音
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-closing-bracket-spacing': 'off',
      'vue/attributes-order': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/attribute-hyphenation': 'off',
      // 本项目 v-html 全部经 DOMPurify 白名单清洗（ShareView/GroupCard v3 已审计），
      // 规则无差别报全量 XSS 噪音，禁用但保留上面的清洗约束。
      'vue/no-v-html': 'off',
      // <script setup> + withDefaults 场景：规则对 setup 宏的默认值识别不完整，
      // 对 optional prop 一律要求 default 与实际 withDefaults 写法摩擦，关闭。
      'vue/require-default-prop': 'off',
    },
  },
]
