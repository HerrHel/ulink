// 与链 ulink 宣传片 · 共享时间轴（画面 promo.js 与配乐 audio.mjs 共用，保证声画同拍）
// 120 BPM → 1 拍 = 0.5s，半拍 = 0.25s；所有触发点都落在 0.25s 网格上
globalThis.T = {
  bpm: 120, dur: 30, fps: 30,
  // ① 痛点：书签堆满 → 换浏览器 → 全丢
  chipWaves: [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5],
  clickTabB: 2.0, chipsGone: 2.5, clickExt: 3.0,
  // ② 双端舞台
  phoneIn: 3.5, lapCards: 4.0, phoneRows: 4.5, link: 5.0,
  // ③ 添加即同步
  add: 7.0, addSync: 7.5,
  // ④ 展开：多层嵌套 + 富文本笔记
  expand: 9.0, nest: 10.0, notes: 11.0, collapse: 12.0,
  // ⑤ 拖拽归组 + 属性标签
  press: 13.5, hover: 14.0, drop: 14.5, reflow: 14.75, groupSync: 15.0, tag: 15.5,
  // ⑥ E2E 加密 → 另一端解锁
  eye: 17.0, lock: 18.0, lockSync: 18.5, tap: 19.5, unlocked: 20.0,
  // ⑦ 框选 → 一键收拢成组
  mqPress: 22.0, sel1: 22.5, sel2: 23.0, sel3: 23.5, bar: 24.0, merge: 25.0, mergeDone: 25.5, mergeSync: 26.0,
  // 收尾
  end: 27.0, logo: 27.5, tagline: 28.0, url: 28.5,
  steps: [5.0, 8.5, 12.5, 16.0, 21.0],
};
