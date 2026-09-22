// 删除图片的"吸入"动画（Canvas 覆盖层）
// 忠实移植自 examples/ui/吸入动画 的核心引擎（真实图像 + 网格纹理映射 + 从一角向目标蔓延的形变）。
// 关键适配：
//   - 卡片坐标/尺寸 = 运行时图片的"删除前真实可见矩形"（按 object-contain 计算内容框，非元素外框、不写死像素）。
//   - 目标 = 被点删除按钮中心（运行时获取，不写死像素）。
//   - 纹理直接用已加载的 DOM <img> 同步生成，避免 new Image 重新加载带来的异步闪烁。
//   - 网格密度 cols 受 MAX_GRID(20) 约束；行数按图片宽高比推算（最终也 ≤ 20 量级）。
//   - 真实 DOM 删除按钮已存在，因此不绘制示例里的垃圾桶本体，仅保留图片被吸入的形变。
// 渲染：优先 WebGL（GPU 一次 drawArrays 完成网格纹理映射 + 变暗），WebGL 不可用时回退 Canvas2D 逐三角贴图。
//   两渲染器读取同一份形变顶点、同一张纹理，输出逐像素一致；形变算法为“版本六：波前吸入 + 整卡退槽刚体变换同时”。

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
  /** （可选）卡片"框定区域"（视口坐标）。被删图若已被缩放/拖拽到超出滑片边界，
   *  其 getBoundingClientRect 会超出实际可见区；传入可见区后，形变卡片被 clamp 到其内，
   *  删除动画不再突破拖拽框定的边界。 */
  crop?: { x: number; y: number; w: number; h: number };
  /** 完成回调（用于衔接删除提交流程） */
  onDone?: () => void;
  /** （可选）吸入层挂载容器（需为定位祖先且为层叠上下文，如 containerRef）。
   *  传入时 canvas 以 position:absolute 挂进容器、坐标由视口换算为容器内、z-index:-1
   *  → 落在容器背景之上、卡片之下（新入图不被遮挡）。不传则保持挂 body + fixed + 最大 z（原行为）。 */
  container?: HTMLElement;
}

const TEX_SCALE = 2; // 纹理分辨率 = 卡片显示尺寸 × 2（但受 MAX_TEX_EDGE 上限约束）
// ===== 性能护栏（75Hz/高刷屏下保吸入满帧：削 GPU 每帧合成与首帧上传成本，0.4s 形变观感无损）=====
const MAX_DPR = 1.5; // 吸入 canvas backing store 的 dpr 上限（形变动画无需满 dpr；backing 面积随 dpr² 降）
const MAX_TEX_EDGE = 1600; // 吸入纹理长边像素上限（texImage2D 上传量封顶；小图仍保留 2×，大图自动降倍率）
const MAX_GRID = 20; // 需求约束：网格密度不超过 20
const FRONT = 0.45; // 版本1：形变前沿蔓延速度（远处顶点需等波前到达才开始动）
const TINY = 0.05; // 顶点收束到目标附近的比例
const FLAT = 0.55; // 纵向压扁
// ===== 版本六“退槽”刚体变换（移植自 examples suction-core.js _v6Motion）=====
// 在版本一波前吸入的同时，对整卡叠加：缩小到 (1-SHRINK·e) + 沿“卡片中心→删除按钮”位移 DIST·e，
// e = 退槽曲线 bezierEase(progress)，无旋转。
const RETRACT_CURVE = [0.33, 1, 0.68, 1]; // 退槽曲线 cubic-bezier（默认 easeOutCubic）
const RETRACT_SHRINK = 0.38; // 缩小到原图的 62%
const RETRACT_DIST_RATIO = 0.12; // 朝删除按钮位移距离 = 卡片短边 × 该比例

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// cubic-bezier 缓动求值（退槽曲线）：二分解 Bx(u)=x 取 By(u)；y 可越界（过冲/回拉）。移植自 examples。
function bezierEase(x: number, c: number[]): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bx = (u: number) => 3 * u * (1 - u) * (1 - u) * c[0] + 3 * u * u * (1 - u) * c[2] + u * u * u;
  const by = (u: number) => 3 * u * (1 - u) * (1 - u) * c[1] + 3 * u * u * (1 - u) * c[3] + u * u * u;
  let lo = 0, hi = 1, u = 0.5;
  for (let i = 0; i < 24; i++) { u = (lo + hi) * 0.5; if (bx(u) < x) lo = u; else hi = u; }
  return by((lo + hi) * 0.5);
}

type Vert = { x: number; y: number };

// ===== WebGL 吸入网格渲染器 =====
// 顶点位置（视口坐标→裁剪坐标）每帧从形变后的 card.vertices 重建；uv 为静态（仅由网格决定）。
// 一次 drawArrays 画完 cols×rows×2 三角形，纹理仿射映射与 Canvas2D 逐三角贴图逐像素等价。
// 变暗（进入瓶中越深越暗）在 fragment 里对不透明图做 rgb×(1-dark) 乘法，等效旧"叠加半透明黑"。
function createSuctionGL(
  gl: WebGLRenderingContext,
  texCanvas: HTMLCanvasElement,
  boxW: number,
  boxH: number,
  cols: number,
  rows: number,
  minX: number,
  minY: number,
): ((vertices: Vert[][], dark: number) => void) | null {
  const vsSrc =
    "attribute vec2 aPos; attribute vec2 aUV; varying vec2 vUV;" +
    "void main(){ vUV=aUV; gl_Position=vec4(aPos,0.0,1.0); }";
  const fsSrc =
    "precision mediump float; varying vec2 vUV; uniform sampler2D uTex; uniform float uDark;" +
    "void main(){ vec4 c=texture2D(uTex,vUV); gl_FragColor=vec4(c.rgb*(1.0-uDark)*c.a, c.a); }";
  const compile = (type: number, src: string): WebGLShader | null => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const aPos = gl.getAttribLocation(prog, "aPos");
  const aUV = gl.getAttribLocation(prog, "aUV");
  const uTexLoc = gl.getUniformLocation(prog, "uTex");
  const uDarkLoc = gl.getUniformLocation(prog, "uDark");

  const nv = cols * rows * 2 * 3;
  // 静态 uv（每三角形 3 顶点，格点 uv = 列/行占比）
  const uv = new Float32Array(nv * 2);
  let ui = 0;
  for (let r = 0; r < rows; r++) {
    const v0 = r / rows, v1 = (r + 1) / rows;
    for (let c = 0; c < cols; c++) {
      const u0 = c / cols, u1 = (c + 1) / cols;
      // T1=(d0,d1,d2)=(u0,v0)(u1,v0)(u1,v1)
      uv[ui++] = u0; uv[ui++] = v0;
      uv[ui++] = u1; uv[ui++] = v0;
      uv[ui++] = u1; uv[ui++] = v1;
      // T2=(d0,d2,d3)=(u0,v0)(u1,v1)(u0,v1)
      uv[ui++] = u0; uv[ui++] = v0;
      uv[ui++] = u1; uv[ui++] = v1;
      uv[ui++] = u0; uv[ui++] = v1;
    }
  }
  const pos = new Float32Array(nv * 2); // 每帧重建

  const posBuf = gl.createBuffer();
  const uvBuf = gl.createBuffer();
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texCanvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
  gl.clearColor(0, 0, 0, 0);
  gl.uniform1i(uTexLoc, 0);

  return (vertices: Vert[][], dark: number) => {
    // 视口坐标 → 包围盒裁剪坐标（canvas 覆盖 [minX,minY] 起 boxW×boxH）
    let pi = 0;
    for (let r = 0; r < rows; r++) {
      const vr = vertices[r], vr1 = vertices[r + 1];
      for (let c = 0; c < cols; c++) {
        const d0 = vr[c], d1 = vr[c + 1], d2 = vr1[c + 1], d3 = vr1[c];
        // T1 = (d0, d1, d2)
        pos[pi++] = (d0.x - minX) / boxW * 2 - 1; pos[pi++] = 1 - (d0.y - minY) / boxH * 2;
        pos[pi++] = (d1.x - minX) / boxW * 2 - 1; pos[pi++] = 1 - (d1.y - minY) / boxH * 2;
        pos[pi++] = (d2.x - minX) / boxW * 2 - 1; pos[pi++] = 1 - (d2.y - minY) / boxH * 2;
        // T2 = (d0, d2, d3)
        pos[pi++] = (d0.x - minX) / boxW * 2 - 1; pos[pi++] = 1 - (d0.y - minY) / boxH * 2;
        pos[pi++] = (d2.x - minX) / boxW * 2 - 1; pos[pi++] = 1 - (d2.y - minY) / boxH * 2;
        pos[pi++] = (d3.x - minX) / boxW * 2 - 1; pos[pi++] = 1 - (d3.y - minY) / boxH * 2;
      }
    }
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(uDarkLoc, dark);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.drawArrays(gl.TRIANGLES, 0, nv);
  };
}

export function playSuction(opts: SuctionOptions): void {
  const { imgEl, target, gridCols = 18, durationMs = 1400, crop, onDone, container } = opts;
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
  // 图片在卡片框内的完整矩形（object-cover 后的真实可见图框），作为裁切映射的基准帧
  const frameX0 = cardX;
  const frameY0 = cardY;
  const frameW = cardW;
  const frameH = cardH;
  // 超出"拖拽/可见区域(crop)"的部分：直接裁掉，只用区域内的子图吸入（裁切，不压缩）。
  // cropOffX/Y = 可见子区相对整帧的左上偏移，用于反算原图源矩形。
  let cropOffX = 0;
  let cropOffY = 0;
  if (crop) {
    const cx0 = crop.x, cy0 = crop.y, cx1 = crop.x + crop.w, cy1 = crop.y + crop.h;
    const ic0x = Math.max(cardX, cx0), ic0y = Math.max(cardY, cy0);
    const ic1x = Math.min(cardX + cardW, cx1), ic1y = Math.min(cardY + cardH, cy1);
    if (ic1x - ic0x < 1 || ic1y - ic0y < 1) {
      // 被删图完全在可见区外：无可见内容可形变，直接结束（走后续删除流程）
      onDone?.();
      return;
    }
    cardX = ic0x; cardY = ic0y; cardW = ic1x - ic0x; cardH = ic1y - ic0y;
    cropOffX = cardX - frameX0;
    cropOffY = cardY - frameY0;
    targetCenter.x = Math.max(cx0, Math.min(cx1, targetCenter.x));
    targetCenter.y = Math.max(cy0, Math.min(cy1, targetCenter.y));
  }

  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  // 画布只覆盖"卡片矩形 + 吸入目标点"的包围盒，而非整屏。
  // 全屏 canvas 在高分屏（如 4K@2dpr = 7680×4320）会同步分配上百 MB 的 backing store，
  // 并在 append 时触发整页 layout——这正是删除点击里那 ~78ms 长任务的主因。
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
  // 内部绘制坐标始终基于视口（通过 translate(-minX,-minY)/包围盒裁剪）。
  // 定位：有 container → absolute 挂容器，元素左上 = 视口(minX,minY) 换算为容器内 (minX-cLeft,minY-cTop)，
  //        z-index:-1（容器已为层叠上下文 → 落在容器背景之上、卡片之下，新入图盖住吸入不被遮挡）；
  //        无 container → fixed 挂 body（原行为，最大 z）。
  if (container) {
    const cRect = container.getBoundingClientRect();
    canvas.style.position = "absolute";
    canvas.style.left = minX - cRect.left + "px";
    canvas.style.top = minY - cRect.top + "px";
    canvas.style.zIndex = "-1";
  } else {
    canvas.style.position = "fixed";
    canvas.style.left = minX + "px";
    canvas.style.top = minY + "px";
    canvas.style.zIndex = "2147483646";
  }
  canvas.style.width = boxW + "px";
  canvas.style.height = boxH + "px";
  canvas.style.pointerEvents = "none";
  (container ?? document.body).appendChild(canvas);

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
  // 纹理倍率：小卡片保留 TEX_SCALE(2×)，大卡片(全屏)按长边封顶 MAX_TEX_EDGE 自动降倍率，
  // 避免数千像素见方的超大纹理上传造成 GPU 首帧尖峰。GL 的 uv 为归一化(0~1)、2D 回退按 tw/th 取值，降尺寸对两渲染器均安全。
  const texScale = Math.min(TEX_SCALE, MAX_TEX_EDGE / Math.max(cardW, cardH));
  tex.width = Math.max(1, Math.round(cardW * texScale));
  tex.height = Math.max(1, Math.round(cardH * texScale));
  const tctx = tex.getContext("2d");
  if (!tctx) {
    finish();
    return;
  }
  const tw = tex.width;
  const th = tex.height;
  if (iw && ih) {
    // 裁切（非压缩）：按整帧 object-cover 映射，取"可见子区"对应原图的源矩形，只把仍可见的那部分画进纹理。
    // → 保持图片比例（裁掉界外，不重填缩放）；纹理尺寸=可见区（更小，降首帧上传）。
    const coverF = Math.max(frameW / iw, frameH / ih);
    const imgDX = (frameW - iw * coverF) / 2; // cover 下 ≤0
    const imgDY = (frameH - ih * coverF) / 2;
    let sxs = (cropOffX - imgDX) / coverF;
    let sys = (cropOffY - imgDY) / coverF;
    sxs = Math.max(0, Math.min(iw, sxs));
    sys = Math.max(0, Math.min(ih, sys));
    const swd = Math.max(1, Math.min(iw - sxs, cardW / coverF));
    const shd = Math.max(1, Math.min(ih - sys, cardH / coverF));
    tctx.drawImage(imgEl, sxs, sys, swd, shd, 0, 0, tw, th);
  } else {
    // 无自然尺寸（异常）：回退整图 cover 填充
    const cover = Math.max(tw / cardW, th / cardH);
    const dw = cardW * cover;
    const dh = cardH * cover;
    tctx.drawImage(imgEl, (tw - dw) / 2, (th - dh) / 2, dw, dh);
  }

  // 污染检测：跨域且未带 CORS 许可的图片被 drawImage 进纹理 canvas 后，canvas 即被"污染"(tainted)。
  // WebGL 的 texImage2D 需要从 canvas 读取像素，对污染 canvas 会直接抛 SecurityError；
  // Canvas2D 回退渲染只做"绘制"（drawImage 不读回像素），不受污染限制。
  // 用 1 像素 getImageData 探测（污染时抛 SecurityError），污染则强制走 Canvas2D，保证删除动画不中断。
  let texTainted = false;
  try {
    tctx.getImageData(0, 0, 1, 1);
  } catch {
    texTainted = true;
  }

  const rows = Math.max(3, Math.min(MAX_GRID, Math.round(cols * (cardH / cardW))));

  // 卡片（on-screen 图片"删除前"真实可见矩形）
  const card = {
    x: cardX, y: cardY, w: cardW, h: cardH, cols, rows,
    center: { x: cardX + cardW / 2, y: cardY + cardH / 2 },
    vertices: [] as Vert[][],
    origVertices: [] as Vert[][],
    frontDist: [] as number[][],
    startCol: 0,
    startRow: 0,
    maxCornerDist: 1,
  };

  for (let r = 0; r <= rows; r++) {
    const vr: Vert[] = [];
    const or: Vert[] = [];
    for (let c = 0; c <= cols; c++) {
      vr.push({ x: card.x + (c / cols) * card.w, y: card.y + (r / rows) * card.h });
      or.push({ x: card.x + (c / cols) * card.w, y: card.y + (r / rows) * card.h });
    }
    card.vertices.push(vr);
    card.origVertices.push(or);
  }

  // 选离目标（删除按钮中心）最近的角为"起始吸入角"，并缓存每顶点前沿距离
  const pickStartCorner = () => {
    const corners: [number, number][] = [[0, 0], [cols, 0], [0, rows], [cols, rows]];
    let best = corners[0];
    let bestD = Infinity;
    for (const [c, r] of corners) {
      const ox = card.x + (c / cols) * card.w;
      const oy = card.y + (r / rows) * card.h;
      const d = Math.hypot(ox - targetCenter.x, oy - targetCenter.y);
      if (d < bestD) { bestD = d; best = [c, r]; }
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

  // 核心形变（版本六：波前吸入 + 整卡“退槽”刚体变换同时播放）。
  // 每帧先对整卡施加 缩小到(1-SHRINK·e) + 朝删除按钮位移 DIST·e（e=退槽曲线 bezierEase(progress)），
  // 再在此“退槽后”的刚体位置上，按版本一波前公式把各顶点收拢到删除按钮口。
  const retractDist = Math.min(card.w, card.h) * RETRACT_DIST_RATIO;
  const updateVertices = (progress: number) => {
    const tx = targetCenter.x;
    const ty = targetCenter.y;
    const TC = card.center;
    // 退槽刚体量（方向：卡片中心 → 删除按钮）
    const e = bezierEase(progress, RETRACT_CURVE);
    let ux = tx - TC.x;
    let uy = ty - TC.y;
    const D = Math.hypot(ux, uy) || 1;
    ux /= D;
    uy /= D;
    const rox = ux * retractDist * e;
    const roy = uy * retractDist * e;
    const rs = 1 - RETRACT_SHRINK * e;
    for (let r = 0; r <= rows; r++) {
      const fdRow = card.frontDist[r];
      const vRow = card.vertices[r];
      const oRow = card.origVertices[r];
      for (let c = 0; c <= cols; c++) {
        const o = oRow[c];
        const d = fdRow[c]; // 0=起始角(近) 1=对角(远)
        let lp = (progress - d * (1 - FRONT)) / FRONT; // 波前扫过：远处需等波前到达
        lp = lp < 0 ? 0 : lp > 1 ? 1 : lp;
        lp = easeInOut(lp);
        const rx = o.x - TC.x;
        const ry = o.y - TC.y;
        // 退槽后的刚体位置（整卡缩小+朝钮位移）
        const mx = TC.x + rx * rs + rox;
        const my = TC.y + ry * rs + roy;
        // 吸入目标：删除按钮口（绝对系，与版本一一致）
        const gx = tx + rx * TINY;
        const gy = ty + ry * TINY * FLAT;
        const v = vRow[c];
        v.x = mx + (gx - mx) * lp;
        v.y = my + (gy - my) * lp;
      }
    }
  };

  // 变暗系数（进入瓶中越深越暗）
  const darkOf = (progress: number) => {
    const k = Math.pow(1 - progress, 1.6) * 0.95 + 0.05;
    return 1 - (0.55 + 0.45 * k);
  };

  // ===== 选择渲染器：WebGL 优先，失败回退 Canvas2D =====
  // 注意：纹理被污染时必须在此处（首次 getContext）就跳过申请 WebGL 上下文——
  // 同一 canvas 一旦先取得 webgl 上下文，后续 getContext("2d") 将返回 null，回退渲染器会失效。
  let glRender: ((vertices: Vert[][], dark: number) => void) | null = null;
  const gl =
    (!texTainted &&
      canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
      })) ||
    null;
  if (gl) glRender = createSuctionGL(gl, tex, boxW, boxH, cols, rows, minX, minY);

  // ---- Canvas2D 回退（逐三角贴图）：仅在 WebGL 不可用时启用 ----
  let ctx: CanvasRenderingContext2D | null = null;
  let drawCardMesh2D: ((progress: number) => void) | null = null;
  if (!glRender) {
    ctx = canvas.getContext("2d");
    if (!ctx) {
      finish();
      return;
    }
    ctx.scale(dpr, dpr);
    ctx.translate(-minX, -minY); // 视口坐标平移至包围盒原点，后续绘制仍用视口坐标

    // 三角常量预计算（源矩形外扩1px + 仿射分母），每帧只按变形顶点算仿射矩阵
    const TRI_PAD = 1.5;
    interface TriConst {
      sx0: number; sy0: number; sx1: number; sy1: number; sx2: number; sy2: number;
      ssx: number; ssy: number; ssw: number; ssh: number; denom: number;
    }
    const triCache: TriConst[][] = [];
    for (let r = 0; r < rows; r++) {
      const rowTri: TriConst[] = [];
      for (let c = 0; c < cols; c++) {
        const s0x = (c / cols) * tw, s0y = (r / rows) * th;
        const s1x = ((c + 1) / cols) * tw, s1y = s0y;
        const s2x = s1x, s2y = ((r + 1) / rows) * th;
        const s3x = s0x, s3y = s2y;
        const minx = Math.max(0, Math.min(s0x, s1x, s2x, s3x) - 1);
        const miny = Math.max(0, Math.min(s0y, s1y, s2y, s3y) - 1);
        const maxx = Math.min(tw, Math.max(s0x, s1x, s2x, s3x) + 1);
        const maxy = Math.min(th, Math.max(s0y, s1y, s2y, s3y) + 1);
        const mk = (ax: number, ay: number, bx: number, by: number, cx2: number, cy: number): TriConst => ({
          sx0: ax, sy0: ay, sx1: bx, sy1: by, sx2: cx2, sy2: cy,
          ssx: minx, ssy: miny, ssw: maxx - minx, ssh: maxy - miny,
          denom: (bx - ax) * (cy - ay) - (by - ay) * (cx2 - ax) || 1e-6,
        });
        rowTri.push(mk(s0x, s0y, s1x, s1y, s2x, s2y));
        rowTri.push(mk(s0x, s0y, s2x, s2y, s3x, s3y));
      }
      triCache.push(rowTri);
    }

    const c2 = ctx;
    const drawTexTriFast = (t: TriConst, d0: Vert, d1: Vert, d2: Vert) => {
      const { sx0, sy0, sx1, sy1, sx2, sy2, ssx, ssy, ssw, ssh, denom } = t;
      const ccx = (d0.x + d1.x + d2.x) / 3;
      const ccy = (d0.y + d1.y + d2.y) / 3;
      let ex, ey, l;
      ex = d0.x - ccx; ey = d0.y - ccy; l = Math.hypot(ex, ey) || 1; const a0x = d0.x + (ex / l) * TRI_PAD, a0y = d0.y + (ey / l) * TRI_PAD;
      ex = d1.x - ccx; ey = d1.y - ccy; l = Math.hypot(ex, ey) || 1; const b0x = d1.x + (ex / l) * TRI_PAD, b0y = d1.y + (ey / l) * TRI_PAD;
      ex = d2.x - ccx; ey = d2.y - ccy; l = Math.hypot(ex, ey) || 1; const c0x = d2.x + (ex / l) * TRI_PAD, c0y = d2.y + (ey / l) * TRI_PAD;
      const m11 = ((b0x - a0x) * (sy2 - sy0) - (c0x - a0x) * (sy1 - sy0)) / denom;
      const m12 = ((c0x - a0x) * (sx1 - sx0) - (b0x - a0x) * (sx2 - sx0)) / denom;
      const m21 = ((b0y - a0y) * (sy2 - sy0) - (c0y - a0y) * (sy1 - sy0)) / denom;
      const m22 = ((c0y - a0y) * (sx1 - sx0) - (b0y - a0y) * (sx2 - sx0)) / denom;
      const mtx = a0x - (m11 * sx0 + m12 * sy0);
      const mty = a0y - (m21 * sx0 + m22 * sy0);
      c2.setTransform(dpr, 0, 0, dpr, -minX * dpr, -minY * dpr);
      c2.transform(m11, m21, m12, m22, mtx, mty);
      c2.drawImage(tex, ssx, ssy, ssw, ssh, ssx, ssy, ssw, ssh);
    };

    drawCardMesh2D = (progress: number) => {
      const { vertices } = card;
      const dark = darkOf(progress);
      const clipPath = () => {
        c2.beginPath();
        c2.moveTo(vertices[0][0].x, vertices[0][0].y);
        for (let c = 1; c <= cols; c++) c2.lineTo(vertices[0][c].x, vertices[0][c].y);
        for (let r = 1; r <= rows; r++) c2.lineTo(vertices[r][cols].x, vertices[r][cols].y);
        for (let c = cols - 1; c >= 0; c--) c2.lineTo(vertices[rows][c].x, vertices[rows][c].y);
        for (let r = rows - 1; r >= 0; r--) c2.lineTo(vertices[r][0].x, vertices[r][0].y);
        c2.closePath();
      };
      c2.save();
      clipPath();
      c2.clip();
      for (let r = 0; r < rows; r++) {
        const triRow = triCache[r];
        const vRow = vertices[r];
        const vNext = vertices[r + 1];
        for (let c = 0; c < cols; c++) {
          const d0 = vRow[c], d1 = vRow[c + 1], d2 = vNext[c + 1], d3 = vNext[c];
          drawTexTriFast(triRow[c * 2], d0, d1, d2);
          drawTexTriFast(triRow[c * 2 + 1], d0, d2, d3);
        }
      }
      c2.restore();
      if (dark > 0.01) {
        c2.save();
        clipPath();
        c2.fillStyle = `rgba(0,0,0,${dark})`;
        c2.fill();
        c2.restore();
      }
    };
  }

  const clear2D = () => ctx!.clearRect(minX, minY, boxW, boxH);
  const drawFrame = (progress: number) => {
    updateVertices(progress);
    if (glRender) glRender(card.vertices, darkOf(progress));
    else if (drawCardMesh2D) { clear2D(); drawCardMesh2D(progress); }
  };

  // 首帧同步绘制，避免 rAF 延迟造成的 1 帧空档（被删图已隐藏，canvas 尚未就绪 → 白屏一瞬）
  drawFrame(0);

  const start = performance.now();
  const loop = (now: number) => {
    const progress = Math.min(1, (now - start) / durationMs);
    drawFrame(progress);
    if (progress < 1) raf = requestAnimationFrame(loop);
    else finish();
  };
  raf = requestAnimationFrame(loop);
}
