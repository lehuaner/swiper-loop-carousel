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
