// 与链 ulink 宣传片 · 分镜时间轴与节拍网格（120 BPM，1 拍 = 0.5s，半拍 = 0.25s）
// 严格卡在半拍节拍网格上，专供视觉与动画状态机使用
globalThis.T = {
  bpm: 120,
  dur: 30,
  fps: 30,

  // ① 痛点：书签堆叠乱象 -> 点击切换浏览器 -> 瞬间跌落归零 (0.0s ~ 3.5s)
  chipWaves: [0.0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5],
  clickTabB: 2.0,
  chipsGone: 2.5,
  clickExt: 3.0,

  // ② 双端同频舞台引出：笔记本 + 手机 (3.5s ~ 7.0s)
  stageIn: 3.5,
  phoneIn: 3.75,
  restoreCards: 4.25,
  linkReady: 5.0,

  // ③ 添加即同步：添加 GitHub 书签 -> 跨端极速穿梭脉冲 (7.0s ~ 9.5s)
  curMoveAdd: 6.25,
  addClick: 7.0,
  addSyncArrive: 7.5,

  // ④ 镜头推进特写：卡片展开多层嵌套子站点与 TipTap 富文本笔记 (9.5s ~ 13.5s)
  camZoomDesk: 9.25,
  expandClick: 10.0,
  nestOpen: 10.75,
  notesOpen: 11.5,
  collapseClick: 12.75,

  // ⑤ 拖拽归组与打属性标签 (13.5s ~ 17.0s)
  dragStart: 13.5,
  dragHover: 14.25,
  dragDrop: 14.75,
  tagClick: 15.5,
  groupSync: 16.0,

  // ⑥ E2E 加密 -> 镜头秒切手机全屏特写 -> 指纹解锁还原 (17.0s ~ 22.0s)
  eyeClick: 17.0,
  lockClick: 17.75,
  lockSyncPulse: 18.0,
  camZoomMobile: 18.25, // 虚拟摄像机大推拉至手机特写 (Scale 2.75)
  fingerTouch: 19.5,    // 指纹按压触发同心圆进度环
  fingerUnlock: 20.0,   // 成功解锁，密码还原，绿色 Checkmark 弹出
  mobileHold: 21.25,

  // ⑦ 批量框选与一键收拢成组 (22.0s ~ 26.5s)
  camBackDesk: 21.75,   // 镜头拉回桌面网格 (Scale 1.32)
  mqStart: 22.25,
  sel1: 22.75,
  sel2: 23.25,
  sel3: 23.75,
  batchBarIn: 24.0,
  mergeClick: 24.75,
  mergeDone: 25.5,
  mergeSyncPulse: 26.0,

  // ⑧ 品牌优雅收尾 (26.5s ~ 30.0s)
  camWideEnd: 26.5,     // 镜头拉远至全景居中 (Scale 1.0)
  logoReveal: 27.25,
  taglineReveal: 28.0,
  urlReveal: 28.5
};
