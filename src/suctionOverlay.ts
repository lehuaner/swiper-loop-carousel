// 删除图片的"吸入"动画（OffscreenCanvas + Web Worker 覆盖层渲染）
// 由原主线程 Canvas 网格三角纹理映射动画演进而来：
//   - 从原 examples/ui/吸入动画 忠实移植（真实图像 + 网格三角纹理映射 + 从一角向目标蔓延的形变）。
//   - 关键适配（沿用）：
//     * 卡片坐标/尺寸 = 运行时图片"删除前真实可见矩形"（按 object-contain 计算内容框，非元素外框、不写死像素）。
//     * 目标 = 被点删除按钮中心（运行时获取）。
//     * 纹理直接用已加载的 DOM <img> 同步生成，避免 new Image 重新加载带来的异步闪烁。
//     * 画布只覆盖"卡片 + 吸入目标点"的包围盒，而非整屏（避免高分屏分配上百 MB backing store 及整页 layout）。
//   - 本次改造（性能）：
//     * 每帧网格绘制搬到 **Web Worker 独立线程**，用 OffscreenCanvas 渲染；主线程只在开始时一次性
//       提取纹理并 postMessage，之后不再逐帧绘制。即使主线程被删除点击/460ms 重排长任务（trace 中
//       ~32ms JS）占用，吸入动画也由后台线程按时推进，掉帧根治，视觉与改前完全一致。
//     * 用 Blob 内联 Worker（suctionWorkerSource），规避 tsup splitting:false / 应用打包另产出 worker 文件。

import { suctionWorkerSource } from "./suctionWorkerSource";

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
const MAX_GRID = 20; // 网格密度不超过 20
const PAD = 24; // 形变溢出到目标点方向的余量

export function playSuction(opts: SuctionOptions): void {
  const { imgEl, target, gridCols = 18, durationMs = 400, onDone } = opts;
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
  const minX = Math.floor(Math.min(cardX, targetCenter.x) - PAD);
  const minY = Math.floor(Math.min(cardY, targetCenter.y) - PAD);
  const maxX = Math.ceil(Math.max(cardX + cardW, targetCenter.x) + PAD);
  const maxY = Math.ceil(Math.max(cardY + cardH, targetCenter.y) + PAD);
  const boxW = Math.max(1, maxX - minX);
  const boxH = Math.max(1, maxY - minY);

  // 主线程一次性生成纹理（imgEl 仅主线程可读，无法回避；相比原"每帧主线程重绘"，此项只是一次性成本）。
  const tex = document.createElement("canvas");
  tex.width = Math.max(1, Math.round(cardW * TEX_SCALE));
  tex.height = Math.max(1, Math.round(cardH * TEX_SCALE));
  const tctx = tex.getContext("2d");
  if (!tctx) {
    onDone?.();
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

  // 定位 canvas 并转交给 Worker 线程渲染
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

  let offscreen: OffscreenCanvas | null = null;
  try {
    offscreen = canvas.transferControlToOffscreen();
  } catch {
    canvas.remove();
    onDone?.();
    return;
  }

  const blob = new Blob([suctionWorkerSource], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    canvas.remove();
    worker.terminate();
    URL.revokeObjectURL(url);
  };
  worker.onmessage = (e) => {
    if (e.data && e.data.type === "done") {
      cleanup();
      onDone?.();
    }
  };
  worker.onerror = () => {
    cleanup();
    onDone?.();
  };

  // 纹理转成 ImageBitmap（可 transferable 传 worker），随后启动动画
  void createImageBitmap(tex)
    .then((bitmap) => {
      if (closed) {
        bitmap.close();
        return;
      }
      worker.postMessage(
        {
          type: "init",
          canvas: offscreen,
          texture: bitmap,
          dpr,
          minX,
          minY,
          boxW,
          boxH,
          durationMs,
          card: { x: cardX, y: cardY, w: cardW, h: cardH, cols, rows: Math.max(3, Math.min(MAX_GRID, Math.round(cols * (cardH / cardW)))) },
          target: targetCenter,
        },
        [offscreen as unknown as Transferable, bitmap as unknown as Transferable]
      );
    })
    .catch(() => {
      cleanup();
      onDone?.();
    });
}