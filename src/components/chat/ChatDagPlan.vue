<template>
  <div
    class="chat-dag-plan-card"
    :class="{
      'is-completed': card.completed,
      'is-executing': card.executing,
    }"
  >
    <!-- 头部信息 -->
    <div class="dag-header">
      <span class="dag-badge">{{ t('ai.dagPlanBadge') }}</span>
      <h4 class="dag-title">{{ card.title }}</h4>
    </div>

    <div v-if="card.desc" class="dag-desc">
      {{ card.desc }}
    </div>

    <!-- 总体进度条 -->
    <div v-if="plan" class="dag-progress-section">
      <div class="dag-progress-label">
        <span>{{ t('ai.dagPlanProgress', { completed: progress.completed, total: progress.total, percent: progress.percent }) }}</span>
      </div>
      <div class="dag-progress-track">
        <div class="dag-progress-fill" :style="{ width: `${progress.percent}%` }" />
      </div>
    </div>

    <!-- 步骤流水线节点列表 -->
    <div v-if="plan" class="dag-step-pipeline">
      <div
        v-for="(step, idx) in plan.steps"
        :key="step.id"
        class="dag-step-node"
        :class="{
          [`is-${step.status}`]: true,
          'is-last': idx === plan.steps.length - 1,
        }"
      >
        <!-- 连线轨道与状态指示灯 -->
        <div class="dag-node-rail">
          <div class="dag-node-icon" :title="step.status">
            <span v-if="step.status === 'success'">✓</span>
            <span v-else-if="step.status === 'running'" class="dag-spin">◐</span>
            <span v-else-if="step.status === 'failed'">✗</span>
            <span v-else>○</span>
          </div>
          <div v-if="idx < plan.steps.length - 1" class="dag-node-connector" />
        </div>

        <!-- 步骤详情与操作 -->
        <div class="dag-node-content">
          <div class="dag-node-head">
            <span class="dag-node-title">{{ step.title }}</span>
            <span class="dag-status-pill" :class="`pill-${step.status}`">
              {{ getStatusLabel(step.status) }}
            </span>
          </div>

          <div v-if="step.desc" class="dag-node-desc">
            {{ step.desc }}
          </div>

          <!-- 依赖指示 -->
          <div v-if="step.dependsOn?.length" class="dag-node-deps">
            <span class="dep-label">{{ t('ai.dagStepPending') }}:</span>
            <span v-for="dep in step.dependsOn" :key="dep" class="dep-chip">{{ dep }}</span>
          </div>

          <!-- 步骤输出反馈 -->
          <div v-if="step.output" class="dag-node-output">
            {{ step.output }}
          </div>

          <!-- 单步执行按钮 (就绪态可选单独触发) -->
          <div v-if="step.status === 'pending' && !card.executing && !card.completed" class="dag-node-action">
            <button
              type="button"
              class="dag-single-step-btn"
              @click="emit('executeStep', step.id)"
            >
              {{ t('ai.dagStepExecute') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部一键执行全部栏 -->
    <div class="dag-card-footer">
      <button
        v-if="!card.completed"
        type="button"
        class="dag-execute-all-btn"
        :disabled="card.executing"
        @click="emit('executeAll')"
      >
        <span v-if="card.executing" class="dag-spin">⏳</span>
        <span>{{ card.executing ? t('ai.dagPlanExecuting') : t('ai.dagPlanExecuteButton') }}</span>
      </button>
      <div v-else class="dag-completed-notice">
        <span>✓ {{ t('ai.dagPlanCompleted') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n/index.js'
import type { ChatActionCard } from '../../lib/ai/chatSessions.js'
import { calculatePlanProgress, type TaskDagPlan, type TaskStepStatus } from '../../lib/ai/taskPlanner.js'

const props = defineProps<{
  card: ChatActionCard
}>()

const emit = defineEmits<{
  executeAll: []
  executeStep: [stepId: string]
}>()

const { t } = useI18n()

const plan = computed<TaskDagPlan | null>(() => {
  return ((props.card.payload as any)?.plan as TaskDagPlan) || null
})

const progress = computed(() => {
  if (!plan.value) return { total: 0, completed: 0, failed: 0, running: 0, pending: 0, percent: 0 }
  return calculatePlanProgress(plan.value)
})

function getStatusLabel(status: TaskStepStatus): string {
  switch (status) {
    case 'success': return t('ai.dagStepSuccess')
    case 'running': return t('ai.dagStepRunning')
    case 'failed': return t('ai.dagStepFailed')
    default: return t('ai.dagStepPending')
  }
}
</script>

<style scoped>
.chat-dag-plan-card {
  margin-top: 12px;
  padding: 14px;
  border-radius: 10px;
  background: var(--bg-card, #ffffff);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: all 0.2s ease;
}

.dag-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dag-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(16, 185, 129, 0.08);
  color: #059669;
}

.dag-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.dag-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #64748b);
}

.dag-progress-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dag-progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary, #64748b);
}

.dag-progress-track {
  height: 4px;
  border-radius: 2px;
  background: var(--bg-subtle, rgba(0, 0, 0, 0.06));
  overflow: hidden;
}

.dag-progress-fill {
  height: 100%;
  background: var(--accent-color, #2563eb);
  transition: width 0.3s ease;
}

.dag-step-pipeline {
  display: flex;
  flex-direction: column;
}

.dag-step-node {
  display: flex;
  gap: 10px;
  position: relative;
}

.dag-node-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 20px;
  flex-shrink: 0;
}

.dag-node-icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  background: var(--bg-subtle, rgba(0, 0, 0, 0.06));
  color: var(--text-secondary, #94a3b8);
  z-index: 1;
}

.dag-step-node.is-success .dag-node-icon {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.dag-step-node.is-running .dag-node-icon {
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}

.dag-step-node.is-failed .dag-node-icon {
  background: rgba(225, 29, 72, 0.12);
  color: #e11d48;
}

.dag-node-connector {
  width: 2px;
  flex: 1;
  background: var(--border-color, rgba(0, 0, 0, 0.08));
  margin: 3px 0;
}

.dag-step-node.is-success .dag-node-connector {
  background: rgba(16, 185, 129, 0.3);
}

.dag-node-content {
  flex: 1;
  padding-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.dag-step-node.is-last .dag-node-content {
  padding-bottom: 4px;
}

.dag-node-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.dag-node-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary, #1e293b);
}

.dag-status-pill {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--bg-subtle, rgba(0, 0, 0, 0.04));
  color: var(--text-secondary, #94a3b8);
}

.dag-status-pill.pill-success {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
}
.dag-status-pill.pill-running {
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
}
.dag-status-pill.pill-failed {
  background: rgba(225, 29, 72, 0.1);
  color: #e11d48;
}

.dag-node-desc {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary, #64748b);
}

.dag-node-deps {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-secondary, #94a3b8);
}

.dep-chip {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--bg-subtle, rgba(0, 0, 0, 0.04));
}

.dag-node-output {
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--bg-subtle, rgba(0, 0, 0, 0.03));
  color: var(--text-secondary, #475569);
  white-space: pre-wrap;
}

.dag-single-step-btn {
  align-self: flex-start;
  margin-top: 2px;
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 4px;
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.1));
  background: var(--bg-card, #ffffff);
  color: var(--text-secondary, #475569);
  cursor: pointer;
}

.dag-single-step-btn:hover {
  background: var(--bg-hover, rgba(0, 0, 0, 0.04));
  color: var(--text-primary, #1e293b);
}

.dag-card-footer {
  margin-top: 4px;
}

.dag-execute-all-btn {
  width: 100%;
  padding: 8px 14px;
  border-radius: 6px;
  border: none;
  background: var(--accent-color, #2563eb);
  color: #ffffff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: opacity 0.15s ease;
}

.dag-execute-all-btn:hover:not(:disabled) {
  opacity: 0.92;
}

.dag-execute-all-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dag-completed-notice {
  text-align: center;
  font-size: 12px;
  font-weight: 500;
  color: #10b981;
  padding: 6px;
  background: rgba(16, 185, 129, 0.08);
  border-radius: 6px;
}

.dag-spin {
  display: inline-block;
  animation: dag-spin-kf 1s linear infinite;
}

@keyframes dag-spin-kf {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
