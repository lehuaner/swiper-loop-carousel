import type { MotionValue } from "motion/react";

// ── 类型 ──

export interface GalleryImage {
  id: number;
  src: string;
  thumbSrc: string;
  alt: string;
  /** 图片原始宽度（px），用于覆盖层显示尺寸信息 */
  width?: number;
  /** 图片原始高度（px），用于覆盖层显示尺寸信息 */
  height?: number;
  /** 文件大小（字节），用于覆盖层显示文件大小 */
  fileSize?: number;
  /** 自定义文件大小显示文本（如 "512 KB"），优先于 fileSize */
  sizeLabel?: string;
  /** 自定义尺寸显示文本（如 "1920 × 1080"），优先于 width×height */
  dimensions?: string;
}

// ── 常量 ──

export const THUMB_SIZE = 56;
export const THUMB_GAP = 8;
export const DUAL_HIGHLIGHT_EXTRA_GAP = 6;
export const CENTER_THUMB_SIZE = 80;
export const CENTER_SCALE = CENTER_THUMB_SIZE / THUMB_SIZE;
export const BOTTOM_RESERVED = 140;

export const STRIP_DENSITY_CONFIG = {
  1: { visible: 7, drag: 11, labelKey: "densityFew" as const },
  2: { visible: 9, drag: 13, labelKey: "densityMed" as const },
  3: { visible: 11, drag: 15, labelKey: "densityMore" as const },
} as const;

export const VIEW_MODE_CONFIG = {
  1: { labelKey: "viewMode1" as const },
  2: { labelKey: "viewMode2" as const },
  3: { labelKey: "viewMode3" as const },
} as const;

// ── 缩放渐隐（单/双/三图）──
// 隐藏时机取决于"图片占计算基准格位的百分比"：基准格位随模式切换——单图=整个视口、
// 双图=1/2 屏幕、三图=1/3 屏幕（宽÷viewMode，高不变）。coverage = 缩放后图片最短边（宽/高中
// 相对格位占比更小的一边）与格位对应边之比。默认（未占满）全不透明；任一图最短边也放大到
// 与格位一致（coverage=1，完全填满其格位）时，周边 UI（左右箭头/底部缩略图条/顶部提示条/
// 名称栏及其操作钮/右下角设置菜单/框架半透明层/重命名面板/Dev 面板）全部隐藏（取活跃行
// 各图最小值，任一图达标即全隐）。coverage 由默认值 c0 线性映射不透明度 1 → 0；
// 只计缩放、不计拖拽平移；关闭按钮与全屏背景不参与。

// ── 按屏幕宽高比（W/H）自动收敛视图模式 ──
// ratio ≤ RATIO_MAX_SINGLE → 单图；RATIO_MAX_SINGLE < ratio < RATIO_MAX_DUAL → 双图；
// ratio ≥ RATIO_MAX_DUAL → 三图。同一阈值决定右下角设置菜单的出现（能盛放双图才出现）
// 与三图选项的出现（能盛放三图才出现）。
// 仅"缩小"方向自动切换：视口变窄/比例变小导致当前模式超出可行档位时才自动降级；
// 视口变大不自动升级，当前是什么视图放大后依然保持该视图（手动选择也不被升档覆盖）。
export const RATIO_MAX_SINGLE = 1;
export const RATIO_MAX_DUAL = 1.5;

export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const PRELOAD_RANGE = 3;

// 键盘长按分级参数
export const WRAP_PAUSE_MS = 300;
export const POST_WRAP_PAUSE_MS = 200;
export const LONG_PRESS_INITIAL_DELAY_MS = 400;
export const LONG_PRESS_TIER_BOUNDARIES_MS = [1000, 1500] as const;
export const LONG_PRESS_TIER_INTERVALS_MS = [200, 80, 30] as const;

// ── 类型 ──

export interface ImageMotions {
  x: MotionValue<number>;
  y: MotionValue<number>;
  scale: MotionValue<number>;
  /** 入场/删除补位时的水平位移（由 AnimatedSlideImg 内部驱动）；与顶部名称/功能按钮栏共享，
   *  使名称按钮栏在删除补位时与图片同步平移。 */
  entryX: MotionValue<number>;
  /** 删除"被吸走"动画：整体透明度（收点时淡出） */
  opacity: MotionValue<number>;
  /** 删除"被吸走"动画：整体旋转（轻微旋转，更像被卷走） */
  rotate: MotionValue<number>;
}

export interface PreloadedDims {
  w: number;
  h: number;
}

// ── 工具函数 ──

/**
 * 格式化文件大小（字节 → 人类可读字符串）
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 计算 object-contain 下图片在给定容器中的实际渲染尺寸。
 */
export function computeContainedSize(
  naturalW: number,
  naturalH: number,
  boxW: number,
  boxH: number
): { w: number; h: number } {
  if (naturalW <= 0 || naturalH <= 0 || boxW <= 0 || boxH <= 0) {
    return { w: 1, h: 1 };
  }
  const imgRatio = naturalW / naturalH;
  const boxRatio = boxW / boxH;
  if (imgRatio > boxRatio) {
    return { w: boxW, h: boxW / imgRatio };
  } else {
    return { h: boxH, w: boxH * imgRatio };
  }
}

/**
 * 缩放渐隐：由缩放倍数推导周边 UI 不透明度（纯计算，无 DOM 读取；单/双/三图通用）。
 * 隐藏时机取决于图片占"计算基准格位"的百分比（最短边 coverage；单图格位=视口、
 * 双图=视口÷2、三图=视口÷3，由调用方传入 viewW/viewH），假设图片居中、不计拖拽平移：
 *   c0 = 默认（scale=1）时图片最短边占格位对应边的比例；c = c0 × scale。
 *   c0（默认倍数）→ 不透明 1；c=1（最短边也放大到与格位一致，图片完全填满格位）→ 完全透明 0；中间线性。
 * @param scale 当前缩放倍数
 * @param baseW 缩放前（scale=1）图片实际渲染宽（在其格位内 contain 适配后的显示尺寸）
 * @param baseH 缩放前图片实际渲染高
 * @param viewW 基准格位宽（视口宽 ÷ viewMode）
 * @param viewH 基准格位高（视口高）
 */
export function computeZoomUiOpacity(
  scale: number,
  baseW: number,
  baseH: number,
  viewW: number,
  viewH: number
): number {
  if (scale <= 1 || baseW <= 0 || baseH <= 0 || viewW <= 0 || viewH <= 0) return 1;
  // 最短边占比：宽/高两侧中取相对视口占得更小的一侧（以最短边为基准，c=1 即图片完全填满视口）
  const c0 = Math.min(baseW / viewW, baseH / viewH);
  const c = c0 * scale;
  if (c >= 1 || c0 >= 1) return 0; // 最短边也已放大到与视口一致 → 全部隐藏
  return Math.max(0, Math.min(1, (1 - c) / (1 - c0)));
}

/**
 * 计算缩放变换后的新 x/y 偏移量，使缩放中心保持在指针位置。
 * 抽取自 handleWheel 和 handleTouchMove 的公共逻辑。
 */
export function computeZoomTransform(params: {
  pointerX: number;
  pointerY: number;
  imgRect: DOMRect | undefined;
  containerRect: DOMRect;
  currentX: number;
  currentY: number;
  oldScale: number;
  newScale: number;
}): { newX: number; newY: number } {
  const {
    pointerX,
    pointerY,
    imgRect,
    containerRect,
    currentX,
    currentY,
    oldScale,
    newScale,
  } = params;

  const imgCenterX = imgRect
    ? imgRect.left + imgRect.width / 2 - containerRect.left - containerRect.width / 2
    : 0;
  const imgCenterY = imgRect
    ? imgRect.top + imgRect.height / 2 - containerRect.top - containerRect.height / 2
    : 0;

  const pointerInContainerX = pointerX - containerRect.left - containerRect.width / 2;
  const pointerInContainerY = pointerY - containerRect.top - containerRect.height / 2;

  const offsetX = pointerInContainerX - (imgCenterX + currentX);
  const offsetY = pointerInContainerY - (imgCenterY + currentY);
  const imgX = offsetX / oldScale;
  const imgY = offsetY / oldScale;

  return {
    newX: pointerInContainerX - imgCenterX - imgX * newScale,
    newY: pointerInContainerY - imgCenterY - imgY * newScale,
  };
}
