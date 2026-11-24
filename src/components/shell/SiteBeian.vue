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
/* 粘底页脚：#panelContent 是纵向 flex 容器（layout.css），margin-top:auto 吃掉剩余空间——
   书签不满一屏时固定在内容区底部，超过一屏时被列表顶到末尾。
   底部留白由本组件自己提供：layout.css 在本组件存在时把 .panel-content 的 80px
   padding-bottom 归零（批量底栏显示时恢复）。不用负 margin 抵消——负 margin 依赖
   自身高度精确计算，换屏宽/字体就会多出几像素空滚动。 */
.site-beian {
  margin-top: auto;
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 16px;
  padding: 20px 12px calc(14px + env(safe-area-inset-bottom, 0px));
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
