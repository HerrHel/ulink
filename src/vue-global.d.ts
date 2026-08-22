/**
 * vue 全局属性类型扩展。
 *
 * ⚠️ 必须独立成「模块文件」（末尾 export {}），否则全局作用域下
 * `declare module 'vue'` 会声明一个全新环境模块、遮蔽真实 vue 类型包
 * （症状：stores 里 `import { ref } from 'vue'` 报 no exported member）。
 */
export {}

declare module 'vue' {
  interface ComponentCustomProperties {
    /** 全局翻译函数（模板可用 $t('a.b', {n})；<script setup> 推荐直接 import { t }） */
    $t: (key: string, params?: Record<string, string | number>) => string
    /** 全局复数翻译函数 */
    $tN: (key: string, count: number, params?: Record<string, string | number>) => string
  }
}
