// 删除图片的"吸入"动画（Canvas 覆盖层）
// 忠实移植自 examples/ui/吸入动画 的核心引擎（真实图像 + 网格三角纹理映射 + 从一角向目标蔓延的形变）。
// 关键适配：
//   - 卡片坐标/尺寸 = 运行时图片的"删除前真实可见矩形"（按 object-contain 计算内容框，非元素外框、不写死像素）。
//   - 目标 = 被点删除按钮中心（运行时获取，不写死像素）。
//   - 纹理直接用已加载的 DOM <img> 同步生成，避免 new Image 重新加载带来的异步闪烁。
//   - 网格密度 cols 受 MAX_GRID(35) 约束；行数按图片宽高比推算（最终也 ≤ 35 量级）。
//   - 真实 DOM 删除按钮已存在，因此不绘制示例里的垃圾桶本体，仅保留吸入口漩涡 + 光锥 + 光晕氛围。

export interface SuctionTarget {
  x: number; // 视口坐标
  y: number;
}

export interface SuctionOptions {
  /** 被删图片的 DOM <img>（用于取"删除前"的 on-screen 矩形与图像内容）；拿不到时走兜底 */
  imgEl: HTMLImageElement | null;
  /** 吸入目标（删除按钮中心）视口坐标 */
  target: SuctionTarget;
  /** 网格列数（横向密度），将被约束到 ≤ MAX_GRID */
  gridCols?: number;
  /** 动画时长 ms */
  durationMs?: number;
  /** 完成回调（用于衔接删除提交流程） */
  onDone?: () => void;
}

const TEX_SCALE = 2; // 纹理分辨率 = 卡片显示尺寸 × 2（清晰且对视网膜屏友好）
const MAX_GRID = 20; // 需求约束：网格密度不超过 20
const FRONT = 0.45; // 形变前沿蔓延速度（与示例一致）
const TINY = 0.05; // 顶点收束到目标附近的比例
const FLAT = 0.55; // 纵向压扁

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function playSuction(opts: SuctionOptions): void {
  const { imgEl, target, gridCols = 18, durationMs = 1400, onDone } = opts;
  const cols = Math.max(3, Math.min(MAX_GRID, Math.round(gridCols)));
  const targetCenter = { x: target.x, y: target.y };

  if (!imgEl || !imgEl.isConnected) {
    onDone?.();
    return;
  }

  // 删除前图片的真实可见矩形：先取元素外框，再按 object-contain 还原出"实际照片内容框"，
  // 使 canvas 卡片精确等于删除前屏幕上看到的图片尺寸（含 letterbox 居中后的真实宽高）。
  const rect = imgEl.getBoundingClientRect();
  const iw = imgEl.naturalWidth || 0;
  const ih = imgEl.naturalHeight || 0;
  let cardX = rect.left;
  let cardY = rect.top;
  let cardW = rect.width;
  let cardH = rect.height;
  if (iw && ih && rect.width > 0 && rect.height > 0) {
    const fit = Math.min(rect.width / iw, rect.height / ih);
    cardW = iw * fit;
    cardH = ih * fit;
    cardX = rect.left + (rect.width - cardW) / 2;
    cardY = rect.top + (rect.height - cardH) / 2;
  }
  if (cardW < 1 || cardH < 1) {
    onDone?.();
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  // 画布只覆盖"卡片矩形 + 吸入目标点"的包围盒，而非整屏。
  // 全屏 canvas 在高分屏（如 4K@2dpr = 7680×4320）会同步分配上百 MB 的 backing store，
  // 并在 append 时触发整页 layout——这正是删除点击里那 ~78ms 长任务的主因。
  // 实际形变只发生在卡片内，整屏画布 99% 是空的，缩小后分配/每帧 clear 都快一个数量级。
  const PAD = 24; // 形变溢出到目标点方向的余量
  const minX = Math.floor(Math.min(cardX, targetCenter.x) - PAD);
  const minY = Math.floor(Math.min(cardY, targetCenter.y) - PAD);
  const maxX = Math.ceil(Math.max(cardX + cardW, targetCenter.x) + PAD);
  const maxY = Math.ceil(Math.max(cardY + cardH, targetCenter.y) + PAD);
  const boxW = Math.max(1, maxX - minX);
  const boxH = Math.max(1, maxY - minY);

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(boxW * dpr);
  canvas.height = Math.floor(boxH * dpr);
  canvas.style.position = "fixed";
  canvas.style.left = minX + "px";
  canvas.style.top = minY + "px";
  canvas.style.width = boxW + "px";
  canvas.style.height = boxH + "px";
  canvas.style.zIndex = "2147483646";
  canvas.style.pointerEvents = "none";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    onDone?.();
    return;
  }
  ctx.scale(dpr, dpr);
  // 把视口坐标平移到包围盒原点：后续所有绘制仍用视口坐标（card/target 等），无需改动
  ctx.translate(-minX, -minY);

  let raf = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (raf) cancelAnimationFrame(raf);
    canvas.remove();
    onDone?.();
  };

  // 直接用已加载的 DOM <img> 同步生成纹理（不重新 new Image 加载，避免异步闪烁）。
  const tex = document.createElement("canvas");
  tex.width = Math.max(1, Math.round(cardW * TEX_SCALE));
  tex.height = Math.max(1, Math.round(cardH * TEX_SCALE));
  const tctx = tex.getContext("2d");
  if (!tctx) {
    finish();
    return;
  }
  const tw = tex.width;
  const th = tex.height;
  const siw = iw || cardW;
  const sih = ih || cardH;
  const s = Math.max(tw / siw, th / sih); // cover 填充：保持原图比例、铺满整张卡片
  const dw = siw * s;
  const dh = sih * s;
  tctx.drawImage(imgEl, (tw - dw) / 2, (th - dh) / 2, dw, dh);

  const rows = Math.max(3, Math.min(MAX_GRID, Math.round(cols * (cardH / cardW))));

  // 卡片（on-screen 图片"删除前"真实可见矩形）
  const card = {
    x: cardX,
    y: cardY,
    w: cardW,
    h: cardH,
    cols,
    rows,
    center: { x: cardX + cardW / 2, y: cardY + cardH / 2 },
    vertices: [] as { x: number; y: number }[][],
    origVertices: [] as { x: number; y: number }[][],
    frontDist: [] as number[][],
    startCol: 0,
    startRow: 0,
    maxCornerDist: 1,
  };

  for (let r = 0; r <= rows; r++) {
    const vr: { x: number; y: number }[] = [];
    const or: { x: number; y: number }[] = [];
    for (let c = 0; c <= cols; c++) {
      vr.push({ x: card.x + (c / cols) * card.w, y: card.y + (r / rows) * card.h });
      or.push({ x: card.x + (c / cols) * card.w, y: card.y + (r / rows) * card.h });
    }
    card.vertices.push(vr);
    card.origVertices.push(or);
  }

  // 选离目标（删除按钮中心）最近的角为"起始吸入角"，并缓存每顶点前沿距离
  const pickStartCorner = () => {
    const corners: [number, number][] = [
      [0, 0],
      [cols, 0],
      [0, rows],
      [cols, rows],
    ];
    let best = corners[0];
    let bestD = Infinity;
    for (const [c, r] of corners) {
      const ox = card.x + (c / cols) * card.w;
      const oy = card.y + (r / rows) * card.h;
      const d = Math.hypot(ox - targetCenter.x, oy - targetCenter.y);
      if (d < bestD) {
        bestD = d;
        best = [c, r];
      }
    }
    card.startCol = best[0];
    card.startRow = best[1];
    card.maxCornerDist = Math.hypot(cols, rows);
    for (let r = 0; r <= rows; r++) {
      if (!card.frontDist[r]) card.frontDist[r] = [];
      for (let c = 0; c <= cols; c++) {
        card.frontDist[r][c] = Math.min(1, Math.hypot(c - card.startCol, r - card.startRow) / card.maxCornerDist);
      }
    }
  };
  pickStartCorner();

  // 核心形变（版本2）：点击后所有顶点同时启动飞向目标；按到起始角的距离给不同速度——
  // 近处（靠近删除按钮）更快到达，远处更慢，仍保留"排队到达"观感，但无"等波前"的静止等待。
  const updateVertices = (progress: number) => {
    const tx = targetCenter.x;
    const ty = targetCenter.y;
    const TC = card.center;
    const SPEED_K = 2.4; // 版本2：近处块的加速倍率（越大，排队到达感越强）
    for (let r = 0; r <= rows; r++) {
      const fdRow = card.frontDist[r];
      const vRow = card.vertices[r];
      const oRow = card.origVertices[r];
      for (let c = 0; c <= cols; c++) {
        const o = oRow[c];
        const d = fdRow[c]; // 0=起始角(近) 1=对角(远)
        const speed = 1 + (1 - d) * (SPEED_K - 1); // 近处快、远处慢，均于 progress=1 前到达
        let lp = progress * speed;
        lp = lp < 0 ? 0 : lp > 1 ? 1 : lp;
        lp = easeInOut(lp);
        const nx = tx + (o.x - TC.x) * TINY;
        const ny = ty + (o.y - TC.y) * TINY * FLAT;
        const v = vRow[c];
        v.x = o.x + (nx - o.x) * lp;
        v.y = o.y + (ny - o.y) * lp;
      }
    }
  };

  // 三角纹理映射：用仿射矩阵把纹理三角形贴合到目标三角形，PAD 外扩防接缝
  const drawTexTri = (
    sx0: number, sy0: number, sx1: number, sy1: number, sx2: number, sy2: number,
    dx0: number, dy0: number, dx1: number, dy1: number, dx2: number, dy2: number,
  ) => {
    const denom = (sx1 - sx0) * (sy2 - sy0) - (sy1 - sy0) * (sx2 - sx0) || 1e-6;
    const m11 = ((dx1 - dx0) * (sy2 - sy0) - (dx2 - dx0) * (sy1 - sy0)) / denom;
    const m12 = ((dx2 - dx0) * (sx1 - sx0) - (dx1 - dx0) * (sx2 - sx0)) / denom;
    const m21 = ((dy1 - dy0) * (sy2 - sy0) - (dy2 - dy0) * (sy1 - sy0)) / denom;
    const m22 = ((dy2 - dy0) * (sx1 - sx0) - (dy1 - dy0) * (sx2 - sx0)) / denom;
    const mtx = dx0 - (m11 * sx0 + m12 * sy0);
    const mty = dy0 - (m21 * sx0 + m22 * sy0);

    const PAD = 1.5;
    const cx = (dx0 + dx1 + dx2) / 3;
    const cy = (dy0 + dy1 + dy2) / 3;
    const expand = (vx: number, vy: number) => {
      const ex = vx - cx;
      const ey = vy - cy;
      const l = Math.hypot(ex, ey) || 1;
      return [vx + (ex / l) * PAD, vy + (ey / l) * PAD];
    };
    const a = expand(dx0, dy0);
    const b = expand(dx1, dy1);
    const c = expand(dx2, dy2);

    const ssx = Math.max(0, Math.min(sx0, sx1, sx2) - 1);
    const ssy = Math.max(0, Math.min(sy0, sy1, sy2) - 1);
    const ssw = Math.min(tw, Math.max(sx0, sx1, sx2) + 1) - ssx;
    const ssh = Math.min(th, Math.max(sy0, sy1, sy2) + 1) - ssy;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.closePath();
    ctx.clip();
    // 用 transform（累乘）而非 setTransform（替换）：保留外层 scale(dpr) 与 translate(-minX,-minY)，
    // 使纹理三角形映射到"包围盒画布"内的正确设备坐标（同时修正 dpr>1 时原 setTransform 丢失缩放的隐患）
    ctx.transform(m11, m21, m12, m22, mtx, mty);
    ctx.drawImage(tex, ssx, ssy, ssw, ssh, ssx, ssy, ssw, ssh);
    ctx.restore();
  };

  const drawCardMesh = (progress: number) => {
    const { vertices } = card;
    const k = Math.pow(1 - progress, 1.6) * 0.95 + 0.05;
    const dark = 1 - (0.55 + 0.45 * k);

    // 裁剪到卡片多边形，防外扩三角溢出
    const clipPath = () => {
      ctx.beginPath();
      ctx.moveTo(vertices[0][0].x, vertices[0][0].y);
      for (let c = 1; c <= cols; c++) ctx.lineTo(vertices[0][c].x, vertices[0][c].y);
      for (let r = 1; r <= rows; r++) ctx.lineTo(vertices[r][cols].x, vertices[r][cols].y);
      for (let c = cols - 1; c >= 0; c--) ctx.lineTo(vertices[rows][c].x, vertices[rows][c].y);
      for (let r = rows - 1; r >= 0; r--) ctx.lineTo(vertices[r][0].x, vertices[r][0].y);
      ctx.closePath();
    };
    ctx.save();
    clipPath();
    ctx.clip();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const d0 = vertices[r][c];
        const d1 = vertices[r][c + 1];
        const d2 = vertices[r + 1][c + 1];
        const d3 = vertices[r + 1][c];
        const s0x = (c / cols) * tw;
        const s0y = (r / rows) * th;
        const s1x = ((c + 1) / cols) * tw;
        const s1y = s0y;
        const s2x = s1x;
        const s2y = ((r + 1) / rows) * th;
        const s3x = s0x;
        const s3y = s2y;
        drawTexTri(s0x, s0y, s1x, s1y, s2x, s2y, d0.x, d0.y, d1.x, d1.y, d2.x, d2.y);
        drawTexTri(s0x, s0y, s2x, s2y, s3x, s3y, d0.x, d0.y, d2.x, d2.y, d3.x, d3.y);
      }
    }
    ctx.restore();

    if (dark > 0.01) {
      ctx.save();
      clipPath();
      ctx.fillStyle = `rgba(0,0,0,${dark})`;
      ctx.fill();
      ctx.restore();
    }
  };

  // 吸入口：已移除螺旋漩涡、光晕与光锥，仅保留图片被吸入的形变
  const drawMouth = (_progress: number) => {};

  const start = performance.now();
  const loop = (now: number) => {
    const progress = Math.min(1, (now - start) / durationMs);
    ctx.clearRect(minX, minY, boxW, boxH);
    updateVertices(progress);
    drawCardMesh(progress);
    drawMouth(progress);
    if (progress < 1) raf = requestAnimationFrame(loop);
    else finish();
  };
  raf = requestAnimationFrame(loop);
}
