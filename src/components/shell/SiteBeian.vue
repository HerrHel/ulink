<template>
  <!-- 首页底部备案号（合规：《非经营性互联网信息服务备案管理办法》第十三条——主页底部中央标明
       备案编号并链接工信部备案系统；公安联网备案号下发后同样在此展示并链接公安平台）。
       2026-11-25 起站点首页 / 就是应用，故挂在书签列表末尾、居中、滚到底可见，不占工作区。
       静态 HTML 兜底见 app.html #app 内的 footer（不执行 JS 的核查工具可读）。号为空不渲染。 -->
  <footer v-if="links.length" class="site-beian" data-testid="site-beian">
    <a v-for="b in links" :key="b.text" :href="b.href" target="_blank" rel="noopener noreferrer">{{ b.text }}</a>
  </footer>
</template>

<script setup lang="ts">
import { ICP_NUMBER, MPS_NUMBER, MIIT_URL, mpsQueryUrl } from '../../config/site.js'

const links: { text: string; href: string }[] = []
if (ICP_NUMBER) links.push({ text: ICP_NUMBER, href: MIIT_URL })
if (MPS_NUMBER) links.push({ text: MPS_NUMBER, href: mpsQueryUrl() })
</script>

<style scoped>
.site-beian {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 16px;
  padding: 24px 12px 8px;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}
.site-beian a {
  color: var(--text-muted);
  text-decoration: none;
  opacity: .75;
}
.site-beian a:hover {
  opacity: 1;
  text-decoration: underline;
}
</style>
