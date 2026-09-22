"use client";

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, startTransition, Component, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useMotionValue, animate, MotionValue } from "motion/react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Virtual } from "swiper/modules";
import type { Swiper as SwiperClass } from "swiper";
import { playSuction } from "./suctionOverlay";

// 连续删除时，排队项没有点击事件上下文，且 DOM 已因前序删除重排；按幻灯片索引从 DOM 实时解析
// 删除按钮中心（吸入目标）与该幻灯片主图（网格形变纹理来源）。循环/虚拟模式下同 index 可能有
// 多份克隆，取视口内最靠近中心的删除按钮（即真实可见的那个）。
function resolveSuctionTargets(index: number): {
  target?: { x: number; y: number };
  imgEl?: HTMLImageElement | null;
} {
  if (typeof document === "undefined") return {};
  const roots = Array.from(
    document.querySelectorAll(`[data-img-index="${index}"]`)
  ) as HTMLElement[];
  let bestBtn: HTMLButtonElement | null = null;
  let bestDist = Infinity;
  const vcx = window.innerWidth / 2;
  const vcy = window.innerHeight / 2;
  let imgEl: HTMLImageElement | null = null;
  for (const root of roots) {
    const img = root.querySelector("[data-carousel-main-img]") as HTMLImageElement | null;
    if (img && img.isConnected && !imgEl) imgEl = img;
    const btn = root.querySelector('[data-carousel-action="delete"]') as HTMLButtonElement | null;
    if (btn) {
      const r = btn.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const d = Math.hypot(r.left + r.width / 2 - vcx, r.top + r.height / 2 - vcy);
        if (d < bestDist) {
          bestDist = d;
          bestBtn = btn;
        }
      }
    }
  }
  if (bestBtn) {
    const r = bestBtn.getBoundingClientRect();
    return { target: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, imgEl };
  }
  return { imgEl };
}

// React.memo 包裹 Swiper：防止父组件无关状态变化（isKeyboardActive/isStripDragging 等）
// 触发 Swiper 内部的 getChildren(440) + renderVirtual(880) + getChangedParams(440)
const MemoSwiper = React.memo(Swiper);
import "swiper/css";

// 轻量级错误边界：捕获轮播组件运行时异常，防止整页崩溃
class CarouselErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center p-8 text-slate-500">
          Carousel error, please refresh
        </div>
      );
    }
    return this.props.children;
  }
}

import {
  THUMB_SIZE,
  THUMB_GAP,
  DUAL_HIGHLIGHT_EXTRA_GAP,
  CENTER_THUMB_SIZE,
  CENTER_SCALE,
  BOTTOM_RESERVED,
  STRIP_DENSITY_CONFIG,
  VIEW_MODE_CONFIG,
  FOCUSABLE_SELECTOR,
  WRAP_PAUSE_MS,
  POST_WRAP_PAUSE_MS,
  LONG_PRESS_INITIAL_DELAY_MS,
  LONG_PRESS_TIER_BOUNDARIES_MS,
  LONG_PRESS_TIER_INTERVALS_MS,
  type GalleryImage,
  type ImageMotions,
  computeZoomTransform,
  computeContainedSize,
  formatFileSize,
} from "./utils";
import { useImagePreloader, useWindowWidth, useInView } from "./hooks";
import { useCarouselI18n, useCarouselLang } from "./i18n";
import AnimatedSlideImg from "./AnimatedSlideImg";
import HintBar from "./HintBar";

// ── localStorage 持久化 ──
const DEFAULT_PERSIST_KEY = "@lehuan/swiper-loop-carousel/settings";

// ── 主题 ──
// 调用方通过 theme="dark" | "light" 切换整体配色。
// 暗色主题的黑色控件统一“亮度提升 10%”（纯黑 → 10% 亮度的深灰 rgba(26,26,26…)），
// 让箭头/切换菜单等控件比纯黑更柔和、轮廓更清晰。
export type CarouselTheme = "dark" | "light";

interface ThemeTokens {
  /** 上一张/下一张箭头圆的底色与图标色 */
  arrowBg: string;
  arrowText: string;
  /** 右下角切换菜单外壳底色 */
  shellBg: string;
  /** 外壳内各标题按钮的常规与 hover/激活文字色 */
  titleText: string;
  titleTextActive: string;
  /** 二级下拉菜单底色 */
  dropdownBg: string;
  /** 下拉内选项的常规文字色 */
  optionText: string;
  /** 下拉内激活项的高亮 pill 底色与文字色（暗色下白底深字，亮色下深底白字） */
  activePill: string;
  activeText: string;
  /** 菜单内分隔线 */
  separator: string;
  /** 悬浮提示气泡 */
  tooltipBg: string;
  tooltipText: string;
  /** 覆盖层主背景 */
  backdrop: string;
  /** 默认前景文字（顶部序号/标题等） */
  text: string;
  /** 次级文字（作者/尺寸/大小） */
  textDim: string;
  /** 更弱化文字 */
  textFaint: string;
  /** 控件底色（序号/关闭按钮） */
  ctrlBg: string;
  /** 控件 hover 底色 */
  ctrlHoverBg: string;
  /** 键盘对焦描边 */
  ring: string;
  /** 边缘导航 hover 蒙层 */
  navHover: string;
  /** 缩放定位方框描边 */
  line: string;
  /** 加载占位底 */
  placeholder: string;
  /** 缩略图条背景遮罩 */
  stripBg: string;
  /** 溢出图片的半透明"框架"色：图片不做裁剪，溢出部分被这一层透明框覆盖而呈半透明 */
  frame: string;
}

const THEMES: Record<CarouselTheme, ThemeTokens> = {
  dark: {
    arrowBg: "rgba(26,26,26,0.42)",
    arrowText: "#ffffff",
    shellBg: "rgba(26,26,26,0.42)",
    titleText: "rgba(255,255,255,0.72)",
    titleTextActive: "#ffffff",
    dropdownBg: "rgba(26,26,26,0.8)",
    optionText: "rgba(255,255,255,0.72)",
    activePill: "#ffffff",
    activeText: "#161616",
    separator: "rgba(255,255,255,0.2)",
    tooltipBg: "rgba(26,26,26,0.85)",
    tooltipText: "#ffffff",
    backdrop: "rgba(0,0,0,0.9)",
    text: "#ffffff",
    textDim: "rgba(255,255,255,0.7)",
    textFaint: "rgba(255,255,255,0.5)",
    ctrlBg: "rgba(26,26,26,0.6)",
    ctrlHoverBg: "rgba(26,26,26,0.8)",
    ring: "#ffffff",
    navHover: "rgba(26,26,26,0.2)",
    line: "#ffffff",
    placeholder: "rgba(51,65,85,0.5)",
    stripBg: "rgba(30,41,59,0.6)",
    frame: "rgba(6,7,10,0.72)",
  },
  light: {
    arrowBg: "rgba(255,255,255,0.45)",
    arrowText: "#1a1a1a",
    shellBg: "rgba(255,255,255,0.45)",
    titleText: "rgba(20,20,20,0.62)",
    titleTextActive: "#000000",
    dropdownBg: "rgba(255,255,255,0.97)",
    optionText: "rgba(20,20,20,0.66)",
    activePill: "#1a1a1a",
    activeText: "#ffffff",
    separator: "rgba(0,0,0,0.14)",
    tooltipBg: "rgba(30,30,30,0.88)",
    tooltipText: "#ffffff",
    backdrop: "rgba(251,251,251,0.55)",
    text: "#1a1a1a",
    textDim: "rgba(20,20,20,0.66)",
    textFaint: "rgba(20,20,20,0.45)",
    ctrlBg: "rgba(255,255,255,0.55)",
    ctrlHoverBg: "rgba(0,0,0,0.12)",
    ring: "#161616",
    navHover: "rgba(0,0,0,0.08)",
    line: "#161616",
    placeholder: "rgba(148,163,184,0.4)",
    stripBg: "rgba(255,255,255,0.55)",
    frame: "rgba(28,30,34,0.4)",
  },
};

/** 辅助类：直接引用根节点注入的 --car-* CSS 变量，避免依赖调用方 tailwind 扫描组件内的
 *  arbitrary-var 类。颜色随 theme 切换即时生效；hover 用普通 CSS 规则补齐。 */
const carThemeStyles = `
.car__tooltip{background:var(--car-tooltip-bg);color:var(--car-tooltip-text)}
.car__tip{border-left-color:var(--car-tip-tri)}
.car__ctrl{background:var(--car-ctrl-bg);color:var(--car-text)}
.car__title{color:var(--car-title)}
.car__title:hover{color:var(--car-title-active)}
.car__option{color:var(--car-option)}
.car__option:hover{color:var(--car-option-active)}
.car__active{color:var(--car-option-active)}
.car__disabled{color:var(--car-text-faint)}
.car__pill{background:var(--car-pill)}
.car__sep{background:var(--car-sep)}
.car__nav:hover{background:var(--car-nav-hover)}
.car__placeholder{background:var(--car-placeholder)}
.car__strip{background:var(--car-strip-bg)}
`;

/** 缩略图条虚拟窗口半径（中心 ± 该值）。拖拽时仅当目标超出此窗口才扩展重渲染，窗口内靠 stripX 平滑移动 */
const STRIP_VIRTUAL_RANGE = 20;
/** 拖拽期间临时外扩的渲染半径（常驻 20，拖拽时每边多渲染 7，避免拖到边缘时一侧空白） */
const STRIP_DRAG_VIRTUAL_RANGE = 27;
/** 缩略图预加载前瞻：渲染窗口外每侧多预加载这么多张，窗口移位时新缩略图已缓存、无需网络加载+解码 */
const THUMB_PRELOAD_LOOKAHEAD = 10;
/** 分页加载预取余量：接近末尾（还剩这么多张）时提前 onNeedMore 续上下一页，
 *  避免长按/拖拽到第 100 张边界被卡住、还必须再按一次才能续上 */
const PAGINATION_LOOKAHEAD = 20;

/** 画布外侧黑边：上/左/右固定 20px（不随视口变化），画布内部宽度=视口宽-两侧黑边 */
const CANVAS_EDGE_PX = 20;

interface PersistedSettings {
  viewMode: 1 | 2 | 3;
  stripDensityLevel: 1 | 2 | 3;
  wheelMode: "zoom" | "switch";
}

function loadPersistedSettings(key: string): PersistedSettings | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSettings;
  } catch {
    return null;
  }
}

function savePersistedSettings(key: string, settings: PersistedSettings): void {
  try {
    localStorage.setItem(key, JSON.stringify(settings));
  } catch {
    // localStorage 可能不可用或已满，安全忽略
  }
}

// ── Memoized 子组件 ──

// AnimatedSlideImg：忽略 onExitComplete（内部已用 ref 追踪），避免父组件渲染导致不必要的子组件重渲染
const MemoAnimatedSlideImg = React.memo(
  AnimatedSlideImg,
  (prev, next) =>
    prev.src === next.src &&
    prev.underlaySrc === next.underlaySrc &&
    prev.isActive === next.isActive &&
    prev.wasActive === next.wasActive &&
    prev.loading === next.loading &&
    prev.viewModeEpoch === next.viewModeEpoch &&
    prev.deleteEpoch === next.deleteEpoch &&
    prev.deleteShiftActive === next.deleteShiftActive &&
    prev.deleteFillTarget === next.deleteFillTarget &&
    prev.deleteFillSettledAt === next.deleteFillSettledAt &&
    prev.deleteEntryTarget === next.deleteEntryTarget &&
    prev.deleteTranslateX === next.deleteTranslateX &&
    prev.groupShiftX === next.groupShiftX &&
    prev.groupShiftScaleX === next.groupShiftScaleX &&
    prev.movingClipPath === next.movingClipPath &&
    prev.viewModeOffsetX === next.viewModeOffsetX &&
    prev.entryXFrom === next.entryXFrom &&
    prev.entryScaleFrom === next.entryScaleFrom &&
    prev.entryXOffset === next.entryXOffset &&
    prev.isExitingOnViewModeChange === next.isExitingOnViewModeChange &&
    prev.entryNoFade === next.entryNoFade &&
    prev.showSpinner === next.showSpinner &&
    prev.downloadProgress === next.downloadProgress &&
    prev.progressKnown === next.progressKnown &&
    prev.onThumbLoaded === next.onThumbLoaded &&
    prev.thumbKey === next.thumbKey
);

// 缩略图条单项：忽略 onThumbClick（稳定引用 + 内部仅触发一次），仅当 active 等视觉状态变化时重渲染
// loaded 状态由组件内部管理，避免父组件 stripLoadVersion 变化导致所有缩略图重算
// 删除动画：isDeleting 时"向上飞出"；animOffsetX != 0 时其余项从旧位置平滑"靠拢"到新位置（FLIP）
interface ThumbnailItemProps {
  img: GalleryImage;
  idx: number;
  active: boolean;
  activeScale: number;
  onThumbClick: (idx: number) => void;
  stripHeight: number;
  /** 相对于 strip 容器左边缘的 X 偏移（px），由父组件根据绝对索引计算 */
  offsetX: number;
  /** 挂载时的相对 X 偏移（旧位置到新位置的差值），用于删除后靠拢动画；0 表示无位移动画 */
  animOffsetX: number;
  /** 该项是否正被删除：是则播放"向上飞出"动画 */
  isDeleting: boolean;
  /** 删除窗口内右侧幸存缩略图的共享平移：与主图 groupShiftX 同思路，同帧左移一格合并 */
  groupShiftX?: MotionValue<number>;
  /** 缩略图实际加载完成时回调记录自然尺寸（供视图切换缩放补偿） */
  onThumbDim?: (id: number, w: number, h: number) => void;
}
/** 缩略图删除时向上飞出的高度 */
const THUMB_FLY_UP = THUMB_SIZE + 16;
/**
 * 底部缩略图行的恒定高度：所有视图模式统一使用，作为容器高度与缩略图垂直居中基准。
 * 取单图高亮框高度（CENTER_THUMB_SIZE + 8），既容纳单图放大后的中心图，又保证
 * 单图↔双/三图切换时容器高度不变 → 缩略图行中心不位移 → 消除 Y 轴跳变。
 * 高亮边框仍按 viewMode 动画其自身高度（相对容器居中），不影响本行位置。
 */
const STRIP_ROW_HEIGHT = CENTER_THUMB_SIZE + 8;
/** 吸入动画时长（ms）：被删图 canvas 网格形变吸入删除钮 */
const DELETE_SUCTION_MS = 1400 / 3.5;
/** 删除切换动画时长（ms）：吸入结束后右段补位平移 + 新入图入场，与常规切换(0.4s)同源同速 */
const DELETE_MOTION_MS = 400;
/** 切换动画结束后、重排提交前的稳定缓冲（ms） */
const DELETE_SETTLE_BUFFER_MS = 60;
const ThumbnailItem = React.memo(
  function ThumbnailItem({
    img,
    idx,
    active,
    activeScale,
    onThumbClick,
    stripHeight,
    offsetX,
    animOffsetX,
    isDeleting,
    groupShiftX,
    onThumbDim,
  }: ThumbnailItemProps) {
    // 局部可见性检测：进出视口只更新本缩略图组件，不触发 Carousel / 缩略图条整体重渲染
    const [inView, setRef] = useInView<HTMLButtonElement>("50px");
    const [loaded, setLoaded] = useState(false);
    const loadedRef = useRef(false);
    const imgElRef = useRef<HTMLImageElement>(null);

    // 检测图片是否已缓存（进入可见区域时 remount <img>，避免缓存命中时仍闪烁 skeleton）
    useLayoutEffect(() => {
      const img = imgElRef.current;
      if (img && img.complete && img.naturalWidth > 0) {
        loadedRef.current = true;
        setLoaded(true);
      }
    }, [inView]);

    const targetScale = isDeleting ? 0.5 : active ? activeScale : 1;
    const targetOpacity = isDeleting ? 0 : active ? 1 : 0.6;

    return (
      <motion.div
        className={`absolute ${active ? "z-10" : ""}`}
        style={{
          left: offsetX,
          top: (stripHeight - THUMB_SIZE) / 2,
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          // 共享平移：删除窗口内右侧幸存缩略图的"整个容器（含按钮）"左移一格合并，
          // 补上被删缩略图留下的空缺——与飞出/主图右侧段同帧（合成器层）。
          // 放在定位层而非按钮内部：若放内部，内容只会在自己容器里平移并被 overflow 裁剪。
          x: groupShiftX,
          willChange: "transform",
        }}
      >
        <motion.button
          ref={setRef}
          onClick={(e) => {
            onThumbClick(idx);
            // 点击缩略图是“跳转”语义，不应让该按钮保持键盘焦点，
            // 否则后续用方向键切换中心图时，焦点仍停在此按钮上，
            // 残留 focus-visible 白色 ring（白圈）。失焦后由 dialog 容器承接焦点。
            e.currentTarget.blur();
          }}
          className={`flex-shrink-0 overflow-hidden rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--car-ring)] relative h-full w-full`}
          style={{ width: "100%", height: "100%" }}
          initial={
            animOffsetX === 0 && !isDeleting
              ? false
              : { x: animOffsetX, y: 0, scale: targetScale, opacity: targetOpacity }
          }
          animate={{
            x: 0,
            y: isDeleting ? -THUMB_FLY_UP : 0,
            scale: targetScale,
            opacity: targetOpacity,
          }}
          transition={{
            x: { type: "tween", duration: 0.34, ease: [0.22, 1, 0.36, 1] },
            y: isDeleting ? { type: "tween", duration: 0.3, ease: [0.42, 0, 1, 1] } : { type: "tween", duration: 0.2 },
            scale: { type: "spring", stiffness: 420, damping: 30 },
            opacity: { type: "tween", duration: isDeleting ? 0.25 : 0.2 },
          }}
          aria-label={`Go to ${img.alt}`}
          aria-current={active ? "true" : undefined}
        >
          <div className="relative h-full w-full">
            {inView ? (
              <>
                {!loaded && (
                  <div className="absolute inset-0 animate-pulse car__placeholder" />
                )}
                <img
                  ref={imgElRef}
                  src={img.thumbSrc}
                  alt=""
                  width={THUMB_SIZE}
                  height={THUMB_SIZE}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="h-full w-full object-cover"
                  style={{
                    opacity: loaded ? 1 : 0,
                    transition: "opacity 0.2s ease-in",
                  }}
                  onLoad={() => {
                    if (!loadedRef.current) {
                      loadedRef.current = true;
                      setLoaded(true);
                    }
                    // 记录缩略图自然尺寸（供视图切换缩放补偿；原图未就绪时按实际显示内容计算）
                    if (imgElRef.current) {
                      onThumbDim?.(img.id, imgElRef.current.naturalWidth || 0, imgElRef.current.naturalHeight || 0);
                    }
                  }}
                />
              </>
            ) : (
              <div className="absolute inset-0 car__strip" />
            )}
          </div>
        </motion.button>
      </motion.div>
    );
  },
  (prev, next) =>
    prev.img.id === next.img.id &&
    prev.idx === next.idx &&
    prev.active === next.active &&
    prev.activeScale === next.activeScale &&
    prev.stripHeight === next.stripHeight &&
    prev.offsetX === next.offsetX &&
    prev.animOffsetX === next.animOffsetX &&
    prev.isDeleting === next.isDeleting &&
    prev.groupShiftX === next.groupShiftX &&
    prev.onThumbDim === next.onThumbDim
);

// ── 图片功能插槽类型 ──
export interface CarouselActionCtx {
  /** 当前功能针对的图片 */
  image: GalleryImage;
  /** 该图片在有效（未删除）列表中的下标 */
  index: number;
  /** 有效图片总数 */
  total: number;
}
export interface CarouselAction {
  /** 唯一标识。缺省内置动作为 "delete"、"rename" */
  key: string;
  /** 图标（可自定义节点）。缺省时对内置动作自动补全其默认图标（delete→垃圾桶、rename→铅笔） */
  icon?: ReactNode;
  /** 悬停提示 / 无障碍标签 */
  label?: string;
  /** 是否启用（默认 true；false 灰显不可点击） */
  enabled?: boolean;
  /** 自定义点击行为。内置 delete/rename 的本地行为（本地卸载/唤起重命名）始终执行，
   *  此回调用于追加调用方自己的真实逻辑（如真正的删除/持久化）。
   *  若 key 不是内置动作，则仅执行此回调。 */
  onSelect?: (ctx: CarouselActionCtx) => void;
}

// 内置动作 SVG 图标（可被调用方以自定义 icon 覆盖）
const DownloadIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
);
const TrashIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
);
const RenameIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
);

function SwiperLoopCarousel({
  images: imagesRaw,
  onNeedMore,
  hasMore,
  renderOverlay,
  renderToolbar,
  extraToolbarItems,
  extraOverlayContent,
  isOpen: isOpenProp,
  initialIndex,
  onClose,
  onDownload,
  total: totalProp,
  persistSettings,
  actions,
  renameInputClassName,
  enableConcurrent,
  concurrency,
  minChunkBytes,
  connectRetryMs,
  enableConnectRetry,
  maxActiveImages,
  preloadRange,
  useCache,
  maxCache,
  loadDebounceMs,
  maxTasks,
  theme = "dark",
  deleteMode = "parallel",
  debugPanel = false,
}: {
  images: GalleryImage[];
  onNeedMore?: () => void;
  hasMore?: boolean;
  /** 自定义覆盖层内容。默认显示序号/总数 + alt + 尺寸 + 文件大小 */
  renderOverlay?: (props: { image: GalleryImage; index: number; total: number; isActive: boolean }) => ReactNode;
  /** 自定义工具栏。传入后整体替换默认工具栏 */
  renderToolbar?: (props: {
    realIndex: number;
    viewMode: 1 | 2 | 3;
    density: 1 | 2 | 3;
    setViewMode: (mode: 1 | 2 | 3) => void;
    setDensity: (d: 1 | 2 | 3) => void;
    goToIndex: (idx: number) => void;
    close: () => void;
    total: number;
    t: Record<string, string>;
  }) => ReactNode;
  /** 追加到默认工具栏右侧的额外按钮/内容，不替换默认工具栏 */
  extraToolbarItems?: ReactNode;
  /** 追加到覆盖层区域的额外内容（按钮、链接等），渲染在图片下方、缩略图上方 */
  extraOverlayContent?: (props: { image: GalleryImage; index: number; total: number; isActive: boolean }) => ReactNode;
  /** 受控模式：是否打开。undefined 时使用内部非受控状态 */
  isOpen?: boolean;
  /** 受控模式：打开时定位到第几张图片（默认 0） */
  initialIndex?: number;
  /** 受控模式：关闭回调。调用后由父组件将 isOpen 设为 false */
  onClose?: () => void;
  /** 下载回调。传入后默认覆盖层会显示下载按钮 */
  onDownload?: (index: number) => void;
  /** 图片总数（含未加载）。用于覆盖层显示 "3/10000"，默认取 images.length */
  total?: number;
  /** 是否将设置（视图模式、缩略图密度、滚轮功能）持久化到 localStorage。
   *  - true：使用默认存储键
   *  - string：使用自定义存储键（不同组件可共享或隔离配置）
   *  - undefined / false：不持久化（每次打开重置为默认值）
   */
  persistSettings?: boolean | string;
  /** 图片功能插槽：显示在图片名称栏同一容器内。调用方自由控制顺序、启停、图标与功能函数。
   *  内置动作 key：delete（本地卸载该图+飞出动画）、rename（唤起重命名输入）。
   *  内置动作的本地行为始终执行，onSelect 追加调用方真实逻辑；未传时仅内置动作。 */
  actions?: CarouselAction[];
  /** 重命名输入框的自定义类名，附加到默认样式之后。用于覆盖字体/颜色/尺寸等 */
  renameInputClassName?: string;
  /** 并发分块下载总开关（默认 true）。为 false 时退化为原生整图预加载 */
  enableConcurrent?: boolean;
  /** 分块段数（默认 6）。并发段数越多对单连接限速的突破越大，但连接数成本越高 */
  concurrency?: number;
  /** 分块大小阈值（默认 262144，256KB）。小于该字节数的文件不分块，首块请求即下载完整 */
  minChunkBytes?: number;
  /** 等待服务器响应（TTFB）超过该毫秒即重发本块；enableConnectRetry 为 true 时生效。默认 1000 */
  connectRetryMs?: number;
  /** 服务器响应超时重发机制开关（默认 true） */
  enableConnectRetry?: boolean;
  /** 同时下载的图片张数（默认 2）。避免大量图片同时分块导致带宽碎片化 */
  maxActiveImages?: number;
  /** 自动下载范围：数字 N 等价于 [-N, N]（默认，即左右各 1 张共 3 张）；
   *  传 [a, b] 表示 offset 从 a 到 b；传 [] 或 0 关闭自动预下载 */
  preloadRange?: number | [number, number] | [];
  /** URL 级结果缓存（默认 true）。同 URL 会话内只下载一次 */
  useCache?: boolean;
  /** blob URL 缓存上限（默认 80）。超限撤销最旧的 blob URL（豁免当前显示中的图片） */
  maxCache?: number;
  /** 快速切换防抖毫秒数（默认 120）。连续切换期间不加载，用户停顿后才加载 */
  loadDebounceMs?: number;
  /** 有界任务队列上限（默认 5）。新增任务时若已排满，直接停止末位任务 */
  maxTasks?: number;
  /** 整体配色主题："dark"（默认，黑色控件亮度较纯黑提升 10%）或 "light"（亮色）。调用方可按需切换 */
  theme?: CarouselTheme;
  /** 多图删除动画时序："parallel"（默认，吸入与图片运动/切换同时）、"serial"（吸入结束后再切换）。
   *  仅外部通过此参数控制；面板内可视化切换由 debugPanel 提供，不影响外部默认行为。 */
  deleteMode?: "serial" | "parallel";
  /** 是否显示右上角 Dev 调试面板（默认 false）。仅显式开启才渲染，外部引用不会出现。 */
  debugPanel?: boolean;
}) {
  const t = useCarouselI18n();
  const lang = useCarouselLang();
  // 主题令牌：驱动箭头、右下角切换菜单等控件的配色，随 theme 切换
  const themeTokens = THEMES[theme];

  // ── 图片本地卸载 / 重命名（预览级，不改动调用方数组）──
  // 删除：把图片 id 记入 removedIdsRef，下游（n、preloader、slides、缩略图、计数）
  // 通过 liveImages 统一过滤，索引自动重排；真实删除由调用方在 action.onSelect 里完成。
  const removedIdsRef = useRef<Set<number>>(new Set());
  const [removeEpoch, setRemoveEpoch] = useState(0);
  // 删除提交后递增：驱动活跃行"未被删除的幸存图"按切换动画重放入场
  const [deleteEpoch, setDeleteEpoch] = useState(0);
  // 串行删除门控：false=吸入阶段（右段与新入图静止，仅吸入动画在跑），true=切换阶段（入场+补位平移）。
  // 吸入结束时由 Timer A 置 true，驱动 deleteEntryTarget 生效。
  const [deleteMotionStarted, setDeleteMotionStarted] = useState(false);
  // 最近一次删除的被删图下标（重排前的原始下标）。渲染时据此判断某图是否位于被删图右侧：
  // 仅右侧幸存图(index >= 该值)重放"下一张"切换动画，左侧幸存图保持不动。
  const lastDeletedIndexRef = useRef<number>(-1);
  // 被删图右侧、仍活跃的幸存图的 img.id → 删除静置时刻（performance.now，ms）。
  // 用时间戳 Map 而非 Set：删除重排/复位会让组件多次重挂载，时间戳跨重挂载稳定；
  // 且"新鲜度"判定取代定时清空，避免快速连续删除时清空早于/晚于复位延迟事件，
  // 导致已到位的幸存卡在 deleteFillTarget 失效后被重新判为新图而重放一次入场动画。
  const relocateFillIdsRef = useRef<Map<number, number>>(new Map());
  // 仅"右幸存图"（不含右侧新进入的 incoming）的 img.id → 静置时刻：重排后这些图已就地移动到位，
  // 顶部名称/功能按钮栏重挂载时须跳过入场淡入，避免"平移到位了名称又加载一遍"。
  const relocateSurvivorFillIdsRef = useRef<Map<number, number>>(new Map());
  // 删除的重排(removeEpoch)是否已提交：提交后禁止再触发"左移补位"（重排前的窗口专属）。
  // 提交后保持 true 直到下一次删除开始（flyOutAndRemove 置回 false），不再定时清空。
  const deletingReshapedRef = useRef(false);
  // ===== 源码级删除平移：共享 groupShiftX =====
  // 删除活跃行（含行首）时，被删图右侧的"整段"图由**单个共享 motion 值** groupShiftX 一次性平滑
  // 左移一格：算法层只维护这一次动画（同一动画源 → 多卡零失步，观感等同"下一张"wrapper 平移）；
  // 被删图左侧的图不绑定该值 → 源码层面天然原地不动，无需逐卡补位，也无需反向补偿。
  const groupShiftX = useMotionValue(0);
  const groupShiftAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  // ===== 缩略图条删除合并：共享 thumbGroupShiftX =====
  // 与主图 groupShiftX 同思路：删除发生时，被删缩略图右侧"整段"缩略图由同一个共享 motion 值
  // 一次性平滑左移一格（飞出与合并**同帧**进行，而不是等 460ms 重排后才靠拢）；重排时归零，视觉连续。
  const thumbGroupShiftX = useMotionValue(0);
  const thumbGroupShiftAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  // ===== 删除动画串行化 =====
  // 连续删除时，若上一个删除仍处在其动画窗口内（重排/复位未完成），后到的删除若立即执行，会与
  // 连续的共享 groupShiftX / lastDeletedIndexRef：第二个删除重启动共享平移时从"上一个
  // 删除已冻结的中间位移"出发，且被删图右侧段成员随 lastDeleted 改写而变，导致"第二次删除右侧无
  // 平移、"被删图回到原位再消失、最终跳着到位"的并发失真。因此用一把同步锁把删除动画严格串行：
  // 一次只播放一个删除动画，后到的删除先入队，等当前删除重排提交、wrapper 复位稳定后再按 img.id
  // 在最新数组中定位并依次应用。单张删除（最常见路径）不受影响，仍即时播放。
  const serialDeleteLockRef = useRef(false);
  const pendingDeleteQueueRef = useRef<GalleryImage[]>([]);
  // 删除代际计数：每次删除开始递增，供"延迟复位（runReset 重试链）"做代际守卫。
  // 上一轮删除的 runReset 若在主线程繁忙时拖延到下一轮删除动画期间才执行，
  // 会用 groupShiftX.set(0)/slideToLoop 拨动正在播放的新删除动画（平移图回弹、
  // 被删图动画被重置）。代际不一致即中止，复位职责移交新一轮删除自己。
  const deleteGenRef = useRef(0);
  // 触发后续删除的当前 flyOutAndRemove（ref 恒指向最新闭包，重排后仍能按最新 images 定位）
  const flyOutAndRemoveRef = useRef<(index: number, img: GalleryImage) => void>(() => {});
  // 当前删除重排提交后，等待 Swiper 复位稳定再应用队列内下一张删除的缓冲（ms）。
  // 需覆盖 runReset(setTimeout 0) 及 loop 复位的 rAF 延迟，又远小于一次真实删除周期，体验近无感。
  const DELETE_SERIAL_BUFFER_MS = 260;
  // canSlide 删除的 Swiper 复位期间：抑制 handleSlideChange 对 realIndex 的同步。
  // loop 模式 reset 会经过 slideToLoop 的中间循环位并触发 slideChange，把 realIndex 短暂拨到
  // 别处——幸存的活跃卡随之 isActive 闪断、wasActiveRef 被重置为 false，复位完成后又恢复 active，
  // 导致它被当作"新图"重放一次"缩放+淡入"二次入场。删除已把 realIndex 固定为 R，复位期间只需
  // 维持该值，因此整体忽略复位期间的 slideChange。
  const suppressRealIndexSyncRef = useRef(false);
  // 复位后延迟 slideChange 的抑制截止时刻：slideToLoop 内部经 requestAnimationFrame 延迟执行
  // slideTo、loopFix 也可能再同步/异步拨动一次，这些 slideChange 在同步块结束后才触发，
  // 仅靠 suppressRealIndexSyncRef 会漏网。用时间戳把抑制窗口延伸到复位之后，覆盖全部延迟事件。
  const resetSuppressUntilRef = useRef(0);
  // 复位后延迟 slideChange 的抑制窗口（ms）：覆盖 slideToLoop 的 rAF 延迟 + loopFix 的连锁拨动。
  // 快速连续删除时主线程繁忙，rAF 延迟的 slideTo 可能晚于 300ms 才触发 slideChange；
  // 放宽到 500ms，确保复位产生的全部延迟事件都落在抑制窗口内。
  const RESET_SUPPRESS_MS = 500;
  // 删除静置标记（relocateFillIdsRef / relocateSurvivorFillIdsRef）的新鲜度窗口（ms）。
  // 须覆盖"重排(460) + Swiper 复位(500) + 复位抑制(500) + rAF 连锁拨动余量"，
  // 窗口内重挂载/抖动的幸存卡仍按"已静置"处理，不再重放入场动画；窗口外自然失效。
  const DELETE_FILL_VALID_MS = 2000;
  // 删除后的"Swiper 复位"定时器：连续删除时防抖，只保留"最近一次提交"之后的那一份。
  // 若不合并，残留的多套 500ms 定时器会在最后一张图已静置稳定后异步晚触发——再次
  // updateSlides/slideTo 拨动 Swiper 触发 slideChange，导致已到位的图被重新判为新图。
  const settleResetTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (settleResetTimerRef.current != null) window.clearTimeout(settleResetTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 惰性清理：删除开始时剔除已过期（超过 DELETE_FILL_VALID_MS）的静置标记；
  // 全部过期后复位 lastDeletedIndexRef / deletingReshapedRef，让后续渲染恢复正常判定。
  // 不再用定时器清空集合：快速连续删除时定时清空会与复位延迟事件竞争，导致已到位的图
  // 在 deleteFillTarget 失效后被重新判为新图而重放一次入场动画（"到位后又闪一下入场"）。
  const pruneDeleteFillState = useCallback(() => {
    const now = performance.now();
    for (const [id, ts] of relocateFillIdsRef.current) {
      if (now - ts > DELETE_FILL_VALID_MS) relocateFillIdsRef.current.delete(id);
    }
    for (const [id, ts] of relocateSurvivorFillIdsRef.current) {
      if (now - ts > DELETE_FILL_VALID_MS) relocateSurvivorFillIdsRef.current.delete(id);
    }
    if (relocateFillIdsRef.current.size === 0) {
      lastDeletedIndexRef.current = -1;
      deletingReshapedRef.current = false;
    }
  }, []);
  const liveImages = useMemo(() => {
    if (removedIdsRef.current.size === 0) return imagesRaw;
    return imagesRaw.filter((img) => !removedIdsRef.current.has(img.id));
  }, [imagesRaw, removeEpoch]);
  // 删除后进行本地卸载（勿触发本组件的 reopen/缩略图重选）；区分 by-id 占位避免与真实关闭混淆
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // 重命名：id -> 新名称（本地即时生效，动态可变）。真实持久化由调用方完成。
  const renamedMapRef = useRef<Map<number, string>>(new Map());
  const [renameSeq, setRenameSeq] = useState(0);
  const [renameState, setRenameState] = useState<{ id: number; value: string } | null>(null);
  // 让下游全部基于有效列表工作（indexed by liveImages）
  const images = liveImages;
  // 供串行化删除的队列接力读取"最新"数组（删除重排提交后闭包里的 images 已过期）
  const imagesRef = useRef(images);
  imagesRef.current = images;
  // 原始数组的实时 ref：队列接力需在"渲染期 imagesRef 尚未更新"时也能拿到最新有效列表，
  // 用"原始数组 + 已删除集合（ref，同步更新）"实时过滤，避免依赖渲染时机。
  const imagesRawRef = useRef(imagesRaw);
  imagesRawRef.current = imagesRaw;
  const [activeId, setActiveId] = useState<number | null>(null);
  const isControlled = isOpenProp !== undefined;
  const isOpen = isControlled ? isOpenProp : activeId !== null;
  const [realIndex, setRealIndex] = useState(0);
  const [viewMode, setViewMode] = useState<1 | 2 | 3>(() => {
    if (!persistSettings) return 1;
    const s = loadPersistedSettings(typeof persistSettings === "string" ? persistSettings : DEFAULT_PERSIST_KEY);
    return s?.viewMode ?? 1;
  });
  const [viewModeEpoch, setViewModeEpoch] = useState(0);
  const swiperRef = useRef<SwiperClass | null>(null);
  // .swiper-wrapper 元素：虚拟模式图片分层经 createPortal 渲染到该节点内，继承 Swiper 的 transform
  const wrapperElRef = useRef<HTMLElement | null>(null);
  // Swiper 已挂载且有 wrapper 节点后置真，触发分层 portal 渲染
  const [virtualReady, setVirtualReady] = useState(false);
  const initialLoadRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [isStripDragging, setIsStripDragging] = useState(false);
  const [dragMoved, setDragMoved] = useState(false);
  // 当前正在被手指/指针拖动的图片索引；拖拽时其溢出滑片的部分会以半透明显示
  const [imgDraggingIdx, setImgDraggingIdx] = useState<number | null>(null);
  const [stripDensityLevel, setStripDensityLevel] = useState<1 | 2 | 3>(() => {
    if (!persistSettings) return 3;
    const s = loadPersistedSettings(typeof persistSettings === "string" ? persistSettings : DEFAULT_PERSIST_KEY);
    return s?.stripDensityLevel ?? 3;
  });
  const [isKeyboardActive, setIsKeyboardActive] = useState(false);
  const isKeyboardActiveRef = useRef(false);
  useEffect(() => { isKeyboardActiveRef.current = isKeyboardActive; }, [isKeyboardActive]);
  // ===== Dev 调试控制面板（仅非生产构建生效；生产构建 process.env.NODE_ENV === 'production'
  // 使 `isDev && ...` 的浮层 JSX 整体被 DCE 排除，状态恒为默认值零开销）=====
  const isDev = process.env.NODE_ENV !== "production";
  const [devPanelOpen, setDevPanelOpen] = useState(false);
  // Dev 面板对 deleteMode 的临时覆盖（null=不覆盖，沿用 deleteMode prop）。仅供面板实测，不影响外部。
  const [devSerialOverride, setDevSerialOverride] = useState<boolean | null>(null);
  // 最终是否串行：dev 覆盖优先，否则取 deleteMode prop（默认 parallel）。
  const serialAnim = devSerialOverride ?? (deleteMode === "serial");
  // 隐藏底部缩略图条
  const [devHideThumbs, setDevHideThumbs] = useState(false);
  // 关闭"被删除图片"的飞出/吸入动画（改为瞬时移除）
  const [devDisableDeleteAnim, setDevDisableDeleteAnim] = useState(false);
  // 关闭"右侧幸存图"的补位平移动画（改为瞬时落位）
  const [devDisableSurvivorAnim, setDevDisableSurvivorAnim] = useState(false);
  // 隐藏主图（大图本身）
  const [devHideMainImage, setDevHideMainImage] = useState(false);
  // 用于检测 isKeyboardActive 是否刚从 true→false（长按松开），避免挂载时误触恢复逻辑
  const prevHoldRef = useRef(false);
  const [pendingRealIndex, setPendingRealIndex] = useState(0);
  const pendingRealIndexRef = useRef(0);
  const stripX = useMotionValue(0);
  const stripScale = useMotionValue(1);
  const stripAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const stripDragRef = useRef({
    startX: 0,
    startIdx: 0,
    moved: false,
    delta: 0,
  });
  const [stripDragVisibleIdx, setStripDragVisibleIdx] = useState(0);
  const stripDragVisibleIdxRef = useRef(0);
  const stripDragIdxRafRef = useRef<number | null>(null);
  // 已预加载的缩略图 URL 集合：避免同一 URL 重复 new Image() 预加载
  const thumbPreloadCacheRef = useRef<Set<string>>(new Set());
  // 删除窗口内为"新入图"缩略图做即时预载的缓存去重：删除入口显式 new Image() 预热，避免重复请求
  const warmedThumbCacheRef = useRef<Set<string>>(new Set());
  // 缩略图自然尺寸（img.id -> {w,h}）：原图未就绪时，视图切换的缩放补偿（entryScaleFrom）需要按
  // "当前实际显示内容"（缩略图）的宽高比计算，否则退化为 newVM/prevVM 会因宽高比不符而"中心图突然放大"。
  // 以 img.id 为键，避免删除重排后索引漂移。
  const thumbDimsRef = useRef<Map<number, { w: number; h: number }>>(new Map());
  // 由 ThumbnailItem 在缩略图实际加载完成时回调记录自然尺寸（比预加载 Image 的 onload 更即时可靠）
  const recordThumbDim = useCallback((id: number, w: number, h: number) => {
    if (w > 0 && h > 0) thumbDimsRef.current.set(id, { w, h });
  }, []);
  // 缩略图 JSX 缓存：offsetX 改为绝对索引定位后，切图时仅重建 active 变化的项，
  // 其余项复用缓存元素，避免每次点击重建 41 个 ThumbnailItem（实测 ~25ms/点击）
  const stripItemCacheRef = useRef<Map<number, React.ReactElement<ThumbnailItemProps>>>(new Map());
  // 缩略图当前绝对 X 位置（按 img.id）。删除后索引重排时，据此算出"旧→新位置"差值
  // 作为 animOffsetX，驱动其余缩略图平滑靠拢（FLIP）。每次 stripItems 重算时重建。
  const thumbPositionsRef = useRef<Map<number, number>>(new Map());
  const keyboardHoldTimerRef = useRef<number | null>(null);
  const keyboardHoldStartRef = useRef(0);
  const closeSuppressedRef = useRef(false);
  // 图片拖拽期间置真：拖拽开始后到"下一次新交互(pointerdown)"之前，一律抑制根节点关闭。
  // 精确拦截拖拽释放后紧邻的那一次 click（pointerdown 尚未发生），且不误吞后续正常点击。
  const imageDragSuppressedRef = useRef(false);
  // 删除期间的关闭抑制截止时刻：删除动画（飞出 0.4s + 重排 460ms + 名称栏重新淡入）期间，
  // 删除按钮/名称栏尚未到位，若点到空白处会误触关闭。此窗口内一律不响应 overlay 空白点击。
  const deleteCloseSuppressUntilRef = useRef(0);
  // 删除关闭抑制窗口（ms）：覆盖 0.4s 飞出 + 460ms 重排 + 名称栏 0.3s 延迟 + 0.35s 淡入 + 余量。
  const DELETE_CLOSE_SUPPRESS_MS = 1400;
  const capturedBaseXRef = useRef(0);
  const wrapTimerRef = useRef<number | null>(null);
  const holdDirectionRef = useRef<"left" | "right" | null>(null);
  const atEndRef = useRef(false);
  const postWrapRef = useRef(false);
  const buttonHoldTimerRef = useRef<number | null>(null);
  const preViewModeIndexRef = useRef(0);
  const isViewModeChangingRef = useRef(false);
  const [prevViewMode, setPrevViewMode] = useState<1 | 2 | 3>(1);
  const prevViewModeRef = useRef<1 | 2 | 3>(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [wheelMode, setWheelMode] = useState<"zoom" | "switch">(() => {
    if (!persistSettings) return "zoom";
    const s = loadPersistedSettings(typeof persistSettings === "string" ? persistSettings : DEFAULT_PERSIST_KEY);
    return s?.wheelMode ?? "zoom";
  });
  const wheelModeRef = useRef(wheelMode);
  useEffect(() => { wheelModeRef.current = wheelMode; }, [wheelMode]);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-dropdown]")) setOpenMenu(null);
    };
    document.addEventListener("mousedown", handler, true);
    document.addEventListener("touchstart", handler, true);
    return () => {
      document.removeEventListener("mousedown", handler, true);
      document.removeEventListener("touchstart", handler, true);
    };
  }, [openMenu]);

  // 拖拽结束后，任何新交互(pointerdown)开始即复位图片拖拽的关闭抑制。
  // 确保只拦截"拖拽释放后紧邻的那一次 click"，不误吞后续正常点击关闭。
  useEffect(() => {
    const reset = () => {
      imageDragSuppressedRef.current = false;
    };
    window.addEventListener("pointerdown", reset, true);
    return () => window.removeEventListener("pointerdown", reset, true);
  }, []);

  // 持久化设置到 localStorage
  useEffect(() => {
    if (!persistSettings) return;
    const key = typeof persistSettings === "string" ? persistSettings : DEFAULT_PERSIST_KEY;
    savePersistedSettings(key, { viewMode, stripDensityLevel, wheelMode });
  }, [persistSettings, viewMode, stripDensityLevel, wheelMode]);

  const lastDragTimeRef = useRef(0);
  // 标记 handleUp 是否执行了拖拽导航，用于抑制紧随其后的缩略图 click
  // 比 moved/delta/lastDragTimeRef 更可靠：只在真正拖拽导航时置 true，pointerDown 时重置
  const thumbClickSuppressedRef = useRef(false);
  const realIndexRef = useRef(0);
  // 滑动方向：1 = 向右切换（图片从右侧进入），-1 = 向左切换（图片从左侧进入）
  // 纯 ref，不触发重渲染。AnimatedSlideImg 通过 slideDirectionRef 读取
  const slideDirectionRef = useRef<1 | -1>(1);
  // 跟踪哪些图片的 motion 值被修改过（非默认值），close 时只重置这些图片
  const dirtyMotionIndicesRef = useRef<Set<number>>(new Set());
  const isZoomedRef = useRef(false);
  const [isPinching, setIsPinching] = useState(false);
  const isPinchingRef = useRef(false);
  useEffect(() => { isPinchingRef.current = isPinching; }, [isPinching]);
  const [isTransitioningViewMode, setIsTransitioningViewMode] = useState(false);
  // 普通"上一张/下一张"滑动过渡的进行态（Swiper wrapper 平移，React 无对应状态）。
  // 过渡期间非活跃邻图（正在退出的上一张/进入的下一张）必须在画布上可见，避免被
  // 半透明框架的"空闲时隐藏邻图"逻辑（neighborHidden）在飞出一开始就隐藏——那会让
  // 切换时看不到左边的图飞出。过渡结束（transitionEnd）后回到隐藏状态，防边缘泄漏不变。
  const [isSwipeAnimating, setIsSwipeAnimating] = useState(false);

  // 已实际加载完成的缩略图 src 集合（由 AnimatedSlideImg 在上报 onThumbLoaded 时写入）。
  // 切换动画期间原图未就绪时：只有缩略图已就位才用缩略图兜底、不再叠加转圈；
  // 缩略图都未就绪（连续快速点击导致）时才以转圈作占位。动画结束后恢复"原图未就绪即转圈"。
  const thumbLoadedRef = useRef<Set<string>>(new Set());
  const [, setThumbTick] = useState(0);
  const onThumbLoaded = useCallback((thumbKey: string) => {
    if (thumbKey && !thumbLoadedRef.current.has(thumbKey)) {
      thumbLoadedRef.current.add(thumbKey);
      setThumbTick((t) => t + 1);
    }
  }, []);

  // 统一的视图模式切换入口：冻结 wrapper → 标记过渡 → 切换 viewMode。
  // 手动切换（底部下拉、renderToolbar）与按图片数量自动收敛共用，保证自动切换与
  // 手动切换走同一套"逐卡重排 + 平移/缩放"过渡动画（isTransitioningViewMode 驱动）。
  const changeViewMode = useCallback(
    (mode: 1 | 2 | 3) => {
      if (mode === viewMode) return;
      preViewModeIndexRef.current = realIndexRef.current;
      prevViewModeRef.current = viewMode;
      setPrevViewMode(viewMode);
      const s = swiperRef.current;
      if (s && !s.destroyed) {
        const wrapper = s.wrapperEl as HTMLElement;
        wrapper.style.transition = "none";
        wrapper.style.transform = window.getComputedStyle(wrapper).transform;
        s.params.speed = 0;
      }
      isViewModeChangingRef.current = true;
      setIsTransitioningViewMode(true);
      // 视图切换：若只"animate 外层缩放/拖拽到默认"，再叠加 entryScaleFrom/entryXFrom 补偿，
      // 两层会叠加成"起始位置/大小偏离当前缩放与拖拽值"。改为：先把当前外层缩放/拖拽快照下来，
      // 并立即把外层置为身份变换；随后 AnimatedSlideImg 用快照折算的 entryScaleFrom/entryXFrom
      // 从"当前缩放+拖拽"出发连续过渡到新模式的默认尺寸（见 renderSlideInner）。
      const snapBase = realIndexRef.current;
      const snapMax = Math.max(viewMode, mode);
      for (let k = 0; k < snapMax + 1; k++) {
        const m = imageMotionsMapRef.current.get(snapBase + k);
        if (!m) continue;
        viewSwitchFromRef.current.set(snapBase + k, { scale: m.scale.get(), x: m.x.get(), y: m.y.get() });
        m.scale.set(1);
        m.x.set(0);
        m.y.set(0);
      }
      setViewMode(mode);
      setViewModeEpoch((e) => e + 1);
    },
    [viewMode]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const pinchStateRef = useRef<{
    initialDist: number;
    initialScale: number;
    idx: number;
  } | null>(null);

  // 每张图片独立的 motionX/Y/Scale（按 images 数组下标存储，切换时不会互相影响）
  // 懒加载：只在 slide 实际渲染时创建 MotionValue，避免 2000 张图一次性创建 6000 个对象
  const imageMotionsMapRef = useRef<Map<number, ImageMotions>>(new Map());
  // 视图切换前各可见卡"外层缩放/拖拽"快照（index -> {scale,x,y}）。
  // 外层变换（motionsNow.scale/x/y）与被放大图冲突：切换若一边 animate 外层到默认、一边用
  // entryScaleFrom/entryXFrom 补偿，两层会叠加成"起始位置/大小偏离当前缩放与拖拽值"。改为切换瞬间
  // 把外层置为身份变换，并把当前缩放/拖拽折算进内层 entryScaleFrom/entryXFrom 的起始值，使动画
  // 严格从"当前缩放+拖拽"出发、连续过渡到新模式的默认尺寸。
  const viewSwitchFromRef = useRef<Map<number, { scale: number; x: number; y: number }>>(new Map());
  const getOrCreateImageMotions = useCallback((index: number): ImageMotions => {
    let m = imageMotionsMapRef.current.get(index);
    if (!m) {
      m = { x: new MotionValue(0), y: new MotionValue(0), scale: new MotionValue(1), entryX: new MotionValue(0), opacity: new MotionValue(1), rotate: new MotionValue(0) };
      imageMotionsMapRef.current.set(index, m);
    }
    return m;
  }, []);

  // 视图模式切换时：需要保留每张图的拖拽 x/y 偏移（拖到右侧是有意为之），
  // 但在过渡动画期间滑片需保持 overflow-hidden 裁剪，使被拖拽溢出到右侧的部分不会盖住相邻图。
  const preloader = useImagePreloader(images, {
    enableConcurrent,
    concurrency,
    minChunkBytes,
    connectRetryMs,
    enableConnectRetry,
    maxActiveImages,
    preloadRange,
    useCache,
    maxCache,
    loadDebounceMs,
    maxTasks,
  });

  // 通过 e.target (HTMLElement) 找到当前指针下方的图片下标；找不到时回退到 realIndex
  const resolveImgIndexFromTarget = useCallback((target: EventTarget | null): number => {
    let el = target as HTMLElement | null;
    while (el && el !== document.body) {
      const attr = el.getAttribute?.("data-img-index");
      if (attr != null) {
        const idx = Number(attr);
        if (!Number.isNaN(idx)) return idx;
      }
      el = el.parentElement;
    }
    return realIndexRef.current;
  }, []);

  const n = images.length;
  const totalCount = totalProp ?? n;
  const step = 1;

  // ── 图片功能：显示名 / 删除 / 重命名 ──
  // 显示名优先取本地重命名覆盖，其次取原 alt（快速重命名时能即时反映在名称栏）
  const displayAlt = (img: GalleryImage) => renamedMapRef.current.get(img.id) ?? img.alt;

  // 删除：播放飞出动画，动画结束后把 id 记入 removedIds，触发 liveImages 过滤（索引重排、
  // 顶部计数、底部缩略图随之更新）。真实删除交给 action.onSelect 由调用方完成。
  const flyOutAndRemove = useCallback(
    (index: number, img: GalleryImage, target?: { x: number; y: number }, imgEl?: HTMLImageElement | null) => {
      if (deletingId === img.id || removedIdsRef.current.has(img.id)) return;
      // 串行化锁：当前已有删除动画在窗口内（含重排/复位阶段）时，本删除先入队，
      // 待其完整结束后（见下方 setTimeout）按 img.id 在最新数组中定位再应用。避免并发共享
      // groupShiftX/lastDeletedIndexRef 导致的"第二次删除右侧段无平移、被删图回弹、跳着到位"。
      if (serialDeleteLockRef.current) {
        pendingDeleteQueueRef.current.push(img);
        return;
      }
      serialDeleteLockRef.current = true;
      // 惰性清理上一轮已过期的静置标记（新鲜度窗口外自然失效，取代定时清空）
      pruneDeleteFillState();
      // 删除动画期间抑制 overlay 空白点击关闭：删除按钮/名称栏尚未到位，防误触退出。
      deleteCloseSuppressUntilRef.current = performance.now() + DELETE_CLOSE_SUPPRESS_MS;
      // ===== 新一轮删除：先清算上一轮的残留，保证动画从干净基线出发 =====
      // 1) 递增删除代际：令任何仍在运行/待运行的旧复位（runReset 重试链）失效，避免其在本轮
      //    动画期间执行 groupShiftX.set(0)/slideToLoop 拨动（症状：平移图"直接到位又弹回去"、
      //    被删图动画被重置）。
      deleteGenRef.current++;
      // 2) 取消上一轮尚未执行的复位定时器（已开始运行的由代际守卫兜底）。
      if (settleResetTimerRef.current != null) {
        window.clearTimeout(settleResetTimerRef.current);
        settleResetTimerRef.current = null;
      }
      // 3) 上一轮若复位被拖延，groupShiftX 可能仍冻结在 -一格：先归零到干净基线，
      //    保证本轮 animate(groupShiftX, -shift) 从 0 出发（否则起点已到位 → 平移图无位移"无反应"）。
      //    注意：这里不把 groupShiftAnimRef.current 置 null —— 本轮后续 groupShift 动画会重新赋值；
      //    且避免 TS 在本函数体内把 current 收窄为 null 而破坏后续既有的 current?.stop()。
      groupShiftX.set(0);
      groupShiftAnimRef.current?.stop();
      // 缩略图条共享平移同步归零（与主图 groupShiftX 同理，保证新删除的合并从 0 出发）。
      thumbGroupShiftX.set(0);
      thumbGroupShiftAnimRef.current?.stop();
      setDeletingId(img.id);
      setDeleteMotionStarted(!serialAnim); // 串行:先进吸入阶段(右段与新入图静止);并行:立即 true → 入场/平移同帧触发
      // 上一删除可能仍在"重排已提交"抑制窗口内：新删除必须立即退出该窗口，
      // 否则 deleteShiftActive/deleteEntryTarget 里的 !deletingReshapedRef 判定为假，
      // 本次补位/入场动画整组失效（表现为"原地消失后从右侧飞入"的概率性跳变）。
      deletingReshapedRef.current = false;
      // 注意：不能在删除开始时清空 relocateFillIdsRef / relocateSurvivorFillIdsRef。
      // 快速连续删除时，前一次删除的幸存图/incoming 图尚未重排重挂载，若在此清空，
      // 它们重排到位后 deleteFillTarget 会判定为假 → 又走一次入场飞入（到位后再闪一下）。
      // 集合应累积，时间戳在重排提交时统一刷新，交给新鲜度判定自然失效。
      const m = getOrCreateImageMotions(index);
      const wasReal = realIndexRef.current;
      // 记录被删图下标（重排前的原始下标）：右侧整段靠它判定是否共享平移
      lastDeletedIndexRef.current = index;
      // 删除动画：Canvas 覆盖层"吸入"——忠实还原 examples/ui/吸入动画 的网格形变动画。
      // 连续删除（排队项）无事件上下文，且 DOM 已因前序删除重排；此时从 DOM 实时解析
      // 删除按钮中心与同幻灯片主图，保证每次吸入都有正确的目标与网格形变（不回退到无扭曲兜底）。
      let effTarget = target;
      let effImgEl = imgEl;
      if (!effTarget || !effImgEl || !effImgEl.isConnected) {
        const resolved = resolveSuctionTargets(index);
        if (!effTarget && resolved.target) effTarget = resolved.target;
        if ((!effImgEl || !effImgEl.isConnected) && resolved.imgEl) effImgEl = resolved.imgEl;
      }

      // 目标 = 删除按钮中心（运行时获取，不写死像素）；卡片尺寸 = 删除前图片的真实可见矩形。
      // 方案B错峰：吸口 canvas 初始化（建 canvas + append 触发 layout、纹理 drawImage、网格顶点构建）
      // 是删除点击帧的主线程重活（trace 里 ~19.5ms 长任务），会挤占右侧平移/缩略图合并动画的首帧。
      // 先把轻量的缩略图合并（thumbGroupShiftX）同步送出（缩略图动画保持原时序不变），主图右段共享平移
      // groupShiftX 则延后到吸入结束再启动（串行，见 Timer A）；再在下一帧 rAF 初始化吸口并隐藏 DOM 图。
      // suctionOverlay 已做"首帧同步绘制"，故 rAF 回调里 canvas 立即接管画面，不会出现空档。
      const runFallbackSuction = () => {
        const suckX = Math.max(120, containerWidth * 0.38);
        const suckY = Math.max(80, containerHeight * 0.38);
        animate(m.scale, 0.02, { duration: 0.4, ease: [0.55, 0, 1, 0.45] });
        animate(m.x, suckX, { duration: 0.4, ease: [0.55, 0, 1, 0.45] });
        animate(m.y, -suckY, { duration: 0.4, ease: [0.55, 0, 1, 0.45] });
        animate(m.opacity, 0, { duration: 0.4, ease: "easeIn" });
        animate(m.rotate, 14, { duration: 0.4, ease: [0.55, 0, 1, 0.45] });
      };
      // Dev: 关闭"被删图"动画 → 瞬间隐藏 DOM（后续仍走 460ms 重排移除）。
      // 删除均使用吸入 canvas（被删图网格形变吸入删除钮）。单图模式新入图不在吸入期间同时切换——
      // 改为吸气完成后（重排时）再播放切换入场（见 reflowIncoming 抑制与 deleteEntryTarget 的 viewMode 门控），
      // 二者串行、互不遮挡。
      if (devDisableDeleteAnim) {
        m.opacity.set(0);
      } else if (effTarget && effImgEl && effImgEl.isConnected) {
        requestAnimationFrame(() => {
          if (effImgEl.isConnected) {
            // 被删图若已被缩放/拖拽到超滑片边界：把吸入卡片 clamp 到"其所在滑片可见区"，
            // 删除动画不突破拖拽框定的边界（传入 imgEl 最近 [data-img-index] 的 rect 作 crop）。
            const slideRoot = effImgEl.closest("[data-img-index]") as HTMLElement | null;
            const crop =
              slideRoot && slideRoot.isConnected
                ? (() => {
                    const r = slideRoot.getBoundingClientRect();
                    return { x: r.left, y: r.top, w: r.width, h: r.height };
                  })()
                : undefined;
            playSuction({
              imgEl: effImgEl,
              target: effTarget,
              durationMs: DELETE_SUCTION_MS,
              crop,
              // 单图+并行：吸入层挂 .swiper（wrapper 的直接父），z-index:-1 → 与 wrapper(z auto=0) 同处 .swiper 上下文，
              // wrapper 整体稳定盖住吸入层 → 新入图(在 wrapper 内)不被遮挡；避开吸入挂进 wrapper 的 transform 上下文造成的堆叠歧义。
              // 其余（多图/串行）传 undefined → 维持挂 body + fixed + 最大 z（行为零变）。
              container: !serialAnim && viewMode === 1 ? (swiperRef.current?.el ?? undefined) : undefined,
            });
            m.opacity.set(0); // 隐藏原 DOM 图，交由 canvas 覆盖层呈现吸入过程
          } else {
            runFallbackSuction();
          }
        });
      } else {
        runFallbackSuction();
      }

      // ===== 缩略图条：被删缩略图右侧整段同帧左移一格（与飞出/主图右侧段同步） =====
      // 用一个共享 thumbGroupShiftX（0 → -一格槽距）驱动，重排时归零，绝无回弹。
      // Dev: devDisableSurvivorAnim 时关闭"幸存图补位平移动画"（缩略图条与主图右侧整段都不平移，瞬时落位）。
      if (!devDisableSurvivorAnim) {
        thumbGroupShiftAnimRef.current?.stop();
        thumbGroupShiftAnimRef.current = animate(
          thumbGroupShiftX,
          -(THUMB_SIZE + THUMB_GAP),
          { duration: 0.4, ease: "easeOut" }
        );
      }

      // ===== 删除发生在活跃行内 → 右段"共享平移补位"（串行：吸入结束后才启动） =====
      // 右侧所有图左移一格表达为共享 motion 值 groupShiftX 从 0 → -一格槽距：右侧每卡读同一值 →
      // 一次 wrapper 级平滑整段移动（单动画源零失步）；左侧卡不读 → 原地不动。与切换同速、同位移。
      // 串行观感：吸入阶段 groupShiftX 恒为 0（右段静止），吸入结束（Timer A）才 animate。
      // 单图（viewMode===1）无其它可见幸存图 → 本就跳过该平移。
      const beginSwitchMotion = () => {
        // 并行：与原实现一致，不额外限定 viewMode>1；串行：仅多图需共享平移（单图无右幸存段）。
        if ((!serialAnim || viewMode > 1) && index >= wasReal && index < wasReal + viewMode && !devDisableSurvivorAnim) {
          const gGap = viewMode > 1 ? 8 : 0;
          const gSlotW = containerWidth > 0 ? (containerWidth - (viewMode - 1) * gGap) / viewMode : containerWidth;
          const gShift = containerWidth > 0 ? gSlotW + gGap : 0;
          if (gShift > 0) {
            groupShiftAnimRef.current?.stop();
            groupShiftAnimRef.current = animate(groupShiftX, -gShift, { duration: DELETE_MOTION_MS / 1000, ease: "easeOut" });
          }
        }
      };

      // ===== 删除：目标 =====
      // 被删图自身向上缩小飞出；其右侧整段图由共享 groupShiftX 一次性平滑左移一格（同上 0.4s 同步），
      // 观感等同"下一张"切换的连续平移；重排(removeEpoch)延后到动画结束再提交，落位无感。
      slideDirectionRef.current = index < wasReal || index >= n - 1 ? -1 : 1;
      // 记录删除窗口内被"共享平移"移动过的图（按 img.id 记，跨重挂载稳定）：
      // - 被删图右侧、仍活跃的幸存图：随共享值左移一格补位；
      // - 从右侧进入新末位的下一张图（realIndex+viewMode）：同段左移入场。
      // 两者重排后都须静置到位，不再二次动画。时间戳先占位，重排提交时统一刷新为静置时刻。
      if (index >= wasReal && index < wasReal + viewMode) {
        for (let k = index + 1; k < wasReal + viewMode && k < n; k++) {
          const sib = images[k];
          if (sib && !removedIdsRef.current.has(sib.id)) {
            relocateFillIdsRef.current.set(sib.id, 0);
            relocateSurvivorFillIdsRef.current.set(sib.id, 0);
          }
        }
        // incoming（realIndex+viewMode，单图/双图/三图一致）：删除窗口内是 rider + deleteEntryTarget，
        // 已播"与切换 next 同源"的入场。**不能**在此把 incoming 塞进 relocateFillIds（占位 0 会让它在
        // 删除窗口内首次挂载时就因 deleteFillTarget=true 被静置，deleteEntryTarget 入场被整段跳过
        // —— 这正是单图删除新入图动画"完全消失"的根因）。incoming 的"重排后静置抑制二次入场"
        // 改到重排提交时（见 460ms setTimeout 内）才设置，此刻 deleteEntryTarget 早已播完。
        // 右幸存图仍在此占位（它们在窗口内做纯左移补位、无 deleteEntryTarget 入场，可立即静置）。
      }
      // 复用切换的图片加载管线：删除窗口内"从右侧进入的新图"（realIndex+viewMode）不在
      // requestActive 的 visible 集内，需等重排后 realIndex 更新才被加载；这里立即 requestLoad，
      // 让它像切换时进入的那张图一样在入场动画期间尽早就绪，避免"边动画边加载"造成的闪烁。
      const enteringIdx = wasReal + viewMode;
      const entering = images[enteringIdx];
      if (entering && !removedIdsRef.current.has(entering.id)) {
        preloader.requestLoad(enteringIdx);
        // 缩略图同样要在删除窗口内可见：新入图非激活在视口右缘之外，其 <img> 之前按 lazy 未发起
        // 加载。这里显式预载其缩略图，浏览器缓存随后会立即服务飞入卡片的 <img>（与上面 eager 配合），
        // 保证飞入的 0.4s 内即有内容、不会"空白滑入后才直接出现"。
        const enterThumb = entering.thumbSrc;
        if (enterThumb && !enterThumb.startsWith("blob:")) {
          warmedThumbCacheRef.current.has(enterThumb) ||
            (warmedThumbCacheRef.current.add(enterThumb), (new Image() as HTMLImageElement).src = enterThumb);
        }
      }
      // ===== 串行删除时序 =====
      // 吸入阶段（Timer A 之前）：deleteMotionStarted=false、deleteEpoch 未递增、groupShiftX 未 animate
      //   → 被删图右侧整段与新入图完全静止，仅吸入动画在跑（吸入时长与当前一致）。
      // Timer A（吸入结束）：置 deleteMotionStarted → 新入图 deleteEntryTarget 生效播放"切换入场"；
      //   递增 deleteEpoch（入场一次性触发键）；启动 groupShiftX 右段共享平移补位。
      // Timer B（切换结束后）：执行下方重排提交体（原 460ms）。
      // ===== 删除时序：串行(serialAnim) vs 并行(默认) =====
      // 并行：吸入与图片运动/入场同时——点击帧即递增 deleteEpoch 并启动右段平移（等价改造前原行为）。
      // 串行：吸入阶段右段与新入图静止，吸入结束(Timer A)才递增 epoch、置 deleteMotionStarted、启动平移。
      const suctionWait = serialAnim && !devDisableDeleteAnim ? DELETE_SUCTION_MS : 0;
      if (serialAnim) {
        window.setTimeout(() => {
          setDeleteMotionStarted(true);
          setDeleteEpoch((e) => e + 1);
          beginSwitchMotion();
        }, suctionWait);
      } else {
        setDeleteEpoch((e) => e + 1);
        beginSwitchMotion();
      }

      window.setTimeout(() => {
        removedIdsRef.current.add(img.id);
        // 重排后整列左移：imageMotions 以 index 为 key。不能笼统 delete(index..n)——
        // 那会把"被缩放/拖拽的右侧幸存图"自身的 scale/x/y（拖拽缩放）一并清掉（另一张图删除导致
        // 它平移时，缩放/拖拽状态丢失）。改为**按图迁移**：
        //   - 被删位置(index)的 motion 丢弃（该图已被删，其缩放/拖拽残留不应被补位图继承）；
        //   - 右侧(index+1..)每张图的 motion 整体左移一格(index-1)，保留它自己的拖拽/缩放。
        // 迁移后新槽位的 occupant（原 index+1）拿到的是"它自己"的 motion，而非原位残留，显示正确。
        const mmap = imageMotionsMapRef.current;
        const dm = dirtyMotionIndicesRef.current;
        // 整表重建迁移（不能用"增量 set(k-1)"——那会把原 k 保留成同值重复 key，连续删除多次后
        // index 错配，删除动画作用到错误的图/位置，表现为"右边缘被裁剪图执行删除"）。
        // 重建后：被删位置 index 丢弃；左侧 k<index 原位保留；右侧 k>index 左移一格保留自身拖拽/缩放。
        const newMmap = new Map<number, ImageMotions>();
        for (const [k, mv] of mmap) {
          if (k === index) continue;
          newMmap.set(k > index ? k - 1 : k, mv);
        }
        imageMotionsMapRef.current = newMmap;
        const newDm = new Set<number>();
        for (const k of dm) {
          if (k === index) continue;
          newDm.add(k > index ? k - 1 : k);
        }
        dirtyMotionIndicesRef.current = newDm;
        setDeletingId(null);
        // 缩略图条共享平移归零：此刻缩略图索引已随 removeEpoch 左移一格（被删图右侧整体 index -1），
        // 共享平移同步归零 → 净位移不变，绝不回弹（与主图 groupShiftX 归零同理，但缩略图无 Swiper
        // wrapper 复位延迟，可直接在当前 commit 归零）。
        thumbGroupShiftX.set(0);
        thumbGroupShiftAnimRef.current?.stop();
        thumbGroupShiftAnimRef.current = null;
        // 删除发生在活跃行之前 → realIndex 需前移一位，保持当前观看内容不变，
        // 否则活跃行错位（且 loop 模式可能残留被删图的克隆）。
        if (index < wasReal) {
          const targetReal = Math.max(0, wasReal - 1);
          realIndexRef.current = targetReal;
          pendingRealIndexRef.current = targetReal;
          setRealIndex(targetReal);
          setPendingRealIndex(targetReal);
        } else if (index === wasReal) {
          // 删除活跃行首图（源码级共享平移路径，删除窗口内未走 goToIndex，realIndex 全程保持 wasReal）：
          // 重排后数组缩一张，原 wasReal+1 → 新 wasReal，本应是目标中心。这里把它固定为 wasReal，
          // 与该卡"整段左移一格补位"后的落位完全一致，绝不再出现"目标中心只停留一瞬再跳到第三张"。
          // 但须收敛到新数组边界内：连续删除/随机点中删除时，若 wasReal 已逼近/超过新数组末索引
          // （如从 index6 连续删，数组 8→2，realIndex 若固定 6 会越界），Swiper 会停在无效索引、
          // 中心图消失、动画错乱。用 min(wasReal, numAfter-1) 收敛，删除末尾时回退到最后一张。
          const numAfter = Math.max(1, n - 1);
          const targetReal = Math.min(wasReal, numAfter - 1);
          realIndexRef.current = targetReal;
          pendingRealIndexRef.current = targetReal;
          setRealIndex(targetReal);
          setPendingRealIndex(targetReal);
        }
        // 重排已提交：此后不再触发"左移补位"（移动已在该窗口内完成）
        deletingReshapedRef.current = true;
        setRemoveEpoch((e) => e + 1);
        // ===== 从重排提交起开启 slideChange 抑制 =====
        // 重排后 images 少一张，Swiper 收到新 children 会自动 updateSlides 并发一次 slideChange，
        // 其 realIndex 是"删除点后物理位置 +1"（例如删除中心图 R → Swiper 实为 R+1）。
        // 而我们期望的"目标中心"是重排后 realIndex 保持 R（显示原 R+1 那张）；若不加抑制，
        // 这次未受控的 slideChange 会用 setRealIndex(R+1) 覆盖，导致目标中心只停留一瞬后
        // 跳到第三张（原 R+2）。故从重排提交这一刻就开启抑制窗口，覆盖
        // "children 数量变化 → 复位(500ms 后) → 复位后 rAF 异步" 全程，保证 realIndex 稳定。
        // 后续复位定时器还会再延长时间戳，最终窗口覆盖到复位彻底完成。
        resetSuppressUntilRef.current = performance.now() + 500 + RESET_SUPPRESS_MS;
        // ===== 静置时刻刷新 =====
        // 重排提交即"静置归位"：把全部删除静置标记刷新为当前时刻（跨重挂载稳定，
        // 供 AnimatedSlideImg 抑制复位产生的异步 isActive 抖动导致的二次入场）。
        // 不再定时清空集合：由新鲜度判定 + 惰性清理（pruneDeleteFillState）自然失效，
        // 避免快速连续删除时清空与复位延迟事件竞争，导致已到位的图重放一次入场动画。
        const settleNow = performance.now();
        for (const id of relocateFillIdsRef.current.keys()) {
          relocateFillIdsRef.current.set(id, settleNow);
        }
        for (const id of relocateSurvivorFillIdsRef.current.keys()) {
          relocateSurvivorFillIdsRef.current.set(id, settleNow);
        }
        // incoming（双图/三图）的"重排后静置抑制二次入场"在此刻才生效：
        // 删除窗口内它是 rider+deleteEntryTarget，已播与切换同源的入场，不能静置；
        // 重排提交后它已落位，加入静置集合（此刻刷新为 settleNow），杜绝"落位后 isActive 闪断
        // 再播一遍入场"（播放两遍切换动画），这里按"进入新末位的那张图"（原 wasReal+viewMode → 重排后变 wasReal）补进。
        // 单图（viewMode===1）：吸入期间新入图未播任何入场（deleteEntryTarget / groupShift 均已按
        // viewMode===1 关闭），因此重排时**不**静置它 → 它成为唯一活跃中心后正常播放切换入场（"先吸入、
        // 再切入"串行衔接。见 deleteEntryTarget 与群移的 viewMode 门控）。
        const reflowIncoming = images[wasReal + viewMode];
        if ((!serialAnim || viewMode > 1) && reflowIncoming && !removedIdsRef.current.has(reflowIncoming.id)) {
          relocateFillIdsRef.current.set(reflowIncoming.id, settleNow);
        }
        // ===== 共享平移：结束动画，但【不立即归零】 =====
        // 右侧整段 groupShiftX 使它们比原始槽位左移一格。此刻若立即 set(0)，会在"被删图移除
        // 尚未落地渲染"的那一帧让右侧卡先弹回原位、被删图仍显示——即"零点几秒回弹闪烁"。
        // 因此只停掉动画(冻结在 -shift 端点)，真正的归零推迟到 runReset：等 removal 渲染提交、与
        // wrapper 复位(归位到 wasReal)同一帧发生，净位移不变，右侧卡不闪现、左侧卡则始终没动过。
        groupShiftAnimRef.current?.stop();
        groupShiftAnimRef.current = null;
        // ===== Swiper 复位：防抖合并到"最近一次删除提交"之后再执行 =====
        // 快速连续删除会各自排一套定时器，停止后残留的多套定时器会在最后一张图已静置
        // 稳定后异步晚触发——再次 updateSlides/slideTo 拨动 Swiper 触发 slideChange，
        // 导致已到位的图被重新判为"新图"再放一次入场动画。这里用单一防抖槽位：每次提交只
        // 覆盖上一份待执行的复位，停止后仅保留最后一份。
        if (settleResetTimerRef.current != null) window.clearTimeout(settleResetTimerRef.current);
        // 复位必须紧随重排：重排后 arrays 缩一张，被删图右侧图整体 index -1（图2：旧1→新0），
        // 而删除动画驱动的 wrapper 仍停在旧 index（如中心图删除后 goToIndex(1) 让 wrapper 停 1）。
        // 若复位拖延，wrapper 停在的旧 index 在重排后恰好映射到"再后一张"（1→图3），
        // 会先显示错位的"图3 一瞬"，再被复位拨回目标（图2）——即"目标中心后闪过另一张再回来"。
        // 因此复位等到 Swiper 把 children 更新到 newN 后就立即把 wrapper 归位到 target，
        // 将错位窗口压缩到"Swiper 更新→复位"之间的一帧左右，视觉上无感。
        // 复位本身沿用 loopDestroy/loopCreate + slideToLoop，仍是 Swiper 自身的归位机制，
        // 不改变删除动画（被删图自定义缩小 + 右侧图复用下一张切换平移）。
        const newN = Math.max(0, n - 1);
        let resetAttempt = 0;
        // 记录本次删除的代际：runReset 可能在主线程繁忙时拖延到下一轮删除开始后才真正执行，
        // 此时必须中止，把复位职责让给新一轮删除（否则会拨动其正在播放的动画）。
        const resetGen = deleteGenRef.current;
        const runReset = () => {
          if (deleteGenRef.current !== resetGen) return; // 已被后续删除取代，中止
          const s = swiperRef.current;
          if (!s || s.destroyed) return;
          // 虚拟模式下 s.slides 仅含可见 slide，s.slides.length 恒不等于 newN，
          // 若按非虚拟逻辑等待必然空转 16×16ms；直接用实例运行时状态判断是否虚拟。
          const usingVirtual = !!s.virtual;
          // 非虚拟模式下 DOM slide 数=n，需等 Swiper children 更新到 newN 再复位（最多 ~240ms），
          // 保证复位作用在新数组上。
          if (!usingVirtual && s.slides.length !== newN && resetAttempt < 16) {
            resetAttempt++;
            window.setTimeout(runReset, 16);
            return;
          }
          settleResetTimerRef.current = null;
          const target = realIndexRef.current;
          // 归零时机与复位同帧：此刻被删图已移除落地渲染(removal 已提交)、wrapper 即将复位到 target。
          // 先令右侧整段共享平移归零，再随复位(归位到 wasReal)一并生效 → 净位移不变、绝无回弹闪烁。
          groupShiftX.set(0);
          groupShiftAnimRef.current?.stop();
          groupShiftAnimRef.current = null;
          // 复位期间抑制 handleSlideChange（loop 复位的 slideToLoop 会暂时拨动 realIndex，
          // 导致已补位并稳定下来的幸存卡被误判"新图"而重放一次入场动画）。
          suppressRealIndexSyncRef.current = true;
          // 同步块只覆盖 loopFix 的同步 slideTo；slideToLoop 内部经 rAF 延迟执行的 slideTo
          // 及其连锁拨动在 finally 之后才触发 slideChange，须用时间戳把抑制窗口延伸到复位之后。
          resetSuppressUntilRef.current = performance.now() + RESET_SUPPRESS_MS;
          try {
            const isLoop = !useVirtual && !hasMore && newN > viewMode;
            if (isLoop) {
              s.loopDestroy();
              s.updateSlides();
              s.loopCreate();
              s.slideToLoop(target, 0);
            } else if (usingVirtual) {
              // 虚拟模式：Swiper 只挂载可见 slide，runReset 不应再全量 updateSlides()
              // （那会测量全部 placeholderSlides DOM 节点，造成数百 ms 冻结）。
              // 删除提交后 Swiper React 会因 children 变化触发虚拟模块自行重算 grid，
              // 此处仅做定位。
              s.slideTo(target, 0);
            } else {
              s.updateSlides();
              s.slideTo(target, 0);
            }
          } finally {
            suppressRealIndexSyncRef.current = false;
            /* 忽略：非虚拟/极窄场景下 updateSlides 可能抛错 */
          }
          // 抑制窗口内若用户导航，其 slideChange 会被忽略、jumpTargetRef 无法被正常清除；
          // 窗口结束后统一清掉，避免残留目标让后续滑动/导航的 slideChange 被误判为"中间索引"而忽略。
          window.setTimeout(() => {
            jumpTargetRef.current = null;
          }, RESET_SUPPRESS_MS);
        };
        // 合并复位：把 Swiper 结构性复位对齐到下一帧（requestAnimationFrame），
        // 而非散落在微任务里。连续删除 / 同帧多次触发时，下面先清除上一次提交的定时器，
        // 保证“最近一次提交”的复位只执行一次；rAF 再把这次必要的 updateSlides() 对齐到帧边界，
        // 避免微任务风暴里反复重排（单次删除的 ~735ms 测量成本来自 Swiper 对全部真实 slide 的重测，
        // 无法在此路径消除，需改用虚拟模式方得根除）。runReset 内部另有代际守卫，旧代际的复位会自动中止。
        if (settleResetTimerRef.current != null) window.clearTimeout(settleResetTimerRef.current);
        requestAnimationFrame(() => {
          settleResetTimerRef.current = window.setTimeout(runReset, 0) as unknown as number;
        });
        // ===== 串行化释放 / 队列接力 =====
        // 当前删除重排已提交、复位已调度。等待复位稳定（DELETE_SERIAL_BUFFER_MS）后：
        // - 队列非空 → 按 img.id 在"最新 images"中定位下一张待删图并立即应用（链条式接力）；
        // - 队列为空 → 释放串行锁，允许新的删除即时开始。
        // 用 ref 回读最新数组/回调，避免闭包里的旧 images / 旧 flyOutAndRemove。
        window.setTimeout(() => {
          const q = pendingDeleteQueueRef.current;
          if (q.length === 0) {
            serialDeleteLockRef.current = false;
            return;
          }
          let processed = false;
          let guard = 0;
          while (q.length > 0 && guard++ < 3) {
            const next = q[0];
            q.shift();
            if (!next || removedIdsRef.current.has(next.id)) continue; // 已被移除则跳过
            // 用"原始数组 + 已删除集合（ref，同步更新）"实时计算最新有效列表，
            // 避免依赖渲染期才更新的 imagesRef：快速连删/重载时 React 渲染可能延迟，
            // 读到旧数组会导致 findIndex 索引错位 → 删除动画打到错误的卡片上（被删图"直接消失"）。
            const latest = imagesRawRef.current.filter((im) => !removedIdsRef.current.has(im.id));
            const ni = latest.findIndex((im) => im.id === next.id);
            if (ni < 0) continue; // 数组里已不存在，跳过继续下一个
            // 关键：先释放锁，再交付。此处仍处于"上一删除调度本定时器"的锁内（serialDeleteLockRef=true），
            // 若直接调 flyOutAndRemoveRef，其入口的 `if (serialDeleteLockRef.current)` 会把它再次塞回队列，
            // 导致下一张永远不被真正删除、锁也永远不被释放（第二次删除完全无动画、图卡死不动）。
            // 先置 false 让被交付的删除以"新删除"身份正常获取锁、并调度它自己的释放定时器（链条式接力）。
            serialDeleteLockRef.current = false;
            flyOutAndRemoveRef.current(ni, latest[ni]);
            processed = true;
            break;
          }
          if (!processed) serialDeleteLockRef.current = false; // 队列里没有可删项时才兜底释放
        }, DELETE_SERIAL_BUFFER_MS);
      }, serialAnim ? suctionWait + DELETE_MOTION_MS + DELETE_SETTLE_BUFFER_MS : 460);
    },
    [deletingId, getOrCreateImageMotions, images, n, viewMode, hasMore, preloader, pruneDeleteFillState, containerWidth, containerHeight, devDisableDeleteAnim, devDisableSurvivorAnim, serialAnim]
  );
  // 队列接力触发的后续删除必须命中"最新"的实现（重排后 images/deletingId 均更新）
  flyOutAndRemoveRef.current = flyOutAndRemove;

  // 重命名：唤起重命名输入（value 取当前显示名）；输入过程中 renameSeq 递增驱动即时刷新
  const startRename = useCallback((_index: number, img: GalleryImage) => {
    setRenameState({ id: img.id, value: displayAlt(img) });
  }, []);

  const commitRename = useCallback((img: GalleryImage, value: string) => {
    const finalName = value.trim();
    if (finalName && finalName !== img.alt) {
      renamedMapRef.current.set(img.id, finalName);
    } else {
      renamedMapRef.current.delete(img.id);
    }
    setRenameSeq((s) => s + 1);
    setRenameState(null);
  }, []);

  const cancelRename = useCallback((img: GalleryImage | null) => {
    if (img) {
      renamedMapRef.current.delete(img.id);
      setRenameSeq((s) => s + 1);
    }
    setRenameState(null);
  }, []);

  // 若删除后当前索引超出末尾，回退到最后一张
  useEffect(() => {
    if (n > 0 && realIndex > n - 1) {
      const target = n - 1;
      realIndexRef.current = target;
      pendingRealIndexRef.current = target;
      setRealIndex(target);
      setPendingRealIndex(target);
    }
  }, [n, realIndex]);

  // 构建功能插槽：调用方提供的 actions 完全控制顺序/启停/图标/函数；
  // 未提供时使用内置默认（重命名 → 删除）。内置 delete/rename 的本地行为始终执行，
  // 其 onSelect 仅用于追加调用方真实逻辑。
  // 调用方可能只给 key/label（如预览页示例未提供 icon），此处为内置动作补全默认图标，
  // 避免按钮因无图标而渲染为空、不可见。
  const actionsConfig: CarouselAction[] = (actions ?? [
    { key: "rename", icon: RenameIcon, label: t.renameImage },
    { key: "delete", icon: TrashIcon, label: t.deleteImage },
  ]).map((a) => {
    if (a.icon) return a;
    if (a.key === "rename") return { ...a, icon: RenameIcon };
    if (a.key === "delete") return { ...a, icon: TrashIcon };
    return a;
  });

  // ── 虚拟化 ──
  // 图片数量超过阈值时启用 Swiper Virtual 模式，只渲染可见 slides，避免 2000 个 DOM 节点
  const VIRTUAL_THRESHOLD = 20;
  const useVirtual = n > VIRTUAL_THRESHOLD;

  // ── 导航锁定 ──
  // 图片数量不足以切换时，禁止所有导航（键盘、按钮、拖拽、点击、Swiper 滑动）
  const isNavigationLocked = n === 0 || viewMode >= n;
  const isNavigationLockedRef = useRef(isNavigationLocked);
  useEffect(() => { isNavigationLockedRef.current = isNavigationLocked; }, [isNavigationLocked]);

  // 按图片数量自动收敛视图模式：当前模式需要的图片张数超过剩余张数时，自动降级到可行模式。
  // 降级复用 changeViewMode 的全套过渡动画（isTransitioningViewMode 驱动），与手动切换观感一致。
  // - n===2：若当前为三图 → 自动切到双图；双图下 viewMode>=n 导航已由 isNavigationLocked 锁定；
  // - n===1：若当前为双图/三图 → 自动切到单图，单图下 viewMode>=n 导航同样锁定；
  // - n===0：无可用视图，直接由空占位接管，不触发生成任何模式。
  useEffect(() => {
    if (!isOpen) return;
    const maxAllowed: 1 | 2 | 3 = n >= 3 ? 3 : n === 2 ? 2 : 1;
    if (n > 0 && viewMode > maxAllowed) {
      changeViewMode(maxAllowed);
    }
  }, [isOpen, n, viewMode, changeViewMode]);

  // 导航锁定时禁用 Swiper 触摸滑动
  useEffect(() => {
    const swiper = swiperRef.current;
    if (swiper && !swiper.destroyed) {
      if (isNavigationLocked) {
        swiper.allowTouchMove = false;
      } else {
        swiper.allowTouchMove = !isZoomedRef.current;
      }
    }
  }, [isNavigationLocked]);

  // ── goToIndex ──

  const goToIndex = useCallback(
    (idx: number, opts?: { keepPendingIndex?: boolean }) => {
      if (isNavigationLockedRef.current) return;
      const swiper = swiperRef.current;
      if (!swiper || swiper.destroyed) return;

      // 如果 wrapper 还处于冻结状态（视图切换未完成），立即解除
      if (isViewModeChangingRef.current) {
        const wrapper = swiper.wrapperEl as HTMLElement;
        wrapper.style.transition = "";
        wrapper.style.transform = "";
        swiper.params.speed = 400;
        isViewModeChangingRef.current = false;
        setIsTransitioningViewMode(false);
      }

      // 非 loop 模式（hasMore）下，到达边界时触发加载更多，不循环
      if (hasMore) {
        if (idx < 0 || idx >= n) {
          onNeedMore?.();
          return;
        }
      }

      if (idx === realIndexRef.current) return;

      // 设置滑动方向
      const diff = idx - realIndexRef.current;
      const isLoopMode = !useVirtual && !hasMore && n > viewMode;
      const dir: 1 | -1 = isLoopMode && Math.abs(diff) > n / 2 ? (diff > 0 ? -1 : 1) : (diff > 0 ? 1 : -1);
      slideDirectionRef.current = dir;

      const doSwitch = () => {
        // 先让 Swiper 开始动画，再更新 React 状态
        // 避免 React re-render 期间 Swiper 内部状态被重置导致动画丢失
        if (swiper.realIndex !== idx) {
          // 显式传 speed：本实例 params.speed 可能被（viewMode 冻结等路径）置为 0 且未能恢复，
          // 不传则 slideTo 用 params.speed=0 → 瞬移。实测显式传 400 即恢复平滑滑动。
          if (swiper.params.loop) {
            swiper.slideToLoop(idx, 400);
          } else {
            swiper.slideTo(idx, 400);
          }
          // 实际发生了滑动才标记跳转目标（抑制中间 slideChange）
          jumpTargetRef.current = idx;
        }
        // realIndex 必须同步提交：Swiper virtual 模式在 slideTo 的过渡回调里依赖
        // React 同步反映最新索引来填充/重排 slides，若异步化（startTransition）会
        // 导致 transform 不更新、切换无动画甚至不切换。故这里保持同步。
        // 同步标记滑动过渡开始：goToIndex 是箭头/上一张/下一张/缩略图/滚轮导航的汇聚点，
        // 且经 jumpTargetRef 抑制了 handleSlideChange（那里的标记不会执行）。
        // 必须在 setRealIndex 同一批提交，否则 realIndex 先变让旧中心被判非活跃、被
        // neighborHidden 隐藏，而 wrapper 还没开始平移动画 → 旧图原地消失的黑屏一帧。
        setIsSwipeAnimating(true);
        setRealIndex(idx);
        realIndexRef.current = idx;
        // keepPendingIndex（行首删除）：只驱动切换动画与 realIndex 前进，但保持 pendingRealIndex 不变。
        // 此时缩略图条中心不该跳去 R+1 又跳回 R（删除前后中心始终在同一索引位），避免底部缩略图往返二次动画。
        // 需同步抑制 handleSlideChange 的 pendingRealIndex 写入（swiper.slideTo(R+1) 会触发 slideChange），
        // 否则缩略图条仍会被 0→1→0 拉动两次。
        if (opts?.keepPendingIndex) {
          suppressPendingSyncRef.current = true;
          // 复位：keepPendingIndex 只在删除动画窗口内抑制 handleSlideChange 对
          // pendingRealIndex 的同步，窗口结束后必须复位，否则后续导航的缩略图条中心不再跟随。
          window.setTimeout(() => {
            suppressPendingSyncRef.current = false;
          }, RESET_SUPPRESS_MS);
          return;
        }
        // pendingRealIndex 也必须同步：缩略图条中心/移动目标(STRIP_TARGET_X)依赖它，
        // 异步化会导致长按/连续点击时缩略图条不跟手、帧率下降。
        pendingRealIndexRef.current = idx;
        setPendingRealIndex(idx);
      };

      // 不等待图片加载完成，直接切换（图片加载中会显示 loading 转圈动画）
      doSwitch();
    },
    [preloader, hasMore, n, viewMode, onNeedMore, useVirtual]
  );

  // 优化：用 useMemo 缓存 activeIndex，避免每次渲染线性搜索
  const activeIndex = useMemo(() => {
    if (activeId == null) return -1;
    return images.findIndex((i) => i.id === activeId);
  }, [activeId]);

  // ── 键盘导航 ──

  // 用 ref 跟踪 goToIndex 的最新引用，避免 useCallback 依赖导致闭包过期
  const goToIndexRef = useRef(goToIndex);
  useEffect(() => {
    goToIndexRef.current = goToIndex;
  }, [goToIndex]);

  // 用 ref 跟踪 onNeedMore 的最新引用，避免滚轮 stepOnce 闭包持有过期回调
  const onNeedMoreRef = useRef(onNeedMore);
  useEffect(() => {
    onNeedMoreRef.current = onNeedMore;
  }, [onNeedMore]);

  // 跳转抑制目标：goToIndex 用 swiper.slideTo 长距离跳转时，
  // 会逐个触发中间 slide 的 slideChange → setRealIndex(中间索引)，
  // 覆盖 goToIndex 已设的目标索引，打断目标图片的预加载入队（abort 风暴）。
  // 记录目标索引，handleSlideChange 在到达目标前忽略中间索引，到达后清除。
  const jumpTargetRef = useRef<number | null>(null);

  // 行首删除(keepPendingIndex)期间：goToIndex 会驱动 swiper.slideTo(R+1) 触发 slideChange，
  // 而 handleSlideChange 会无条件把 pendingRealIndex 刷成 R+1，随后删除收缩时又改回 R，
  // 导致底部缩略图条 0→1→0 往返两次 spring，表现为抽搐。
  // 该 flag 在 keepPendingIndex 期间抑制 handleSlideChange 对 pendingRealIndex 的同步，
  // 仅同步 realIndex（A 坐标推进仍需要），由 canSlide 分支的 460ms 收缩回调复位。
  const suppressPendingSyncRef = useRef(false);

  // 用 ref 跟踪 viewMode，避免 processArrowRelease 闭包过期
  const viewModeRef = useRef(viewMode);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  const processArrowPress = useCallback(
    (direction: "left" | "right", isRepeat: boolean) => {
      if (isNavigationLockedRef.current) return;
      holdDirectionRef.current = direction;
      // 设置滑动方向（纯 ref，不触发重渲染）
      slideDirectionRef.current = direction === "right" ? 1 : -1;
      if (isRepeat) {
        // 长按重复：仅更新 pendingRealIndex，等 keyup 时统一执行 goToIndex
        if (!isKeyboardActiveRef.current) setIsKeyboardActive(true);
        // 分页（hasMore）向右：接近加载末尾（还剩 PAGINATION_LOOKAHEAD 张）就提前 onNeedMore
        // 续上下一页，同时继续推进到今天已加载的末尾 (n-1)，数据到达后 n 增大、长按无缝续走，
        // 无需“再按一次”。触发加载放在 state updater 之外，避免渲染期间调用 setState。
        const currentPending = pendingRealIndexRef.current;
        if (hasMore && direction === "right" && currentPending >= n - PAGINATION_LOOKAHEAD) {
          onNeedMore?.();
          startTransition(() => {
            setPendingRealIndex((prev) => Math.min(n - 1, prev + step));
          });
          return;
        }
        startTransition(() => {
          setPendingRealIndex((prev) => {
            if (postWrapRef.current) {
              return prev;
            }
            const next = direction === "right" ? prev + step : prev - step;
            const atRightEnd = prev >= n - step;
            const atLeftEnd = prev < step;
            // 分页模式（hasMore）不循环：右端已由上方提前 onNeedMore 分支接管，这里仅 clamp 在已加载范围；
            // 左端没有更多可加载，停在 0。
            if (hasMore) {
              return atLeftEnd || atRightEnd ? prev : Math.max(0, Math.min(n - 1, next));
            }
            // 非分页（loop）模式：到达边界触发 wrap
            const atBoundary = atRightEnd || atLeftEnd;
            if (atBoundary) {
              if (!atEndRef.current) {
                atEndRef.current = true;
                if (wrapTimerRef.current !== null) {
                  window.clearTimeout(wrapTimerRef.current);
                }
                wrapTimerRef.current = window.setTimeout(() => {
                  wrapTimerRef.current = null;
                  if (holdDirectionRef.current === direction) {
                    atEndRef.current = false;
                    postWrapRef.current = true;
                    startTransition(() => {
                      setPendingRealIndex(direction === "right" ? 0 : n - step);
                    });
                    wrapTimerRef.current = window.setTimeout(() => {
                      wrapTimerRef.current = null;
                      postWrapRef.current = false;
                    }, POST_WRAP_PAUSE_MS);
                  } else {
                    atEndRef.current = false;
                  }
                }, WRAP_PAUSE_MS);
              }
              return prev;
            }
            atEndRef.current = false;
            postWrapRef.current = false;
            if (wrapTimerRef.current !== null) {
              window.clearTimeout(wrapTimerRef.current);
              wrapTimerRef.current = null;
            }
            return Math.max(0, Math.min(n - 1, next));
          });
        });
      } else {
        // 单次按键：立即切换，不等 keyup，避免 pendingRealIndexRef 异步更新导致 goToIndex 被跳过
        atEndRef.current = false;
        postWrapRef.current = false;
        if (wrapTimerRef.current !== null) {
          window.clearTimeout(wrapTimerRef.current);
          wrapTimerRef.current = null;
        }
        const prev = realIndexRef.current;
        const next = direction === "right" ? prev + step : prev - step;
        if (hasMore) {
          // 还有更多图片可加载：到达边界时触发加载，不循环
          if (next < 0 || next >= n) {
            onNeedMore?.();
            return;
          }
          goToIndexRef.current(next);
        } else {
          const newIdx = ((next % n) + n) % n;
          goToIndexRef.current(newIdx);
        }
      }
    },
    [n, step, hasMore, useVirtual, onNeedMore]
  );

  // 长按/按键 hold 的 tick 必须经此 ref 调用“最新”的 processArrowPress。
  // 否则 tick 闭包捕获按下那一刻的 processArrowPress（内含旧 n/hasMore），
  // 分页加载后 n 虽已增长，正在跑的 tick 仍拿旧 n 判定边界，永远卡在旧末尾——这正是“必须再按一次”才能续页的根因。
  const processArrowPressRef = useRef(processArrowPress);
  useEffect(() => {
    processArrowPressRef.current = processArrowPress;
  }, [processArrowPress]);

  const processArrowRelease = useCallback(() => {
    if (wrapTimerRef.current !== null) {
      window.clearTimeout(wrapTimerRef.current);
      wrapTimerRef.current = null;
    }
    atEndRef.current = false;
    postWrapRef.current = false;
    holdDirectionRef.current = null;
    if (isKeyboardActiveRef.current) setIsKeyboardActive(false);

    // 如果仍在冻结，先恢复
    const swiper = swiperRef.current;
    if (isViewModeChangingRef.current && swiper && !swiper.destroyed) {
      const wrapper = swiper.wrapperEl as HTMLElement;
      wrapper.style.transition = "";
      wrapper.style.transform = "";
      swiper.params.speed = 400;
      isViewModeChangingRef.current = false;
      setIsTransitioningViewMode(false);
      // 同步，避免 goToIndex 之后的渲染读到旧的 prevVM
      prevViewModeRef.current = viewModeRef.current;
      setPrevViewMode(viewModeRef.current);
    }

    const target = pendingRealIndexRef.current;
    const current = realIndexRef.current;
    if (target !== current && swiper && !swiper.destroyed) {
      goToIndexRef.current(target);
    }
  }, []);

  const clearButtonHold = useCallback(() => {
    if (buttonHoldTimerRef.current !== null) {
      window.clearTimeout(buttonHoldTimerRef.current);
      buttonHoldTimerRef.current = null;
    }
  }, []);

  const handleButtonPress = useCallback(
    (e: React.PointerEvent<HTMLElement>, direction: "left" | "right") => {
      e.stopPropagation();
      e.preventDefault();
      // 正长按另一方向时忽略此按下，包括键盘/按钮互斥
      if (holdDirectionRef.current && holdDirectionRef.current !== direction) {
        return;
      }
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      processArrowPress(direction, false);
      clearButtonHold();
      const startTime = Date.now();
      const tick = () => {
        processArrowPressRef.current(direction, true);
        const elapsed = Date.now() - startTime;
        const interval =
          elapsed < LONG_PRESS_TIER_BOUNDARIES_MS[0]
            ? LONG_PRESS_TIER_INTERVALS_MS[0]
            : elapsed < LONG_PRESS_TIER_BOUNDARIES_MS[1]
              ? LONG_PRESS_TIER_INTERVALS_MS[1]
              : LONG_PRESS_TIER_INTERVALS_MS[2];
        buttonHoldTimerRef.current = window.setTimeout(tick, interval);
      };
      buttonHoldTimerRef.current = window.setTimeout(tick, LONG_PRESS_INITIAL_DELAY_MS);
    },
    [processArrowPress, clearButtonHold]
  );

  const handleButtonRelease = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // releasePointerCapture 可能在指针已被释放时抛出异常，安全忽略
      }
      clearButtonHold();
      processArrowRelease();
    },
    [clearButtonHold, processArrowRelease]
  );

  // ── 打开 / 关闭 ──

  const open = useCallback(
    (id: number) => {
      let idx = images.findIndex((i) => i.id === id);
      let targetId = id;
      setIsKeyboardActive(false);
      setIsStripDragging(false);
      setDragMoved(false);
      if (idx >= 0) {
        const vm = viewModeRef.current;
        // 少量图片边界处理：当点击的图片后面不足以填满视图模式时，以更早的图片为基准
        if (idx + vm > n) {
          idx = Math.max(0, n - vm);
        }
        targetId = images[idx].id;

        preloader.preloadAround(idx);

        const w = window.innerWidth;
        const wideCount = w < 1024 ? 11 : 15;
        const initialStripWidth =
          wideCount * THUMB_SIZE + (wideCount - 1) * THUMB_GAP;
        const initialBaseX = (initialStripWidth - THUMB_SIZE) / 2;
        // 根据 viewMode 偏移缩略图条位置，使高亮框内的图片组居中
        // 对称分配双图额外间距，组中心落在高亮框中心，无需整条回中偏移
        const initialTargetX = initialBaseX - (idx + (vm - 1) / 2) * (THUMB_SIZE + THUMB_GAP);
        stripX.set(initialTargetX);
        setPendingRealIndex(idx);
        pendingRealIndexRef.current = idx;
        setRealIndex(idx);
        // 每张图片的 motionX/Y/Scale 独立，无需保存/恢复。
        // 同步到 preViewModeIndexRef，防止视图模式变化的 useEffect 读到默认值 0 而覆盖位置
        preViewModeIndexRef.current = idx;
      }
      setActiveId((prev) => (prev === targetId ? prev : targetId));

      // 每次打开都同步 prevViewModeRef，避免残留
      prevViewModeRef.current = viewModeRef.current;
      setPrevViewMode(viewModeRef.current);
    },
    [n, stripX, preloader]
  );

  const close = useCallback(() => {
    pinchStateRef.current = null;
    isZoomedRef.current = false;
    // 关闭时清空重命名状态，避免重新打开预览时残留重命名框
    setRenameState(null);
    if (swiperRef.current) {
      swiperRef.current.allowTouchMove = true;
    }
    if (isControlled) {
      // 受控模式：通知父组件关闭，不直接修改 activeId
      onClose?.();
    } else {
      // 非受控模式：直接关闭
      // 延迟重置被修改过的图片的 MotionValue，避免与 setActiveId(null) 的 React 状态更新叠加产生微任务风暴
      const dirtyIndices = dirtyMotionIndicesRef.current;
      const motionsMap = imageMotionsMapRef.current;
      setActiveId(null);
      // 在下一帧重置 dirty 图片的 motion 值，此时 React 已完成退出动画的初始渲染
      if (dirtyIndices.size > 0) {
        requestAnimationFrame(() => {
          for (const idx of dirtyIndices) {
            const m = motionsMap.get(idx);
            if (m) {
              m.x.set(0);
              m.y.set(0);
              m.scale.set(1);
              m.opacity.set(1);
              m.rotate.set(0);
            }
          }
          dirtyIndices.clear();
        });
      }
    }
  }, [isControlled, onClose]);

  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  // 受控模式：同步外部 isOpen 到内部 activeId
  const prevIsOpenPropRef = useRef(isOpenProp);
  useEffect(() => {
    if (!isControlled) return;
    if (isOpenProp && !prevIsOpenPropRef.current) {
      // false → true: 打开轮播
      const idx = initialIndex ?? 0;
      if (images[idx]) {
        open(images[idx].id);
      }
    } else if (!isOpenProp && prevIsOpenPropRef.current) {
      // true → false: 关闭轮播，重置内部状态
      setActiveId(null);
      // 重置 dirty motion values
      const dirtyIndices = dirtyMotionIndicesRef.current;
      const motionsMap = imageMotionsMapRef.current;
      if (dirtyIndices.size > 0) {
        for (const idx of dirtyIndices) {
          const m = motionsMap.get(idx);
          if (m) {
            m.x.set(0);
            m.y.set(0);
            m.scale.set(1);
          }
        }
        dirtyIndices.clear();
      }
    }
    prevIsOpenPropRef.current = isOpenProp;
  }, [isOpenProp, isControlled, initialIndex, images, open]);

  // ── 缩略图条稳定回调 ──

  const handleThumbClick = useCallback((idx: number) => {
    // 只在 handleUp 刚执行了拖拽导航时抑制 click（避免拖拽导航被 click 覆盖）
    // thumbClickSuppressedRef 在 handleStripPointerDown 时重置为 false，
    // 所以键盘长按等非拖拽操作不会影响后续缩略图点击
    if (thumbClickSuppressedRef.current) {
      thumbClickSuppressedRef.current = false;
      return;
    }
    const current = realIndexRef.current;
    let target = idx;
    const vm = viewModeRef.current;
    if (vm === 2 && idx > current) {
      target = idx - 1;
    } else if (vm === 3) {
      if (idx > current + 1) {
        target = idx - 2;
      } else if (idx > current) {
        target = idx - 1;
      }
    }
    goToIndexRef.current(target);
  }, []);

  // ── Effects ──

  useEffect(() => {
    if (!isOpen) {
      initialLoadRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const trigger = document.activeElement as HTMLElement | null;
    const overlay = overlayRef.current;
    if (overlay) {
      // 把焦点落到 dialog 容器本身，而非第一个可聚焦元素（第一张缩略图按钮），
      // 否则该缩略图会一直持有 :focus-visible，残留白色 focus ring（白圈）。
      // 使用 preventScroll 阻止 focus 导致的自动滚动，避免外部页面 scroll 回到顶部。
      overlay.focus({ preventScroll: true });
    }
    const startKeyboardHold = (direction: "left" | "right") => {
      // 使用三级加速模拟按钮长按效果
      keyboardHoldStartRef.current = Date.now();
      const tick = () => {
        processArrowPressRef.current(direction, true);
        const elapsed = Date.now() - keyboardHoldStartRef.current;
        const interval =
          elapsed < LONG_PRESS_TIER_BOUNDARIES_MS[0]
            ? LONG_PRESS_TIER_INTERVALS_MS[0]
            : elapsed < LONG_PRESS_TIER_BOUNDARIES_MS[1]
              ? LONG_PRESS_TIER_INTERVALS_MS[1]
              : LONG_PRESS_TIER_INTERVALS_MS[2];
        keyboardHoldTimerRef.current = window.setTimeout(tick, interval);
      };
      keyboardHoldTimerRef.current = window.setTimeout(tick, LONG_PRESS_INITIAL_DELAY_MS);
    };

    const clearKeyboardHold = () => {
      if (keyboardHoldTimerRef.current !== null) {
        window.clearTimeout(keyboardHoldTimerRef.current);
        keyboardHoldTimerRef.current = null;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation(); // 阻止 Swiper 内置键盘处理器重复执行 slideNext
        if (e.repeat) {
          // 浏览器原生 repeat 由我们的三级加速定时器代替，忽略
          return;
        }
        // 正长按另一方向时忽略
        if (holdDirectionRef.current && holdDirectionRef.current !== "right") return;
        // 经 ref 调用最新 processArrowPress，避免闭包持有旧 n/onNeedMore
        processArrowPressRef.current("right", false);
        startKeyboardHold("right");
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation(); // 阻止 Swiper 内置键盘处理器重复执行 slidePrev
        if (e.repeat) {
          // 浏览器原生 repeat 由我们的三级加速定时器代替，忽略
          return;
        }
        // 正长按另一方向时忽略
        if (holdDirectionRef.current && holdDirectionRef.current !== "left") return;
        // 经 ref 调用最新 processArrowPress，避免闭包持有旧 n/onNeedMore
        processArrowPressRef.current("left", false);
        startKeyboardHold("left");
        return;
      }
      if (e.key !== "Tab" || !overlay) return;
      const focusable = Array.from(
        overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !overlay.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !overlay.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        clearKeyboardHold();
        processArrowRelease();
        return;
      }
    };
    document.addEventListener("keydown", handleKeyDown, true); // 捕获阶段，优先于 Swiper 内置键盘处理器
    document.addEventListener("keyup", handleKeyUp);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keyup", handleKeyUp);
      if (wrapTimerRef.current !== null) {
        window.clearTimeout(wrapTimerRef.current);
        wrapTimerRef.current = null;
      }
      atEndRef.current = false;
      postWrapRef.current = false;
      holdDirectionRef.current = null;
      clearButtonHold();
      clearKeyboardHold();
      trigger?.focus();
    };
  }, [isOpen, processArrowRelease, clearButtonHold]);

  useEffect(() => {
    if (activeId == null) return;
    const idx = images.findIndex((i) => i.id === activeId);
    if (idx < 0) return;
    const swiper = swiperRef.current;
    if (!swiper || swiper.destroyed) return;
    if (swiper.realIndex === idx) return;
    if (swiper.params.loop) {
      swiper.slideToLoop(idx, 0);
    } else {
      swiper.slideTo(idx, 0);
    }
  }, [activeId]);

  // 视图模式变化时：同步更新 Swiper 布局（在 paint 之前完成），
  // 确保子组件 useEffect 中可以直接设置正确的补偿值，无需 rAF 等待
  useLayoutEffect(() => {
    if (!isOpen) return;
    const swiper = swiperRef.current;
    if (!swiper || swiper.destroyed) return;

    const isViewModeChange = prevViewMode !== viewMode;
    if (!isViewModeChange) return;

    const idx = preViewModeIndexRef.current;
    swiper.params.speed = 0;

    if (swiper.params.loop) {
      swiper.loopDestroy();
      swiper.loopCreate();
    }
    try {
      swiper.update();
    } catch {
      // Swiper update 在极端布局情况下可能抛出异常，安全忽略
    }
    if (swiper.params.loop) {
      swiper.slideToLoop(idx, 0);
    } else {
      swiper.slideTo(idx, 0);
    }
  }, [viewMode, isOpen, prevViewMode]);

  // 视图模式变化后：确保索引正确，过渡完成后恢复 Swiper 速度。
  useEffect(() => {
    if (!isOpen) return;
    const swiper = swiperRef.current;
    if (!swiper || swiper.destroyed) return;

    const isViewModeChange = prevViewMode !== viewMode;
    if (!isViewModeChange) return;

    const idx = preViewModeIndexRef.current;

    setRealIndex(idx);
    pendingRealIndexRef.current = idx;
    setPendingRealIndex(idx);

    const t = window.setTimeout(() => {
      const s = swiperRef.current;
      if (s && !s.destroyed) {
        s.params.speed = 400;
        // 仅在用户未手动切图时才同步 Swiper 位置，避免撤销用户的切图操作
        if (realIndexRef.current === idx) {
          if (s.params.loop) {
            s.slideToLoop(idx, 0);
          } else {
            s.slideTo(idx, 0);
          }
        }
        const wrapper = s.wrapperEl as HTMLElement;
        wrapper.style.transition = "";
      }
      isViewModeChangingRef.current = false;
      setIsTransitioningViewMode(false);
      prevViewModeRef.current = viewMode;
      setPrevViewMode(viewMode);
      // 过渡结束：清除本次切换前的外层缩放/拖拽快照，避免残留影响下一次渲染
      viewSwitchFromRef.current.clear();
    }, 450);

    return () => window.clearTimeout(t);
  }, [viewMode, isOpen, prevViewMode]);

  useEffect(() => {
    pendingRealIndexRef.current = pendingRealIndex;
  }, [pendingRealIndex]);

  // preloadAround 是 useCallback 稳定引用，不会因 version 变化而重建；
  // 如果依赖整个 preloader 对象，每次 notifyQueue → setVersion 都会重触发
  // 此 useEffect → preloadAround → notifyQueue → 无限循环
  const preloadAround = preloader.preloadAround;
  const requestActive = preloader.requestActive;
  const clearPendingLoad = preloader.clearPendingLoad;

  useEffect(() => {
    realIndexRef.current = realIndex;
    if (!isOpen) return;
    // 防抖加载：快速连点切换时不加载，用户停顿后才提交任务。
    // 目标集 = 中心图邻图 ∪ 全部可见图。双图/三图/多图时若只加载中心，
    // 第二张及以后的可见原图会一直停留在缩略图。
    const visible: number[] = [];
    for (let k = 0; k < viewMode; k++) visible.push(((realIndex + k) % n + n) % n);
    requestActive(realIndex, visible);

    // 清理远离当前索引的缓存，防止滑动 1000+ 张后内存无限增长导致 GC 卡顿
    const MAX_CACHE = 300;
    const CLEANUP_RANGE = 150;
    if (everRenderedSetRef.current.size > MAX_CACHE) {
      for (const idx of everRenderedSetRef.current) {
        if (Math.abs(idx - realIndex) > CLEANUP_RANGE) {
          everRenderedSetRef.current.delete(idx);
        }
      }
    }
    if (imageMotionsMapRef.current.size > MAX_CACHE) {
      for (const idx of imageMotionsMapRef.current.keys()) {
        if (Math.abs(idx - realIndex) > CLEANUP_RANGE) {
          imageMotionsMapRef.current.delete(idx);
        }
      }
    }
  }, [isOpen, realIndex, viewMode, n, requestActive]);

  // 关闭时清空待执行的防抖加载，避免关闭后仍加载旧图
  useEffect(() => {
    if (!isOpen) clearPendingLoad();
  }, [isOpen, clearPendingLoad]);

  // 长按期间暂停完整图片预加载（顶多只需底部缩略图请求），松开后恢复并加载目标图。
  // 仅在长按松开瞬间（isKeyboardActive true→false）先以目标为中心入队（仍 paused，不启动下载），
  // 再 resume()，只下载目标图。否则 resume() 会先启动旧位置遗留的下载，随后 realIndex 异步更新到目标
  // 触发 preloadAround(target) → setCenter(target) 又把旧下载中止，形成 abort 抖动导致卡顿。
  useEffect(() => {
    const prev = prevHoldRef.current;
    prevHoldRef.current = isKeyboardActive;
    if (isKeyboardActive) {
      preloader.pause();
    } else if (prev) {
      preloadAround(pendingRealIndexRef.current);
      preloader.resume();
    }
  }, [isKeyboardActive, preloader.pause, preloader.resume, preloadAround]);

  // 同步 isZoomedRef 到当前 realIndex 图片的 scale（纯 ref，不触发重渲染）
  useEffect(() => {
    if (!isOpen) return;
    const motions = imageMotionsMapRef.current.get(realIndex);
    if (!motions) return;
    isZoomedRef.current = motions.scale.get() > 1;
    if (swiperRef.current) {
      swiperRef.current.allowTouchMove = !isZoomedRef.current;
    }
    const unsubscribe = motions.scale.on("change", (v) => {
      isZoomedRef.current = v > 1;
      if (swiperRef.current) {
        swiperRef.current.allowTouchMove = !isZoomedRef.current;
      }
    });
    return unsubscribe;
  }, [realIndex, isOpen]);

  const windowWidth = useWindowWidth();
  const isNarrow = windowWidth < 1024;
  const density = STRIP_DENSITY_CONFIG[stripDensityLevel];
  const STRIP_VISIBLE = isNarrow ? 5 : density.visible;
  const STRIP_DRAG_VISIBLE = isNarrow ? 11 : density.drag;
  const STRIP_VISIBLE_COUNT =
    isStripDragging && dragMoved ? STRIP_DRAG_VISIBLE : STRIP_VISIBLE;
  const STRIP_THUMB_PITCH = THUMB_SIZE + THUMB_GAP;
  const STRIP_BASE_WIDTH =
    STRIP_DRAG_VISIBLE * THUMB_SIZE + (STRIP_DRAG_VISIBLE - 1) * THUMB_GAP;
  const STRIP_BASE_X = (STRIP_BASE_WIDTH - THUMB_SIZE) / 2;
  const STRIP_VISIBLE_WIDTH =
    STRIP_VISIBLE_COUNT * THUMB_SIZE + (STRIP_VISIBLE_COUNT - 1) * THUMB_GAP;
  const STRIP_CLIP_PCT =
    ((STRIP_BASE_WIDTH - STRIP_VISIBLE_WIDTH) / 2 / STRIP_BASE_WIDTH) * 100;
  const STRIP_DRAG_SCALE = Math.max(
    0.4,
    Math.min(1, (windowWidth - 32) / STRIP_BASE_WIDTH)
  );
  const STRIP_TARGET_IDX = pendingRealIndex;
  // 双图额外间距已改为对称分配到两张中心图（见 stripItems 的 extraLeft：左 -EXTRA/2、右 +EXTRA/2），
  // 组中心仍落在高亮框中心，故此处不再对整条做 -EXTRA/2 回中（否则会使右中心图与右邻间距被压缩）。
  const STRIP_TARGET_X =
    STRIP_BASE_WIDTH / 2 -
    THUMB_SIZE / 2 -
    (STRIP_TARGET_IDX + (viewMode - 1) / 2) * STRIP_THUMB_PITCH;

  // 高亮框尺寸：根据 viewMode 调整高亮缩放倍数（避免重叠）
  const HIGHLIGHT_CENTER_WIDTH = (() => {
    if (viewMode === 1) return CENTER_THUMB_SIZE + 8;
    if (viewMode === 2) return (THUMB_SIZE * 2 + THUMB_GAP + DUAL_HIGHLIGHT_EXTRA_GAP) * (CENTER_THUMB_SIZE / THUMB_SIZE) * 0.85;
    return (THUMB_SIZE * 3 + THUMB_GAP * 2) * (CENTER_THUMB_SIZE / THUMB_SIZE) * 0.75;
  })();

  // ── 缩略图条拖拽 ──

  // 用 ref 跟踪当前活跃的拖拽清理函数，确保新旧拖拽互斥
  const stripDragCleanupRef = useRef<(() => void) | null>(null);

  const handleStripPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // 清理上一次未完成的拖拽（防御性清理）
    if (stripDragCleanupRef.current) {
      stripDragCleanupRef.current();
      stripDragCleanupRef.current = null;
    }
    // 每次新的指针按下都重置拖拽导航抑制标记
    thumbClickSuppressedRef.current = false;
    const dragStartX = e.clientX;
    let dragStarted = false; // 是否真正进入拖拽模式（超过阈值）
    let delta = 0;

    const handleMove = (ev: PointerEvent) => {
      delta = ev.clientX - dragStartX;
      if (!dragStarted && Math.abs(delta) > 5) {
        // 首次超过拖拽阈值：进入拖拽模式
        dragStarted = true;
        // 停止回弹动画
        if (stripAnimRef.current) {
          stripAnimRef.current.stop();
          stripAnimRef.current = null;
        }
        // 捕获当前 stripX 位置作为拖拽起点
        capturedBaseXRef.current = stripX.get();
        // 拖拽开始时，已渲染窗口以 realIndex 为中心，同步 ref 与 state，
        // 否则 centerIdx 切到 stripDragVisibleIdx 时窗口仍停留在上一次拖拽的旧索引，导致当前缩略图不在窗口内而消失
        stripDragVisibleIdxRef.current = realIndexRef.current;
        setStripDragVisibleIdx(realIndexRef.current);
        setIsStripDragging(true);
        setDragMoved(true);
      }
      if (dragStarted) {
        stripDragRef.current.delta = delta;
        const scale = stripScale.get();
        const adjustedDelta = scale < 1 ? delta / scale : delta;
        stripX.set(capturedBaseXRef.current + adjustedDelta);
        // 根据当前拖拽位置计算可见中心索引，用于扩展虚拟范围
        // 仅当目标超出当前已渲染窗口时才重渲染（约每 2*STRIP_VIRTUAL_RANGE 个索引一次），
        // 窗口内靠 stripX transform 平滑移动，避免拖拽每帧重渲染 41 个缩略图
        const currentIdx = Math.round((STRIP_BASE_X - stripX.get()) / STRIP_THUMB_PITCH);
        const clampedIdx = Math.max(0, Math.min(n - 1, currentIdx));
        const cur = stripDragVisibleIdxRef.current;
        if (clampedIdx < cur - STRIP_DRAG_VIRTUAL_RANGE || clampedIdx > cur + STRIP_DRAG_VIRTUAL_RANGE) {
          stripDragVisibleIdxRef.current = clampedIdx;
          if (stripDragIdxRafRef.current == null) {
            stripDragIdxRafRef.current = requestAnimationFrame(() => {
              stripDragIdxRafRef.current = null;
              setStripDragVisibleIdx(stripDragVisibleIdxRef.current);
            });
          }
        }
        // 拖拽接近已加载末尾（还剩 PAGINATION_LOOKAHEAD 张）时提前 loadMore，
        // 保证拖拽能连续越过第 n-1 张而不在缩略图断档处卡住（需松手/goToIndex 才加载）
        if (hasMore && clampedIdx >= n - PAGINATION_LOOKAHEAD) {
          onNeedMore?.();
        }
      }
    };

    const handleUp = () => {
      // 取消待执行的 rAF，避免拖拽结束后不必要的重渲染
      if (stripDragIdxRafRef.current != null) {
        cancelAnimationFrame(stripDragIdxRafRef.current);
        stripDragIdxRafRef.current = null;
        // 同步最终索引到 React 状态
        setStripDragVisibleIdx(stripDragVisibleIdxRef.current);
      }
      // 同步清理窗口监听器，防止重复触发
      cleanup();
      if (dragStarted) {
        // 标记拖拽导航，抑制紧随其后的缩略图 click（避免拖拽导航被 click 覆盖）
        thumbClickSuppressedRef.current = true;
        closeSuppressedRef.current = true;
        lastDragTimeRef.current = performance.now();
        // 有实际拖拽：根据拖拽位置定位
        const finalIdx = Math.max(
          0,
          Math.min(
            n - 1,
            Math.round((STRIP_BASE_X - stripX.get()) / STRIP_THUMB_PITCH)
          )
        );
        // 延迟到下一帧执行 goToIndex，避免 pointerup 同步执行导致 509 ms 长任务阻塞主线程
        // 非紧急状态更新用 startTransition 包裹，让浏览器优先处理输入事件和动画
        requestAnimationFrame(() => {
          startTransition(() => {
            setIsStripDragging(false);
            setDragMoved(false);
          });
          goToIndex(finalIdx);
          // 拖拽释放是"明确停在某张图"的意图（同 open/键盘松开），立即提交原图加载，
          // 绕过 realIndex 变化后 requestLoad 的防抖等待，让目标图尽快出现在请求中
          preloadAround(finalIdx);
        });
      }
      // 未拖拽时：不设置 isStripDragging，不干扰缩略图 onClick
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      stripDragCleanupRef.current = null;
    };

    // 同步注册窗口监听器，确保 pointerup 不会错过
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    stripDragCleanupRef.current = cleanup;

    stripDragRef.current = {
      startX: dragStartX,
      startIdx: realIndexRef.current,
      moved: false,
      delta: 0,
    };
  }, [stripX, stripScale, n, STRIP_THUMB_PITCH, STRIP_BASE_X, goToIndex, preloadAround, onNeedMore, hasMore]);

  useEffect(() => {
    if (isStripDragging) {
      if (stripAnimRef.current) {
        stripAnimRef.current.stop();
        stripAnimRef.current = null;
      }
      return;
    }
    const transition = isKeyboardActive
      ? { type: "spring" as const, stiffness: 400, damping: 30, mass: 0.6 }
      : { type: "spring" as const, stiffness: 260, damping: 22, mass: 0.8 };
    stripAnimRef.current = animate(stripX, STRIP_TARGET_X, transition);
    return () => {
      if (stripAnimRef.current) {
        stripAnimRef.current.stop();
        stripAnimRef.current = null;
      }
    };
  }, [STRIP_TARGET_X, isStripDragging, isKeyboardActive, stripX]);

  useEffect(() => {
    // 窄屏拖拽时缩小以显示更多缩略图；宽屏拖拽时也缩小；否则不缩放
    const target = isStripDragging && dragMoved ? STRIP_DRAG_SCALE : 1;
    const controls = animate(stripScale, target, {
      duration: 0.2,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [isStripDragging, dragMoved, STRIP_DRAG_SCALE, stripScale]);

  // 跟踪 container 宽度，用于计算每张图片在当前视图模式下的目标 X 偏移
  useEffect(() => {
    if (!isOpen) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) setContainerWidth(rect.width);
      if (rect.height > 0) setContainerHeight(rect.height);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isOpen]);

  // 滚轮缩放 rAF 节流：事件回调只累积 delta 与指针位置，布局读取+写 motion 合并到一帧一次
  const wheelPendingRef = useRef<{ factor: number; clientX: number; clientY: number; idx: number; target: HTMLElement | null } | null>(null);
  const wheelRafRef = useRef(0);

  // 滚轮切换模式：事件回调只累积方向（每格 ±1），每帧最多导航一次。
  // 防止 trackpad/鼠标高速连发 wheel 时逐个 slideTo + setState，导致边界分页处渲染风暴和卡死。
  const wheelSwitchPendingRef = useRef(0);
  const wheelSwitchRafRef = useRef(0);
  // onNeedMore 节流：分页边界持续滚轮时，限制每秒触发加载的次数，避免刷新风暴
  const lastNeedMoreAtRef = useRef(0);
  // 用 ref 跟踪最新的 n/hasMore，避免 wheel 监听闭包持有旧值（分页加载后 n 增长，旧闭包判定边界卡在旧末尾）
  const nRef = useRef(n);
  useEffect(() => {
    nRef.current = n;
  }, [n]);
  const hasMoreRef = useRef(hasMore);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  // 用 ref 绑定 wheel（{ passive: false }），避免 passive listener 中 preventDefault 的警告
  useEffect(() => {
    if (!isOpen) return;
    const el = containerRef.current;
    if (!el) return;
    const flushWheel = () => {
      wheelRafRef.current = 0;
      const p = wheelPendingRef.current;
      wheelPendingRef.current = null;
      if (!p) return;
      const motions = imageMotionsMapRef.current.get(p.idx);
      if (!motions) return;
      const containerRect = el.getBoundingClientRect();
      if (!containerRect) return;
      let imgRect: DOMRect | undefined;
      if (p.target) imgRect = p.target.getBoundingClientRect();
      const oldScale = motions.scale.get();
      const newScale = Math.max(0.5, Math.min(5, oldScale * p.factor));
      if (newScale === oldScale) return;
      const { newX, newY } = computeZoomTransform({
        pointerX: p.clientX,
        pointerY: p.clientY,
        imgRect,
        containerRect,
        currentX: motions.x.get(),
        currentY: motions.y.get(),
        oldScale,
        newScale,
      });
      motions.x.set(newX);
      motions.y.set(newY);
      motions.scale.set(newScale);
      dirtyMotionIndicesRef.current.add(p.idx);
      if (swiperRef.current) {
        swiperRef.current.allowTouchMove = newScale <= 1;
      }
    };
    const stepOnce = () => {
      const steps = wheelSwitchPendingRef.current;
      if (steps === 0) {
        wheelSwitchRafRef.current = 0;
        return;
      }
      const dir = steps > 0 ? 1 : -1;
      wheelSwitchPendingRef.current = steps - dir;
      const swiper = swiperRef.current;
      if (!swiper || swiper.destroyed || isNavigationLockedRef.current || nRef.current <= 1) {
        wheelSwitchRafRef.current = 0;
        return;
      }
      const currentIdx = realIndexRef.current;
      const nextIdx = currentIdx + dir;
      const hasMoreNow = hasMoreRef.current;
      if (hasMoreNow && (nextIdx < 0 || nextIdx >= nRef.current)) {
        // 分页边界：节流触发加载，剩余步数清零，等待数据到达后滚动自然续走
        const now = Date.now();
        if (now - lastNeedMoreAtRef.current > 250) {
          lastNeedMoreAtRef.current = now;
          onNeedMoreRef.current?.();
        }
        wheelSwitchPendingRef.current = 0;
        wheelSwitchRafRef.current = 0;
        return;
      }
      const targetIdx = hasMoreNow ? nextIdx : ((nextIdx % nRef.current) + nRef.current) % nRef.current;
      goToIndexRef.current(targetIdx);
      // 剩余步数留到下一帧逐格处理，避免单帧内多个 slideTo 相互打断
      if (wheelSwitchPendingRef.current !== 0) {
        wheelSwitchRafRef.current = requestAnimationFrame(stepOnce);
      } else {
        wheelSwitchRafRef.current = 0;
      }
    };
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (wheelModeRef.current === "switch") {
        // 滚轮切换到切换模式：仅累积方向，每格 ±1，由 stepOnce 逐帧导航
        wheelSwitchPendingRef.current += e.deltaY > 0 ? 1 : -1;
        if (!wheelSwitchRafRef.current) {
          wheelSwitchRafRef.current = requestAnimationFrame(stepOnce);
        }
        return;
      }
      // 滚轮缩放模式（默认）：合并本帧内多次 wheel，只累加缩放倍率
      const idx = resolveImgIndexFromTarget(e.target);
      const prev = wheelPendingRef.current;
      wheelPendingRef.current = {
        factor: (prev?.factor ?? 1) * (e.deltaY > 0 ? 1 / 1.1 : 1.1),
        clientX: e.clientX,
        clientY: e.clientY,
        idx,
        target: (e.target as HTMLElement)?.closest<HTMLElement>("[data-img-index]") ?? null,
      };
      if (!wheelRafRef.current) {
        wheelRafRef.current = requestAnimationFrame(flushWheel);
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current);
      wheelRafRef.current = 0;
      wheelPendingRef.current = null;
      if (wheelSwitchRafRef.current) cancelAnimationFrame(wheelSwitchRafRef.current);
      wheelSwitchRafRef.current = 0;
      wheelSwitchPendingRef.current = 0;
    };
  }, [isOpen, resolveImgIndexFromTarget]);

  // ── 缩略图条滚轮：常驻切换（不受 缩放/切换 控制）──
  // 鼠标悬停缩略图条时，滚轮始终按方向切换图片，实现快速翻找。
  // 逐帧 rAF 合并（每帧最多走一步），并沿用 onNeedMore 分页边界加载。
  const stripWheelPendingRef = useRef(0);
  const stripWheelRafRef = useRef(0);
  const stripWheelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const el = stripWheelRef.current;
    if (!el) return;
    const stepOnce = () => {
      const steps = stripWheelPendingRef.current;
      if (steps === 0) {
        stripWheelRafRef.current = 0;
        return;
      }
      const dir = steps > 0 ? 1 : -1;
      stripWheelPendingRef.current = steps - dir;
      const swiper = swiperRef.current;
      if (!swiper || swiper.destroyed || isNavigationLockedRef.current || nRef.current <= 1) {
        stripWheelRafRef.current = 0;
        return;
      }
      const currentIdx = realIndexRef.current;
      const nextIdx = currentIdx + dir;
      if (hasMoreRef.current && (nextIdx < 0 || nextIdx >= nRef.current)) {
        onNeedMoreRef.current?.();
        stripWheelPendingRef.current = 0;
        stripWheelRafRef.current = 0;
        return;
      }
      const targetIdx = hasMoreRef.current ? nextIdx : ((nextIdx % nRef.current) + nRef.current) % nRef.current;
      goToIndexRef.current(targetIdx);
      if (stripWheelPendingRef.current !== 0) {
        stripWheelRafRef.current = requestAnimationFrame(stepOnce);
      } else {
        stripWheelRafRef.current = 0;
      }
    };
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      stripWheelPendingRef.current += e.deltaY > 0 ? 1 : -1;
      if (!stripWheelRafRef.current) {
        stripWheelRafRef.current = requestAnimationFrame(stepOnce);
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
      if (stripWheelRafRef.current) cancelAnimationFrame(stripWheelRafRef.current);
      stripWheelRafRef.current = 0;
      stripWheelPendingRef.current = 0;
    };
  }, [isOpen]);

  // ── 触摸缩放手势 ──

  // 双指缩放 rAF 节流：事件回调只记录最新比例与中点，布局读取+写 motion 合并到一帧一次
  const pinchPendingRef = useRef<{ factor: number; midX: number; midY: number; target: HTMLElement | null } | null>(null);
  const pinchRafRef = useRef(0);

  const flushPinch = useCallback(() => {
    pinchRafRef.current = 0;
    const p = pinchPendingRef.current;
    pinchPendingRef.current = null;
    if (!p) return;
    const ps = pinchStateRef.current;
    if (!ps) return;
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const motions = imageMotionsMapRef.current.get(ps.idx);
    if (!motions) return;
    let imgRect: DOMRect | undefined;
    if (p.target) imgRect = p.target.getBoundingClientRect();
    const oldScale = motions.scale.get();
    const newScale = Math.max(0.5, Math.min(5, ps.initialScale * p.factor));
    if (newScale === oldScale) return;
    const { newX, newY } = computeZoomTransform({
      pointerX: p.midX,
      pointerY: p.midY,
      imgRect,
      containerRect,
      currentX: motions.x.get(),
      currentY: motions.y.get(),
      oldScale,
      newScale,
    });
    motions.x.set(newX);
    motions.y.set(newY);
    motions.scale.set(newScale);
    dirtyMotionIndicesRef.current.add(ps.idx);
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      setIsPinching(true);
      pinchPendingRef.current = null;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const initialDist = Math.hypot(
        t1.clientX - t2.clientX,
        t1.clientY - t2.clientY
      );
      const idx = resolveImgIndexFromTarget(e.target);
      const motions = imageMotionsMapRef.current.get(idx);
      const initialScale = motions ? motions.scale.get() : 1;
      pinchStateRef.current = {
        initialDist,
        initialScale,
        idx,
      };
      if (swiperRef.current) {
        swiperRef.current.allowTouchMove = false;
      }
    },
    [resolveImgIndexFromTarget]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const ps = pinchStateRef.current;
      if (!ps || e.touches.length !== 2) return;
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const newDist = Math.hypot(
        t1.clientX - t2.clientX,
        t1.clientY - t2.clientY
      );
      // 合并本帧内多次 touchmove，只记录最新比例与中点
      pinchPendingRef.current = {
        factor: newDist / ps.initialDist,
        midX: (t1.clientX + t2.clientX) / 2,
        midY: (t1.clientY + t2.clientY) / 2,
        target: (e.target as HTMLElement)?.closest<HTMLElement>("[data-img-index]") ?? null,
      };
      if (!pinchRafRef.current) {
        pinchRafRef.current = requestAnimationFrame(flushPinch);
      }
    },
    [flushPinch]
  );

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      pinchStateRef.current = null;
      pinchPendingRef.current = null;
      setIsPinching(false);
      // 优化：只检查当前图片的缩放状态，而非遍历全部图片
      const motions = imageMotionsMapRef.current.get(realIndexRef.current);
      const zoomed = motions ? motions.scale.get() > 1 : false;
      if (swiperRef.current) {
        swiperRef.current.allowTouchMove = !zoomed;
      }
    }
  }, []);

  // 卸载/关闭时清理双指缩放挂起的 rAF
  useEffect(() => {
    return () => {
      if (pinchRafRef.current) cancelAnimationFrame(pinchRafRef.current);
      pinchRafRef.current = 0;
      pinchPendingRef.current = null;
    };
  }, []);

  // ── 渲染 ──

  // 容器恒定放开裁剪（overflow 恒 visible、框架层恒渲染），因此图片放大/位移时永远从画布边缘"透图"
  // 到半透明框架上，拖拽中与松手后一致，而非仅拖拽时透出。
  // 下方的 imgOverflowActive 仅用于窄屏下隐藏非活跃相邻图（避免其从框架暗区漏出），
  // 不再参与容器裁剪/框架层的开关。
  // 用 React state 而非渲染期读 motion 判定是否漂移溢出：滚轮缩放/触屏双指只改 motion 值、
  // 不触发 React 重渲染，若渲染期读 motion 值 imgOverflowActive 会停留旧值，
  // 导致"仅缩放不透图、必须拖拽后才透图"（拖拽的 setImgDraggingIdx 恰好触发重渲染）。
  const [imgOverflowState, setImgOverflowState] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    const m = imageMotionsMapRef.current.get(realIndex);
    if (!m) {
      setImgOverflowState(false);
      return;
    }
    const update = () => {
      setImgOverflowState(
        m.scale.get() > 1 ||
          Math.abs(m.x.get()) > 1 ||
          Math.abs(m.y.get()) > 1
      );
    };
    // 立即计算一次当前值（可能已有缩放但尚未触发过渲染）
    update();
    // 订阅 motion 值变化，仅 true<->false 翻转（跨过阈值）才会真正触发重渲染
    const unsubs = [m.scale, m.x, m.y].map((mv) => mv.on("change", update));
    return () => unsubs.forEach((u) => u());
  }, [isOpen, realIndex]);
  const imgOverflowActive =
    isOpen &&
    (imgDraggingIdx != null ||
      imgOverflowState);

  const swiperContainerStyle = {
    // 外侧黑边固定 20px（上/左/右），画布内部宽度 = 视口宽 - 两侧黑边，随屏自适应；
    // 高度贴近屏幕（顶部留 20px 黑边、底部外扩 3px）；四角圆角由 overflow-hidden + borderRadius 裁切。
    width: `calc(100vw - ${CANVAS_EDGE_PX * 2}px)`,
    height: `calc(100dvh - ${BOTTOM_RESERVED}px - ${CANVAS_EDGE_PX}px + 3px)`,
    borderRadius: 14,
    // style 覆盖 className 的 overflow-hidden：恒定放开裁剪，图片放大/位移溢出时始终从画布边缘"透图"到
    // 半透明框架层上（松手后不退回裁剪），形成一直可见的半透明边缘。
    overflow: "visible",
  } as CSSProperties;

  // 稳定化 Swiper props，避免每次渲染触发 Swiper 内部 updateSwiper
  // modules 和 virtual 配置用 useMemo 缓存，防止每次渲染创建新数组/对象导致 MemoSwiper 失效
  const swiperModules = useMemo(() => useVirtual ? [Virtual] : undefined, [useVirtual]);
  const swiperVirtual = useMemo(() => useVirtual ? { addSlidesBefore: 5, addSlidesAfter: 5, cache: false } : undefined, [useVirtual]);
  const handleSwiperInit = useCallback((s: SwiperClass) => {
    swiperRef.current = s;
    if (s.el) wrapperElRef.current = s.el.querySelector(".swiper-wrapper");
    setVirtualReady(true);
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
    }
  }, []);
  const handleSlideChange = useCallback((s: SwiperClass) => {
    if (s.destroyed) return;
    // canSlide 删除的 Swiper 复位期间：整体忽略 slideChange（slideToLoop 中间循环位会
    // 短暂拨动 realIndex，导致幸存活跃卡 isActive 闪断并在复位后重放二次入场）。
    if (suppressRealIndexSyncRef.current) return;
    // 复位后 rAF 延迟的 slideChange（slideToLoop 内部经 requestAnimationFrame 执行 slideTo、
    // loopFix 也可能连锁再拨动一次）：在抑制窗口内同样忽略，避免把 realIndex 拨到中间值。
    if (performance.now() < resetSuppressUntilRef.current) return;
    if (isViewModeChangingRef.current) return;
    const newIdx = s.realIndex;
    // 跳转（goToIndex）期间：忽略 slideTo 长距离滑动逐个经过的中间 slide，
    // 只在真正到达目标索引时解除抑制，避免中间索引 setRealIndex 覆盖目标并打断预加载。
    if (jumpTargetRef.current != null) {
      if (newIdx !== jumpTargetRef.current) return;
      jumpTargetRef.current = null;
    }
    // 分页加载：滑动/跳转到接近末尾时通知父组件加载更多。
    // 必须先于 realIndex 去重判断——goToIndex 会同步预设 realIndexRef，
    // 若放在其后方，跳转到末尾会因 newIdx === realIndexRef.current 提前 return 而跳过加载。
    if (onNeedMore) {
      const threshold = Math.max(PAGINATION_LOOKAHEAD, Math.min(60, n * 0.2));
      if (newIdx >= n - threshold) {
        onNeedMore();
      }
    }
    if (newIdx === realIndexRef.current) return;
    slideDirectionRef.current = (() => {
      const diff = newIdx - realIndexRef.current;
      // 循环模式：差值超过半数说明是环绕跳转，方向取反
      if (!useVirtual && !hasMore && Math.abs(diff) > n / 2) {
        return diff > 0 ? -1 : 1;
      }
      return diff > 0 ? 1 : -1;
    })();
    // 必须在 setRealIndex 之前同步标记滑动过渡开始：realIndex 变化会让退出图在下一帧被判为
    // 非活跃，若只等 onSlideChangeTransitionStart 再开 isSwipeAnimating，图片位移前那 1~2 帧里
    // 退出图会被 neighborHidden 隐藏（仍停在中心却被隐藏 → 黑屏一闪）。两个 setState 同一 handler
    // 内提交，退出图从"仍是中心"到"开始左移"全程不会出现隐藏间隙。
    setIsSwipeAnimating(true);
    setRealIndex(newIdx);
    // 行首删除(keepPendingIndex)期间：pendingRealIndex 须保持不变（仍为 R），
    // 避免 slideChange 把它刷成 R+1 后 460ms 收缩回调又改回 R，造成缩略图条往返抽搐。
    if (suppressPendingSyncRef.current) return;
    // pendingRealIndex 保持同步：缩略图条中心/移动目标依赖它，异步化导致不跟手
    setPendingRealIndex(newIdx);
    pendingRealIndexRef.current = newIdx;
  }, [onNeedMore, n, hasMore, useVirtual]);

  const currentAlt = images[realIndex] ? (renamedMapRef.current.get(images[realIndex].id) ?? images[realIndex].alt) : "";
  const dialogLabel = `${t.dialogLabel}：${currentAlt}`;

  // 预计算当前活跃的 idx 集合，替代 isImageActive 在循环中的反复调用
  // 退出动画期间保留缓存，避免触发 AnimatedSlideImg 的退出动画与 overlay 淡出叠加
  const activeIndicesCacheRef = useRef<Set<number>>(new Set<number>());
  const activeIndices = useMemo(() => {
    if (!isOpen || n === 0) return activeIndicesCacheRef.current;
    const s = new Set<number>();
    for (let offset = 0; offset < viewMode; offset++) {
      s.add((realIndex + offset) % n);
    }
    activeIndicesCacheRef.current = s;
    return s;
  }, [isOpen, realIndex, viewMode, n]);

  // 预计算 Swiper 渲染范围内的 idx 集合（active ± SWIPER_RENDER_RANGE），避免 map 内 440 次取模
  // 退出动画期间保留缓存
  const SWIPER_RENDER_RANGE = 5;
  const nearActiveSetCacheRef = useRef<Set<number>>(new Set<number>());
  const nearActiveSet = useMemo(() => {
    if (!isOpen || n === 0) return nearActiveSetCacheRef.current;
    const s = new Set<number>();
    for (let offset = -SWIPER_RENDER_RANGE; offset < SWIPER_RENDER_RANGE + viewMode; offset++) {
      s.add(((realIndex + offset) % n + n) % n);
    }
    nearActiveSetCacheRef.current = s;
    return s;
  }, [isOpen, realIndex, viewMode, n]);

  // 持久化上一帧的 activeIndices，用于 AnimatedSlideImg 的 wasActive prop
  // 即使 Swiper loopFix 移动 DOM 导致组件重新挂载，也能获得正确的"上一次 isActive"值
  const prevActiveIndicesRef = useRef<Set<number>>(new Set<number>());
  const everRenderedSetRef = useRef<Set<number>>(new Set<number>());
  // 各滑片下标当前"占据者" img.id：删除导致索引重排换图时，同一滑片应视为"未曾活跃"，
  // 从而为新占据者触发入场动画（否则 wasActive 沿用旧图的历史，新图会瞬跳无动画）
  const indexOccupantRef = useRef<Map<number, number>>(new Map());
  const wasActiveMap = useMemo(() => {
    const map = new Map<number, boolean | undefined>();
    const occupant = indexOccupantRef.current;
    for (const index of nearActiveSet) {
      const occupantId = images[index]?.id ?? index;
      const occupantChanged = occupant.get(index) !== occupantId;
      if (everRenderedSetRef.current.has(index)) {
        // 之前渲染过：若占据者换过图则视为"未曾活跃"（新图据此入场），否则沿用上一次 isActive
        map.set(index, occupantChanged ? false : prevActiveIndicesRef.current.has(index));
      }
      // 之前没渲染过：不设置，wasActiveMap.get(index) 返回 undefined
      occupant.set(index, occupantId);
    }
    // 更新已渲染集合
    for (const index of nearActiveSet) {
      everRenderedSetRef.current.add(index);
    }
    prevActiveIndicesRef.current = activeIndices;
    return map;
  }, [activeIndices, nearActiveSet, images]);

  // 占位 slide：一次性创建空 SwiperSlide，延迟到 overlay 打开时创建
  // 退出动画期间保留缓存，避免 Swiper 收到空子元素触发大量内部更新
  // 增量缓存：分页加载时只为新增图片创建占位，避免全量重建 1000+ React Element
  const placeholderSlidesCacheRef = useRef<React.ReactElement[]>([]);
  const placeholderSlides = useMemo(() => {
    if (isOpen) {
      const prev = placeholderSlidesCacheRef.current;
      if (prev.length === images.length) return prev;
      // 图片数量减少（不应发生），截断
      if (prev.length > images.length) {
        const result = prev.slice(0, images.length);
        placeholderSlidesCacheRef.current = result;
        return result;
      }
      // 增量：只为新增的图片创建占位 slide
      const result = prev.slice();
      for (let i = prev.length; i < images.length; i++) {
        result.push(<SwiperSlide key={i} virtualIndex={i} />);
      }
      placeholderSlidesCacheRef.current = result;
      return result;
    }
    return placeholderSlidesCacheRef.current;
  }, [isOpen, images.length]);

  // 创建单个 slide 的内容（提取为函数，Virtual 和非 Virtual 模式共用）
  const renderSlideInner = useCallback((index: number) => {
    const img = images[index];
    // 全部删除后 overlay 关闭前的一瞬 n 可能为 0，或 %0 使 nearActiveSet 产生 NaN/Fractional 下标：
    // 该下标无对应图片时返回空占位，避免访问 img.thumbSrc 崩溃。
    if (!img) return { node: <div data-img-index={index} />, slideClassName: "", overflowClip: false };
    // 并发预加载：范围内图片就绪前用缩略图兜底，分块完成后无缝替换为 blob URL；
    // 范围外图片保持原生 lazy 加载原始 src，避免与预加载产生双份下载。
    const readySrc = preloader.getReadySrc(index);
    // 原图下载只由预加载器负责（避免"原生 <img> 整包 + 预加载分块"双重下载同一原图）。
    // 范围外可见 slide 不再用 img.src 原生拉原图，就绪前一律用缩略图兜底；
    // 该 slide 进入中心/范围后由预加载器下载并替换为就绪的 src/blob。
    // 视图模式切换过渡期（isTransitioningViewMode，覆盖 0.4s 位移/缩放动画）：原图若此刻加载完成，
    // 立即切到原图会因宽高比/尺寸不同在动画进行中"错位/跳动"。过渡期强制保持缩略图兜底，
    // 待 isTransitioningViewMode=false（动画已稳定、位形已定）后再切到就绪原图，视觉无跳变。
    const displaySrc =
      isTransitioningViewMode && img.thumbSrc
        ? img.thumbSrc
        : readySrc ?? (img.thumbSrc || img.src);
    // 当前活跃图（单图=中心，双图/三图/多图=全部可见图）：任一原图尚未就绪时都稳定显示转圈，
    // 而非仅 index===realIndex 的第一张，保证所有共视图加载进度一致可见
    // 切换/视图过渡动画进行中（inMove）不显示转圈：此时缩略图兜底在飞入，叠加转圈会破坏入场观感；
    // 动画进行中（inMove）不显示转圈：缩略图兜底在飞入/平移，叠加转圈会破坏观感。
    // 除"切换/视图过渡"外，**删除动画（补位平移 + 新图入场）**同样属于 inMove——
    // 删除不走 swiper slideTo、isSwipeAnimating 为 false，若不加会删除平移时冒出转圈
    // （与"下一张"切换一致：平移阶段不转圈，落位后再显示加载中转圈）。重排提交后（deletingReshapedRef）
    // 删除动画视作结束，恢复转圈。
    const inMove =
      isSwipeAnimating ||
      isTransitioningViewMode ||
      (deletingId != null && !deletingReshapedRef.current);
    const thumbReady = Boolean(img.thumbSrc) && thumbLoadedRef.current.has(img.thumbSrc);
    const showSpinner =
      activeIndices.has(index) &&
      !Boolean(readySrc) &&
      (!inMove || !thumbReady);
    // 该图原图下载进度：total 已知时用真实百分比驱动进度环；未知（如关闭分块的整块下载/尚未开始）回退为转圈
    const prog = preloader.getProgress(img.src);
    const progressKnown = Boolean(prog && prog.total > 0);
    const downloadProgress = progressKnown && prog ? (prog.loaded / prog.total) * 100 : 0;
    preloader.markRendered(index);
    const relIdx = ((index - realIndex) % n + n) % n;
    const prevVM = prevViewMode;
    const newVM = viewMode;
    let entryXFrom: number | undefined = undefined;
    let entryScaleFrom: number | undefined = undefined;
    let isExitingOnViewModeChange = false;
    if (
      isTransitioningViewMode &&
      prevVM !== newVM &&
      containerWidth > 0 &&
      relIdx < Math.max(prevVM, newVM)
    ) {
      const getGap = (vm: number) => vm > 1 ? 8 : 0;
      const getSlideW = (vm: number) => (containerWidth - (vm - 1) * getGap(vm)) / vm;
      const getSlideCenter = (idx: number, vm: number) =>
        idx * (getSlideW(vm) + getGap(vm)) + getSlideW(vm) / 2;

      const oldCenter = getSlideCenter(relIdx, prevVM);
      const newCenter = getSlideCenter(relIdx, newVM);
      entryXFrom = oldCenter - newCenter;

      // 缩放补偿优先用"原图"自然尺寸；原图未就绪时用"缩略图"自然尺寸（当前实际显示内容），
      // 使过渡初始大小与切换按下前一致，避免退化为 newVM/prevVM 在宽高比不符时"中心图突然放大"。
      // 注意：动画期间（isTransitioningViewMode）必须**固定用缩略图尺寸**（此时 displaySrc 正是缩略图，
      // 实际显示内容一致），且不能因原图在动画中加载完成而改用原图尺寸——否则 entryScaleFrom 中途
      // 变化会让补偿动画 effect（依赖 entryScaleFrom）重跑第二遍 → "原图加载中切视图，图播放两遍动画"。
      const dims =
        isTransitioningViewMode
          ? thumbDimsRef.current.get(img.id)
          : preloader.getDims(index) ?? thumbDimsRef.current.get(img.id);
      let baseScaleFrom: number;
      if (dims && containerHeight > 0) {
        const oldSize = computeContainedSize(dims.w, dims.h, getSlideW(prevVM), containerHeight);
        const newSize = computeContainedSize(dims.w, dims.h, getSlideW(newVM), containerHeight);
        baseScaleFrom = oldSize.w / newSize.w;
      } else {
        baseScaleFrom = newVM / prevVM;
      }
      // 折叠切换前的"外层缩放/拖拽"到补偿起点（指令集在 changeViewMode 已把外层置为身份变换）：
      //   - 缩放：起点倍数再乘当前 scale，使动画从"当前缩放大小"连续放大/缩小到新模式默认；
      //   - 平移：当前 x/y 叠加进 entryXFrom/entryYFrom，使起点位置 = 当前拖拽位置。
      // 无快照（非 changeViewMode 触发的降级/自动切换）时退化为不折叠，行为与原一致。
      const snap = viewSwitchFromRef.current.get(index);
      if (snap) {
        baseScaleFrom *= snap.scale;
        entryXFrom += snap.x;
      }
      entryScaleFrom = baseScaleFrom;

      if (relIdx < prevVM && relIdx >= newVM) {
        isExitingOnViewModeChange = true;
      }
    }
    const viewModeOffsetX = 0;
    const slideWidth = containerWidth / viewMode;
    const entryAnimXOffset = slideWidth > 0 ? slideWidth * 0.6 : 60;
    // 删除平移动画：右侧幸存图平移到被删图让出的槽位，起始偏移＝一格槽距（槽宽＋槽缝），
    // 从"原位置"无缝滑入新位置（正好左移一格）
    const slotGap = viewMode > 1 ? 8 : 0;
    const slotW = containerWidth > 0 ? (containerWidth - (viewMode - 1) * slotGap) / viewMode : containerWidth;
    const deleteTranslateX = slotW + slotGap;
    const viewModeZIndex = (() => {
      if (!isTransitioningViewMode) return undefined;
      // 过渡期已放开裁剪（图像可越过自身槽位边界），层叠顺序必须随之调整：
      // 新进入的图（relIdx >= prevVM 且 < newVM）与退出的图（relIdx < prevVM 且 >= newVM）
      // 都置于最上层，飞入/淡出全程不被保留图盖住；
      // 保留图（重新定位/缩放的图）在下层，随新图飞入/退出图淡出让位。
      const isNewEntering = relIdx >= prevVM && relIdx < newVM;
      const isExiting = relIdx < prevVM && relIdx >= newVM;
      if (isNewEntering || isExiting) return 2;
      if (relIdx < prevVM) return 1;
      return undefined;
    })();
    const isActive = activeIndices.has(index);
    // 删除是否发生在当前活跃行内（被删图落在 [realIndex, realIndex+viewMode)）。
    // 仅此场景需要右侧幸存图左移补位；删除活跃行之外的图走 realIndex 前移，不在此列。
    const deletedInActiveRow =
      lastDeletedIndexRef.current >= 0 &&
      lastDeletedIndexRef.current >= realIndex &&
      lastDeletedIndexRef.current < realIndex + viewMode;
    // 删除窗口（重排前）：被删图右侧"整段"图（index > lastDeleted）绑定同一个共享 groupShiftX，
    // 一次性平滑左移一格补位（源码级，多卡由同一动画源驱动零失步）；被删图左侧图不绑定 → 原地不动。
    // 重排后（deletingReshapedRef）rider 位移必须与数组缩水同一 commit 解除绑定：
    // removeEpoch 提交时 images 已把被删图移除、下标左移一格（原图1→新0、原图2→新1、原图3→新2），
    // 各卡"可视化被左移一格后落点"恰好等于其重排后的新槽位。若这里还保留 groupShiftX=-一格 的旧位移
    // （groupShiftX 要到 runReset 才归零），会在这个 commit 之后的帧里叠加一格外移 → 槽0被原槽1的
    // 幸存图盖上形成叠影、槽2被再后一张图占据（"新入图的下一张"闪烁）。故 rider 必须 gate
    // !deletingReshapedRef，让这段位移与该 commit 同帧松开；因数组已同 commit 缩水，绝不回弹——
    // "被删图已移除、rider 又弹回原位"的前提不可能成立。解绑不影响 lastDeletedIndexRef，
    // deleteFillTarget 的"已静置不再入场"抑制仍由它维持。
    const groupShiftOn =
      isOpen &&
      !deletingReshapedRef.current &&
      deletedInActiveRow &&
      lastDeletedIndexRef.current >= 0;
    // 右侧整段（含被删图右侧幸存图、进入的新图）；被删图自身除外（它走自定义缩小飞出动画）。
    const rider = groupShiftOn && index > lastDeletedIndexRef.current;
    // 历史逐卡"左移补位"已由共享平移 groupShiftX 取代，恒为关闭（右侧由同一共享值统一驱动）。
    const deleteShiftActive = false;
    // 重排后装到新槽位的右幸存图（按 img.id 记，跨重挂载稳定）：对象已就地完成左移补位，
    // 重挂载后静置到位，不再重放进场/补位动画（避免"闪一下再位移"）。
    // 用"静置时刻新鲜度"判定：时间戳在重排提交时刷新，窗口（DELETE_FILL_VALID_MS）内
    // 重挂载/抖动的幸存卡仍按已静置处理，窗口外自然失效，恢复正常入场判定。
    const fillSettledAt = relocateFillIdsRef.current.get(img.id);
    const deleteFillTarget =
      isOpen &&
      lastDeletedIndexRef.current >= 0 &&
      fillSettledAt != null &&
      performance.now() - fillSettledAt < DELETE_FILL_VALID_MS;
    // 仅"右幸存图"（非 incoming）：重排后已就地移动到位，顶部名称/功能按钮栏重挂载时跳过入场淡入，
    // 避免"平移到位了名称又加载一遍"。incoming 是真·新图，重排后变活跃时名称栏仍正常淡入。
    const survivorSettledAt = relocateSurvivorFillIdsRef.current.get(img.id);
    const deleteSurvivorFillTarget =
      isOpen &&
      lastDeletedIndexRef.current >= 0 &&
      survivorSettledAt != null &&
      performance.now() - survivorSettledAt < DELETE_FILL_VALID_MS;
    // 删除窗口（重排前）：从右侧进入新末位的下一张图（index === realIndex+viewMode，非活跃）做
    // 与纯"切换下一张"入场逐点同源的"缩放+淡入+飞入"；其横向"左移一格落位"已由共享 groupShiftX
    // 承担（本卡同时是右侧 rider），故这里只驱动入场视觉(scale/opacity/entryX +0.6格→0)。
    // 重排后(realIndex+viewMode 下标已被后图占据)该卡自然不再命中，静置由 deleteFillTarget 接管。
    const deleteEntryTarget =
      (!serialAnim || deleteMotionStarted) &&
      (!serialAnim || viewMode > 1) &&
      isOpen &&
      !deletingReshapedRef.current &&
      deletedInActiveRow &&
      index === realIndex + viewMode;
    // 单图+并行：新入图入场不淡入（直接不透明），避免半透明期透出下方不透明的吸入旧图 → 主体看不到新图。
    const entryNoFade = !serialAnim && viewMode === 1 && deleteEntryTarget;
    // 该图当前是否被缩放/拖拽而贴到滑片边界。是则给图片施加边缘淡出遮罩，
    // 让贴边/即将被裁剪的部分呈现半透明软过渡，而非一条生硬的裁剪线。
    // 滑片仍保持 overflow-hidden，各图片不会拖进相邻图片。
    const motionsNow = getOrCreateImageMotions(index);
    const imgOverflowing =
      isActive &&
      (motionsNow.scale.get() > 1 ||
        Math.abs(motionsNow.x.get()) > 1 ||
        Math.abs(motionsNow.y.get()) > 1 ||
        imgDraggingIdx === index);
    const isFirstInRow = (index - realIndex + n) % n === 0;
    const isLastInRow = (index - realIndex + n) % n === viewMode - 1;
    const inRow = (index - realIndex + n) % n < viewMode;
    // 横向只裁"朝向相邻图片"的那一侧；朝外一侧用负值 inset 不裁（上下始终不裁、全透）。
    // 首张：只裁右（左透）；末张：只裁左（右透）；中间：左右都裁；单图：全部不裁。
    // 删除窗口内就地移动的图（左移补位的幸存图 / 标准入场的下一张）一律不裁：
    // 它们的位移会越过自身槽位边界，若保持 clip-path 会"越过中线的像素被裁掉"。
    let horizontalClip: string | undefined;
    if (viewMode === 1 || rider || isTransitioningViewMode) {
      // rider（右侧整段共享平移）位移会越过自身槽位边界，必须放开裁剪，否则越过中线的像素被裁掉；
      // 视图切换过渡中（isTransitioningViewMode）同样放开：被保留图/新入图正从旧位置平移+缩放到新位置，
      // 会越过自身新槽位边界。若仍按新槽位裁剪，图像边缘被裁掉、暴露槽位间隔 →"动画开始前就出现分隔条"。
      horizontalClip = undefined;
    } else {
      const clipLeft = inRow ? !isFirstInRow : true;
      const clipRight = inRow ? !isLastInRow : true;
      if (clipLeft || clipRight) {
        const L = clipLeft ? "0" : "-9999px";
        const R = clipRight ? "0" : "-9999px";
        horizontalClip = `inset(-9999px ${R} -9999px ${L})`;
      }
    }
    // 外层盒子不裁（rider 时 horizontalClip 为 undefined），但被放大/拖拽图横移时会漏出到相邻槽位。
    // 把"裁剪到目标槽位"改放到随 groupShiftX 平移的内层上（movingClipPath）。方向按"落位后的槽位"
    // 判定（右幸存图左移一格 → relIdx-1，与切换 next 落位一致）：随盒平移中始终裁剪到目标槽位，
    // 放大图多余的横向溢出不会越过中线漏到相邻卡。
    let movingClipPath: string | undefined;
    // 单图并行的“进入图”(deleteEntryTarget)不裁：它整格在屏幕右侧一屏外，groupShiftX 把图左移进中央，
    // 若仍按自身盒裁切会把图裁死在右格里（只露一条缝）→ 必须放开才能飞进中央。
    if (rider && !devDisableSurvivorAnim && !(viewMode === 1 && deleteEntryTarget)) {
      if (viewMode > 1) {
        const landRel = relIdx - 1; // 右幸存图左移一格后落位
        const landInRow = landRel < viewMode;
        const landFirst = landRel === 0;
        const landLast = landRel === viewMode - 1;
        const landClipLeft = landInRow ? !landFirst : true;
        const landClipRight = landInRow ? !landLast : true;
        if (landClipLeft || landClipRight) {
          const L = landClipLeft ? "0" : "-9999px";
          const R = landClipRight ? "0" : "-9999px";
          movingClipPath = `inset(-9999px ${R} -9999px ${L})`;
        }
      } else {
        // 单图模式：进入/补位的 rider 左移一整格，被放大图会让像素越过自身（容器）边界泄出到画布/暗边，
        // 与别图重叠。随盒裁切到自身盒子两侧（左右都裁、上下不裁）：平移中始终裁剪到容器范围。
        movingClipPath = "inset(-9999px 0 -9999px 0)";
      }
    }
    // 溢出透图时隐藏非活跃相邻图：窄屏下 canvas 宽度小，相邻滑片会有一部分落到屏幕边缘，
    // 若不隐藏会从半透明"框架"区域直接看到左右两张邻图。
    // 例外一：正在被删除的图（删除飞出动画期间）即使已非活跃也保持可见，否则它的向上飞出效果会被隐藏。
    // 例外二：视图切换转场中（isTransitioningViewMode）要放行退出动画的可见性，不在此隐藏；
    //        三图/双图切换完成（转场结束）后再隐藏非活跃邻图，杜绝"第一张左边 / 第三张右边
    //        看到别的图片边缘"——因为容器/Swiper 现在恒 overflow:visible，邻图会透过半透明
    //        框架边缘露出来。
    // 例外三：普通滑动过渡中（isSwipeAnimating）要放行正在退出/进入的邻图可见性，不在此隐藏；
    //        过渡结束回到空闲后再隐藏非活跃邻图。否则切换时左边的图从飞出一开始就被隐藏，
    //        用户看不到它向左侧飞出（症状：切换只剩新图淡入，旧图消失于无形）。
    // 例外四：删除窗口内"从右侧进入新末位的下一张图"（deleteEntryTarget）非活跃却要播放与切换
    //        相同的"缩放+淡入+飞入"，若被此处隐藏，其飞入全程不可见，重排后静置归位则表现为
    //        新图"直接出现"而非飞入。故删除期间放行它，保证飞入可见。
    const neighborHidden =
      !isActive &&
      lastDeletedIndexRef.current !== index &&
      !deleteEntryTarget &&
      (
        // 缩放/拖拽溢出时隐藏非活跃邻图（防其从半透明框架漏出）。但在视图切换过渡中
        // 必须放行"正在退出/进入"的邻图——否则被放大图的存在（imgOverflowActive=true）
        // 会在过渡一开始就把第二张等邻图瞬间隐藏，导致它们"直接消失、无退出动画"。
        (!isTransitioningViewMode && !isSwipeAnimating && imgOverflowActive) ||
        (!isTransitioningViewMode && !isSwipeAnimating) ||
        // 视图切换过渡中（单图→双图/三图、双图→三图等"变多"方向）：隐藏"新布局之外、与动画无关"
        // 的非活跃邻图，防止它们从半透明框架/屏幕边缘漏出（容器/Swiper 恒 overflow:visible）。
        // 但放行正在退出的图（isExitingOnViewModeChange，双图/三图→单图 时需可见以播放退出动画），
        // 以及正在进入的图（relIdx < newVM 已在 activeIndices 中，不在此分支）。
        (isTransitioningViewMode && !isExitingOnViewModeChange && relIdx >= newVM)
      );
    const innerDivStyle: React.CSSProperties = {
      ...(viewModeZIndex != null ? { position: "relative", zIndex: viewModeZIndex } : {}),
      // overflow 全 visible（横/纵都能溢出透出），横向是否被裁完全交给上面的 clip-path
      overflow: "visible",
      ...(horizontalClip ? { clipPath: horizontalClip, WebkitClipPath: horizontalClip } : {}),
      // neighborHidden（过渡期隐藏无关邻图）或 Dev"隐藏主图"（visibility 保留布局，仅不可见）
      ...(neighborHidden || devHideMainImage ? { visibility: "hidden" } : {}),
    };
    // 该滑片内容（图片+motion）与滑片外壳(overflow 裁剪)拆分：
    // - 非虚拟(小 n)：外壳 = SwiperSlide，内容放其内部
    // - 虚拟(大 n)：内容放入独立分层(absolute)，盖在 Swiper 空占位滑片上，避免每次切图重渲染全量 children
    // 单图模式下的 overflow 裁剪：仅当图片未溢出（未被缩放/拖拽）时裁剪。
    // 用订阅式 imgOverflowActive（真实监听 scale/x/y 变化并触发重渲染）而非渲染期读
    // motionsNow.scale.get()（滚轮缩放只改 motion 值不触发重渲染，会停留在旧值 → 必须拖一次才透图）。
    // 单图模式下可见滑片即 realIndex，imgOverflowActive 恰反映它，故可直接使用。
    const overflowClip = viewMode === 1 && !isTransitioningViewMode && !imgOverflowActive && !deleteEntryTarget;
    const slideClassName = `!flex h-full min-h-0 items-center justify-center${overflowClip ? " !overflow-hidden" : ""}`;
    const node: React.ReactElement = (
        <div
          data-img-index={index}
          className="relative flex h-full min-h-0 w-full items-center justify-center"
          style={innerDivStyle}
        >
          <motion.div
            drag={!isPinching}
            dragElastic={0}
            dragMomentum={false}
            onDragStart={() => {
              setImgDraggingIdx(index);
              imageDragSuppressedRef.current = true;
              if (swiperRef.current) {
                swiperRef.current.allowTouchMove = false;
              }
            }}
            onDragEnd={() => {
              setImgDraggingIdx(null);
              if (swiperRef.current) {
                swiperRef.current.allowTouchMove = !isZoomedRef.current;
              }
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              x: motionsNow.x,
              y: motionsNow.y,
              scale: motionsNow.scale,
              opacity: motionsNow.opacity,
              rotate: motionsNow.rotate,
              willChange: "transform, opacity",
              touchAction: "none",
            }}
            className="flex h-full min-h-0 w-full items-center justify-center"
          >
            <MemoAnimatedSlideImg
              src={displaySrc}
              underlaySrc={img.thumbSrc}
              alt=""
              isActive={isActive}
              wasActive={wasActiveMap.get(index)}
              // 删除窗口内"从右侧进入的新图"（deleteEntryTarget）会被驱动同步飞入主图位置，
              // 但它未激活、处于视口右缘之外，loading=lazy 会因"不在视口内"而不发起加载 → 飞入全程
              // 无内容（空白），结束后才重新请求 → "直接出现"。故删除入场的新图强制 eager，让它在
              // 飞入的 0.4s 内尽早用缩略图/分块就绪，可见地滑入（同时与删除动画并行）。
              loading={index === realIndex || deleteEntryTarget ? "eager" : "lazy"}
              showSpinner={showSpinner}
              downloadProgress={downloadProgress}
              progressKnown={progressKnown}
              // originalReady：重排后重挂载的"右幸存图"原图早已显示，置 true 让新实例直接以原图
              // 显示、跳过底层缩略图加载淡入（避免平移到位瞬间闪现缩略图）。
              // 但"删除窗口内从右侧进入的新图"（deleteEntryTarget）此刻原图可能刚就绪（displaySrc
              // 从缩略图切到原图）：若也置 true，会提前撤掉底层缩略图、主图 opacity 强制 1，而原图
              // 尚未解码 → 缩略图与原图之间出现一小段黑屏。该新图应完全复用"切换事件"的加载逻辑
              // （缩略图常驻底层，等 imgLoaded 后再淡入原图），故排除 deleteEntryTarget。
              originalReady={
                // 仅"右幸存图"（deleteSurvivorFillTarget，不含 incoming）在重挂载时直接以原图显示：
                // 它们删除前已在屏幕上显示过原图，浏览器解码已缓存，opacity=1 立即显示不闪。
                // incoming（删除窗口内从右侧进入的新图）原图是"刚下载、从未显示过"的，<img> 重挂载后
                // 需重新解码——若也置 originalReady=true 会撤掉缩略图底层并强制 opacity=1，首帧空白闪烁。
                // 它必须完全复用"切换下一张"的加载逻辑（缩略图底层常驻，等原图解码后再淡入）。
                Boolean(readySrc) &&
                deleteFillTarget &&
                deleteSurvivorFillTarget &&
                !deleteEntryTarget
              }
              thumbKey={img.thumbSrc}
              onThumbLoaded={onThumbLoaded}
              viewModeEpoch={viewModeEpoch}
              deleteEpoch={deleteEpoch}
              deleteShiftActive={deleteShiftActive}
              deleteFillTarget={deleteFillTarget}
              deleteFillSettledAt={fillSettledAt}
              deleteEntryTarget={deleteEntryTarget}
              entryNoFade={entryNoFade}
              deleteTranslateX={deleteTranslateX}
              groupShiftX={rider ? groupShiftX : undefined}
              groupShiftScaleX={rider ? motionsNow.scale : undefined}
              movingClipPath={movingClipPath}
              viewModeOffsetX={viewModeOffsetX}
              entryXFrom={entryXFrom}
              entryScaleFrom={entryScaleFrom}
              entryXOffset={entryAnimXOffset}
              slideDirectionRef={slideDirectionRef}
              isExitingOnViewModeChange={isExitingOnViewModeChange}
              entryX={motionsNow.entryX}
              onExitComplete={() => {
                const m = imageMotionsMapRef.current.get(index);
                if (m) {
                  m.x.set(0);
                  m.y.set(0);
                  m.scale.set(1);
                  m.opacity.set(1);
                  m.rotate.set(0);
                }
              }}
            />
          </motion.div>
          {isActive && deletingId !== img.id && (
            <motion.div
              className="pointer-events-none absolute left-3 top-[calc(56px-20px)] z-10 flex items-center gap-3"
              style={{ x: rider ? groupShiftX : 0, willChange: "transform" }}
            >
              {/* 名称栏：序号 / 名称 / 尺寸 / 大小。与操作按钮分开，单独成栏。幸存图重排重挂载时跳过入场淡入 */}
              <motion.div
                initial={deleteSurvivorFillTarget ? false : { y: -24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.35, delay: 0.3, ease: "easeOut" }}
                className="pointer-events-none min-w-0 rounded-full car__ctrl px-3 py-1 text-xs font-medium whitespace-nowrap sm:backdrop-blur-sm"
              >
                {renderOverlay ? renderOverlay({ image: img, index, total: totalCount, isActive }) : (
                  <>
                    <span>{index + 1} / {totalCount}</span>
                    <span
                      className="ml-2 inline-block truncate align-bottom"
                      style={{ maxWidth: "min(42vw, 260px)", color: themeTokens.textDim }}
                    >{renamedMapRef.current.get(img.id) ?? img.alt}</span>
                    {img.dimensions
                      ? <span className="ml-2" style={{ color: themeTokens.textFaint }}>{img.dimensions}</span>
                      : (img.width && img.height && <span className="ml-2" style={{ color: themeTokens.textFaint }}>{img.width}×{img.height}</span>)
                    }
                    {img.sizeLabel
                      ? <span className="ml-2" style={{ color: themeTokens.textFaint }}>{img.sizeLabel}</span>
                      : (img.fileSize != null && <span className="ml-2" style={{ color: themeTokens.textFaint }}>{formatFileSize(img.fileSize)}</span>)
                    }
                  </>
                )}
              </motion.div>

              {/* 操作按钮栏：等尺寸方形、自身 flex 水平对齐（下载 / 重命名 / 删除） */}
              {!renderOverlay && (
                <motion.div
                  initial={deleteSurvivorFillTarget ? false : { y: -24, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.35, delay: 0.3, ease: "easeOut" }}
                  className="pointer-events-auto flex shrink-0 items-center gap-2"
                >
                  {onDownload && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDownload(index); }}
                      className="inline-flex items-center justify-center rounded-full car__ctrl transition-transform hover:scale-105 active:scale-95"
                      style={{ width: 24, height: 24, color: themeTokens.textDim }}
                      aria-label="Download"
                      title="Download"
                    >
                      {DownloadIcon}
                    </button>
                  )}
                  {actionsConfig.map((a) => {
                    const disabled = a.enabled === false || deletingId === img.id;
                    const ctx: CarouselActionCtx = { image: img, index, total: totalCount };
                    return (
                      <button
                        key={a.key}
                        disabled={disabled}
                        data-carousel-action={a.key}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (a.key === "delete") {
                            const btn = e.currentTarget as HTMLButtonElement;
                            const slideRoot = btn.closest("[data-img-index]");
                            const mainImg = slideRoot?.querySelector("[data-carousel-main-img]") as HTMLImageElement | null;
                            const r = btn.getBoundingClientRect();
                            flyOutAndRemove(index, img, { x: r.left + r.width / 2, y: r.top + r.height / 2 }, mainImg);
                          } else if (a.key === "rename") startRename(index, img);
                          a.onSelect?.(ctx);
                        }}
                        className="inline-flex items-center justify-center rounded-full car__ctrl transition-transform hover:scale-105 active:scale-95"
                        style={{ width: 24, height: 24, color: disabled ? themeTokens.textFaint : themeTokens.textDim }}
                        aria-label={a.label}
                        title={a.label}
                      >
                        {a.icon}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </motion.div>
          )}
        </div>
    );
    return { node, slideClassName, overflowClip };
  }, [images, realIndex, n, prevViewMode, viewMode, isTransitioningViewMode, isSwipeAnimating, containerWidth, containerHeight, preloader, preloader.version, isPinching, activeIndices, wasActiveMap, viewModeEpoch, slideDirectionRef, getOrCreateImageMotions, renderOverlay, onDownload, imgDraggingIdx, imgOverflowActive, actionsConfig, flyOutAndRemove, startRename, deletingId, renamedMapRef, renameSeq, deletingReshapedRef, onThumbLoaded, devHideMainImage, devDisableSurvivorAnim, deleteMotionStarted, serialAnim]);

  // 非虚拟(<n)：内容包回 SwiperSlide，行为与原来完全一致
  const renderSlideContent = useCallback((index: number) => {
    const { node, slideClassName } = renderSlideInner(index);
    const occupantId = images[index]?.id ?? index;
    return (
      // key 用稳定的 img.id（而非 `${index}-${occupantId}`）：删除重排时索引平移会让每张卡的
      // key 全变 → 全部重挂载 → 新 <img> 重新解码/请求缩略图（"再次加载一张一模一样缩略图"闪烁）；
      // 原图未就绪的新入图重挂载后加载态重置 → 到位处再闪一次。改按 img.id 后，删除只卸载被删图，
      // 幸存图/新入图 key 不变、React 仅移动 DOM（保留 <img> 与加载态）→ 不闪。
      // 真·换图（同一滑片换 occupant，如导航/视图切换）key 变化仍会重挂载，触发新图入场，逻辑不变。
      <SwiperSlide key={occupantId} virtualIndex={index} onClick={(e) => e.stopPropagation()} className={slideClassName}>
        {node}
      </SwiperSlide>
    );
  }, [renderSlideInner, images]);

  // 虚拟(大 n)：内容包进绝对定位分层，盖在 Swiper 空占位滑片之上。
  // 分层经 createPortal 放进 .swiper-wrapper，继承其 transform，切图时仅重渲染近活跃窗口。
  // left 用 index*(virtualCellW+virtualSpaceBetween) 计算：占位滑片即按相同节距(pitch)流式排布，
  // 相对 wrapper 原点逐像素对齐，且不依赖 Swiper 内部 slidesGrid（其每次 update 都重建为新数组，
  // 曾因捕获旧引用导致切换双图/三图 viewMode 后仍按旧节距定位、图片被推出视口）。
  const virtualSpaceBetween = viewMode > 1 ? 8 : 2;
  const virtualCellW = containerWidth > 0 ? (containerWidth - (viewMode - 1) * virtualSpaceBetween) / viewMode : 1;
  const renderVirtualOverlaySlide = useCallback((index: number) => {
    const { node, overflowClip } = renderSlideInner(index);
    const left = index * (virtualCellW + virtualSpaceBetween);
    // key 带上占据者 img.id：删除后同一滑片换了图会重挂载，配合 occupant 感知的
    // wasActiveMap 让"顶替进来的新图"重新走入场动画（否则主图切换无动画且可能一帧闪烁）
    const occupantId = images[index]?.id ?? index;
    return (
      <div
        key={`${index}-${occupantId}`}
        style={{ position: "absolute", top: 0, left, width: virtualCellW, height: "100%", overflow: overflowClip ? "hidden" : "visible" }}
      >
        {node}
      </div>
    );
  }, [renderSlideInner, virtualCellW, virtualSpaceBetween, images]);

  // 活跃 slide：统一使用浅拷贝占位 + 只替换 nearActiveSet 中的项
  // 避免 images.map() 全量创建 React Element（1000+ 张时每次切图都要重建）
  // 延迟到 overlay 打开时计算，退出动画期间保留缓存
  // 虚拟模式(大 n)下 Swiper 只接收稳定的 placeholderSlides，slides 从不被使用，
  // 若仍计算会在每次切图时无谓重建 nearActiveSet 的完整 JSX（实测 ~29ms/点击）
  const slidesCacheRef = useRef<React.ReactElement[]>([]);
  const slides = useMemo(() => {
    if (!isOpen || useVirtual) return slidesCacheRef.current;
    const result = placeholderSlides.slice();
    for (const index of nearActiveSet) {
      result[index] = renderSlideContent(index);
    }
    slidesCacheRef.current = result;
    return result;
  }, [isOpen, useVirtual, placeholderSlides, nearActiveSet, renderSlideContent, preloader.progressVersion]);

  // 缩略图预加载：窗口移位前提前缓存渲染窗口外的缩略图。
  // 窗口移位时新缩略图 <img> 重挂载，若未缓存会触发网络请求+JPEG 解码造成卡顿（实测可达 1s）；
  // 预加载后移位瞬间从浏览器缓存即时显示，消除卡顿。
  useEffect(() => {
    if (!isOpen) return;
    const centerIdx = isStripDragging ? stripDragVisibleIdx : isKeyboardActive ? pendingRealIndex : realIndex;
    const range = (isStripDragging ? STRIP_DRAG_VIRTUAL_RANGE : STRIP_VIRTUAL_RANGE) + THUMB_PRELOAD_LOOKAHEAD;
    const startIdx = Math.max(0, centerIdx - range);
    const endIdx = Math.min(n - 1, centerIdx + range);
    for (let i = startIdx; i <= endIdx; i++) {
      const img = images[i];
      if (!img || !img.thumbSrc || img.thumbSrc.startsWith("blob:")) continue;
      // 记录缩略图自然尺寸（供视图切换缩放补偿）：独立于网络预加载去重。
      // 若随预加载一起（去重后不新建 Image），已缓存的缩略图不会触发 onload → 尺寸缺失，
      // 视图切换时只能退化 newVM/prevVM，方形/接近方形内容会被错误放大 2x（"中心图突然放大"）。
      if (!thumbDimsRef.current.has(img.id)) {
        const dim = new Image();
        dim.decoding = "async";
        dim.onload = () => {
          thumbDimsRef.current.set(img.id, { w: dim.naturalWidth, h: dim.naturalHeight });
        };
        dim.src = img.thumbSrc;
      }
      if (thumbPreloadCacheRef.current.has(img.thumbSrc)) continue;
      thumbPreloadCacheRef.current.add(img.thumbSrc);
      const im = new Image();
      im.decoding = "async";
      im.src = img.thumbSrc;
    }
  }, [isOpen, realIndex, pendingRealIndex, isKeyboardActive, isStripDragging, stripDragVisibleIdx, n, images]);

  // 缩略图条虚拟化列表：仅当 realIndex/active/loaded 变化时重算
  // 使用绝对索引定位（offsetX = i*pitch），配合 stripItemCacheRef 复用未变化的 JSX，
  // 切图时仅重建 active 变化的项（~2-3 个），避免全量重建 41 个 ThumbnailItem
  const stripItems = useMemo(() => {
    // 拖拽时以拖拽可见中心为基准，键盘/按钮长按时以 pendingRealIndex 为基准，确保即将进入视口的缩略图已渲染
    const centerIdx = isStripDragging ? stripDragVisibleIdx : isKeyboardActive ? pendingRealIndex : realIndex;
    const range = isStripDragging ? STRIP_DRAG_VIRTUAL_RANGE : STRIP_VIRTUAL_RANGE;
    const startIdx = Math.max(0, centerIdx - range);
    const endIdx = Math.min(n - 1, centerIdx + range);
    const thumbActiveTarget = isKeyboardActive ? pendingRealIndex : realIndex;
    const activeScale = isKeyboardActive ? 1 : (viewMode === 1 ? CENTER_SCALE : viewMode === 2 ? 1.15 : 1.1);
    const stripHeight = STRIP_ROW_HEIGHT;
    const cache = stripItemCacheRef.current;
    const newPositions = new Map<number, number>();
    const items = [];
    // 删除窗口（重排前，deletingId 非空）：被删缩略图右侧的幸存项由共享 thumbGroupShiftX 驱动
    // 左移一格合并（与飞出同帧）；重排后（deletingId 置空）恢复正常绝对索引布局。
    const deletedIndex = deletingId != null && !deletingReshapedRef.current ? lastDeletedIndexRef.current : -1;
    const thumbPitch = THUMB_SIZE + THUMB_GAP;
    // 删除窗口内：若删除发生在活跃行内，行末的"新入图"（realIndex+viewMode）将补入活跃行。
    // 让它与合并/补位**同帧**放大高亮（参考切换事件：进入即高亮，而非到位后再放大/缩放）。
    const deleteInActiveRow = deletedIndex >= realIndex && deletedIndex < realIndex + viewMode;
    const incomingIdx = realIndex + viewMode;
    for (let i = startIdx; i <= endIdx; i++) {
      const img = images[i];
      const active =
        (i >= thumbActiveTarget && i < thumbActiveTarget + viewMode) ||
        (deleteInActiveRow && i === incomingIdx);
      // 删除窗口内右侧幸存项绑定共享平移（视觉左移一格 = 合并后位置）
      const bindShift = deletedIndex >= 0 && i > deletedIndex;
      // 删除窗口内右侧幸存项的"最终下标"（左移一格）。双图高亮间距 DUAL_HIGHLIGHT_EXTRA_GAP 按
      // **最终**下标计算：共享平移统一左移一格后恰好落在最终位置（严格边距），一次成型，
      // 不再"先平移到位再按高亮间距二次调整"（现状第二张差 6px 重排时再补位）。
      const finalIdx = bindShift ? i - 1 : i;
      const finalActive = finalIdx >= thumbActiveTarget && finalIdx < thumbActiveTarget + viewMode;
      // 双图高亮的额外间距对称分配：左中心图 -EXTRA/2、右中心图 +EXTRA/2。使两张中心图与左右邻缩略图
      // 的外侧间距相等（否则原实现仅右中心图 +EXTRA 会使右外侧间距被压缩、甚至与右邻重叠）。
      let extraLeft = 0;
      if (viewMode === 2 && finalActive) {
        if (finalIdx === thumbActiveTarget) extraLeft = -DUAL_HIGHLIGHT_EXTRA_GAP / 2;
        else if (finalIdx === thumbActiveTarget + 1) extraLeft = DUAL_HIGHLIGHT_EXTRA_GAP / 2;
      }
      const offsetX = i * thumbPitch + extraLeft;
      const oldOffsetX = thumbPositionsRef.current.get(img.id);
      // 删除后索引重排：此项从 oldOffsetX 移到新 offsetX，差值作为挂载动画起点（FLIP 靠拢）
      const animOffsetX = oldOffsetX == null ? 0 : oldOffsetX - offsetX;
      const isDeleting = deletingId === img.id;
      // 存储"视觉位置"而非 CSS 位置：删除窗口内右侧幸存项视觉已在合并后位置（offsetX - 一格），
      // 重排时它们的索引左移一格、offsetX 变成同一值 → animOffsetX 为 0，不再二次 FLIP（不回弹）。
      newPositions.set(img.id, bindShift ? offsetX - thumbPitch : offsetX);
      const groupShift = bindShift ? thumbGroupShiftX : undefined;
      const cached = cache.get(i);
      if (
        cached &&
        cached.props.img === img &&
        cached.props.active === active &&
        cached.props.offsetX === offsetX &&
        cached.props.activeScale === activeScale &&
        cached.props.stripHeight === stripHeight &&
        cached.props.animOffsetX === animOffsetX &&
        cached.props.isDeleting === isDeleting &&
        cached.props.groupShiftX === groupShift
      ) {
        items.push(cached);
        continue;
      }
      // key 仅用 img.id（稳定）：删除导致索引重排时，缩略图不重挂载，
      // 仅靠 animOffsetX 的 FLIP 平滑移位，避免"整页+缩略图闪烁"。
      const el = (
        <ThumbnailItem
          key={img.id}
          img={img}
          idx={i}
          active={active}
          activeScale={activeScale}
          onThumbClick={handleThumbClick}
          stripHeight={stripHeight}
          offsetX={offsetX}
          animOffsetX={animOffsetX}
          isDeleting={isDeleting}
          groupShiftX={groupShift}
          onThumbDim={recordThumbDim}
        />
      );
      cache.set(i, el);
      items.push(el);
    }
    // 更新位置表（供下一次删除靠拢计算）；同时清理已离开窗口/已被删除的旧记录
    thumbPositionsRef.current = newPositions;
    // 清理窗口外的缓存项，防止缓存无限增长
    for (const key of Array.from(cache.keys())) {
      if (key < startIdx - 2 || key > endIdx + 2) cache.delete(key);
    }
    return { items };
  }, [realIndex, isKeyboardActive, pendingRealIndex, viewMode, n, handleThumbClick, isStripDragging, stripDragVisibleIdx, images, deletingId, recordThumbDim]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key={lang}
          ref={overlayRef}
          data-carousel
          role="dialog"
          aria-modal="true"
          aria-label={dialogLabel}
          tabIndex={-1}
          className={`fixed inset-0 z-50 flex flex-col items-center justify-start select-none overflow-hidden outline-none sm:backdrop-blur-sm ${!isOpen ? "opacity-0 pointer-events-none" : ""}`}
      style={{
        overscrollBehavior: "none",
        contain: "layout style",
        paddingTop: CANVAS_EDGE_PX,
        backgroundColor: themeTokens.backdrop,
        "--car-text": themeTokens.text,
        "--car-text-dim": themeTokens.textDim,
        "--car-text-faint": themeTokens.textFaint,
        "--car-ctrl-bg": themeTokens.ctrlBg,
        "--car-ctrl-hover-bg": themeTokens.ctrlHoverBg,
        "--car-tooltip-bg": themeTokens.tooltipBg,
        "--car-tooltip-text": themeTokens.tooltipText,
        "--car-ring": themeTokens.ring,
        "--car-nav-hover": themeTokens.navHover,
        "--car-line": themeTokens.line,
        "--car-placeholder": themeTokens.placeholder,
        "--car-strip-bg": themeTokens.stripBg,
        "--car-tip-tri": themeTokens.tooltipBg,
        "--car-frame": themeTokens.frame,
      } as React.CSSProperties}
          onClick={() => {
            // 删除动画期间（删除按钮/名称栏尚未到位）：抑制 overlay 空白点击关闭，防误触退出
            if (performance.now() < deleteCloseSuppressUntilRef.current) return;
            // 图片拖拽释放可能波及一次 click，此时忽略（吞掉本次）而不关闭
            if (closeSuppressedRef.current || imageDragSuppressedRef.current) {
              closeSuppressedRef.current = false;
              imageDragSuppressedRef.current = false;
              return;
            }
            close();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <style dangerouslySetInnerHTML={{ __html: carThemeStyles }} />

          {/* 空状态：图片删干净时显示占位文案（主题适配 + i18n） */}
          {n === 0 && (
            <div
              className="pointer-events-none absolute inset-0 z-[40] flex flex-col items-center justify-center gap-3"
              onClick={(e) => e.stopPropagation()}
              style={{ paddingTop: CANVAS_EDGE_PX }}
            >
              <div
                className="h-12 w-12 rounded-xl car__placeholder"
                style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke={themeTokens.textFaint} strokeWidth="1.5" />
                  <path d="M3.5 16l4.5-4.5 3.5 3.5 4-4 5 5" stroke={themeTokens.textFaint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span className="text-sm font-medium" style={{ color: themeTokens.textDim }}>{t.emptyGallery}</span>
            </div>
          )}

          {/* 吸入层容器：isolation:isolate 强制本容器为层叠上下文 → 吸入层 z-index:-1 稳定落在
              “容器背景之上、所有卡片之下”：旧 DOM 图 opacity0 透明→吸入透出；进入卡不透明→盖其上。
              不改任何卡片 position/z（避免破坏入场 motion）。 */}
          <div
            ref={containerRef}
            className="relative flex items-center justify-center overflow-hidden"
            style={{ ...swiperContainerStyle, isolation: "isolate" }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            <MemoSwiper
              modules={swiperModules}
              virtual={swiperVirtual}
              slidesPerView={viewMode}
              spaceBetween={viewMode > 1 ? 8 : 2}
              loop={!useVirtual && !hasMore && n > viewMode}
              initialSlide={activeIndex >= 0 ? activeIndex : (initialIndex ?? 0)}
              speed={400}
              onSwiper={handleSwiperInit}
              onSlideChange={handleSlideChange}
              onSlideChangeTransitionStart={() => setIsSwipeAnimating(true)}
              onSlideChangeTransitionEnd={() => setIsSwipeAnimating(false)}
              className={`absolute inset-0 h-full w-full${isTransitioningViewMode ? " !overflow-visible" : ""}`}
              wrapperClass="swiper-wrapper h-full min-h-0"
              style={
                {
                  overflow: "visible",
                  // 与 AnimatedSlideImg 入场动画的 easeOut(cubic-bezier(0,0,0.58,1)) 对齐，
                  // 使"切换下一张"与"删除补位"的飞入轨迹逐帧一致（wrapper 缓动 ≠ easeOut 时中段会错位）
                  "--swiper-wrapper-transition-timing-function": "cubic-bezier(0, 0, 0.58, 1)",
                } as React.CSSProperties
              }
            >
              {/* 虚拟(大 n)：Swiper 只拿"稳定的空占位 children"，切图不再触发其全量 getChildren/协调 */}
              {useVirtual ? placeholderSlides : slides}
            </MemoSwiper>

            {/* 虚拟(大 n)图片分层：内联渲染近活跃窗口的图片，放 .swiper-wrapper 内继承 Swiper transform。
                因占位 children 引用稳定，切图时 MemoSwiper 直接 bail，仅重渲染此分层(O(近活跃集)) */}
            {useVirtual && isOpen && wrapperElRef.current && virtualReady && createPortal(
              /* Swiper 在连续切换时会重插占位滑片到 wrapper，可能把本分层挤到占位滑片之前，
                 导致占位层盖住图片、主图不可点击/拖拽。显式 z-index 保证图片分层始终在占位滑片之上。 */
              <div className="absolute inset-0" style={{ zIndex: 2 }}>
                {Array.from(nearActiveSet).map((i) => renderVirtualOverlaySlide(i))}
              </div>,
              wrapperElRef.current
            )}

            {/* 半透明"框架"边缘层：图片不做裁切，溢出部分被此半透明框覆盖而呈半透明，形成清晰边界。
              恒定渲染（容器 overflow 恒 visible），使半透明边缘/透图一直可见而非仅在拖拽缩放时出现。 */}
            <div
              className="pointer-events-none absolute inset-0 z-[5]"
              style={{ borderRadius: 14, boxShadow: "0 0 0 9999px var(--car-frame)" }}
            />
          </div>

          {/* Dev 调试控制面板：仅 debugPanel 显式开启且非生产构建时渲染。外部引用默认 debugPanel=false → 面板不出现 */}
          {isDev && debugPanel && (
            <div
              className="absolute top-16 right-16 z-[60] select-none"
              onClick={(e) => e.stopPropagation()}
              style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
            >
              <button
                onClick={() => setDevPanelOpen((o) => !o)}
                className="pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-transform hover:scale-105 active:scale-95"
                style={{
                  backgroundColor: "rgba(0,0,0,0.55)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.25)",
                  backdropFilter: "blur(6px)",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Dev
              </button>
              {devPanelOpen && (
                <div
                  className="mt-1.5 flex w-56 flex-col gap-2 rounded-xl p-3 text-xs"
                  style={{
                    backgroundColor: "rgba(0,0,0,0.7)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.2)",
                    backdropFilter: "blur(8px)",
                  }}
                >
                  <div className="mb-0.5 text-[11px] font-bold uppercase tracking-wider opacity-70">调试开关</div>
                  {[
                    { key: "deleteMode", label: "串行删除（吸入后再切换）", value: serialAnim, set: (v: boolean) => setDevSerialOverride(v) },
                    { key: "devHideThumbs", label: "隐藏底部缩略图条", value: devHideThumbs, set: setDevHideThumbs },
                    { key: "devDisableDeleteAnim", label: "关闭被删除图片动画", value: devDisableDeleteAnim, set: setDevDisableDeleteAnim },
                    { key: "devDisableSurvivorAnim", label: "关闭幸存图补位动画", value: devDisableSurvivorAnim, set: setDevDisableSurvivorAnim },
                    { key: "devHideMainImage", label: "隐藏主图", value: devHideMainImage, set: setDevHideMainImage },
                  ].map(({ key, label, value, set }) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                      style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
                    >
                      <span className="leading-snug">{label}</span>
                      <input
                        type="checkbox"
                        checked={value}
                        onChange={(e) => set(e.target.checked)}
                        className="pointer-events-auto h-3.5 w-3.5 cursor-pointer accent-blue-400"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {extraOverlayContent && isOpen && extraOverlayContent({ image: images[realIndex], index: realIndex, total: totalCount, isActive: true })}

          {/* 图片功能：重命名输入面板（与名称栏同域，默认样式，可通过 renameInputClassName 覆盖） */}
          {renameState && isOpen && (() => {
            const renamingImg = images.find((i) => i.id === renameState.id);
            if (!renamingImg) return null;
            // 居中容器负责屏幕正中央定位（motion 的 transform 会覆盖 Tailwind 的 -translate-x-1/2，
            // 因此水平/垂直居中放在此静态容器上，内层 motion 只做入场 y 动画，保证面板真正居中且可点击）。
            return (
              <div
                className="pointer-events-auto fixed left-1/2 top-1/2 z-[70] -translate-x-1/2 -translate-y-1/2"
                // 显式 z-index：Tailwind arbitrary 类（z-[70]）可能未被打包，会导致面板按 DOM 顺序落到图片下方
                style={{ zIndex: 9999 }}
              >
                <motion.div
                  initial={{ y: -10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -10, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="flex items-center gap-2 rounded-full car__ctrl px-3 py-1.5 sm:backdrop-blur-sm"
                  style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.35)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                <input
                  autoFocus
                  value={renameState.value}
                  placeholder={t.renamePlaceholder}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRenameState((s) => (s ? { ...s, value: v } : s));
                    if (v.trim()) renamedMapRef.current.set(renamingImg.id, v);
                    else renamedMapRef.current.delete(renamingImg.id);
                    setRenameSeq((seq) => seq + 1);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.stopPropagation(); commitRename(renamingImg, renameState.value); }
                    else if (e.key === "Escape") { e.stopPropagation(); cancelRename(renamingImg); }
                  }}
                  className={`w-40 rounded-md bg-black/25 px-2 py-1 text-xs text-white outline-none focus:ring-2 focus:ring-[var(--car-ring)] ${renameInputClassName ?? ""}`}
                  style={{ color: themeTokens.text }}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); commitRename(renamingImg, renameState.value); }}
                  className="pointer-events-auto shrink-0 rounded-md px-2 py-1 text-xs font-medium"
                  style={{ color: themeTokens.text }}
                >
                  {t.renameConfirm}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); cancelRename(renamingImg); }}
                  className="pointer-events-auto shrink-0 rounded-md px-2 py-1 text-xs"
                  style={{ color: themeTokens.textDim }}
                >
                  {t.renameCancel}
                </button>
                </motion.div>
              </div>
            );
          })()}

          <div className={`flex justify-center w-full ${devHideThumbs ? "hidden" : ""}`} onClick={(e) => e.stopPropagation()}>
            <motion.div
              ref={stripWheelRef}
              className={`relative z-[60] mt-[17px] shrink-0 overflow-hidden ${isStripDragging && dragMoved ? "cursor-grabbing" : "cursor-grab"}`}
              style={{
                width: STRIP_BASE_WIDTH,
                height: STRIP_ROW_HEIGHT,
                clipPath:
                  STRIP_VISIBLE_COUNT === STRIP_DRAG_VISIBLE
                    ? "inset(0 0 0 0)"
                    : `inset(0 ${STRIP_CLIP_PCT}% 0 ${STRIP_CLIP_PCT}%)`,
                scale: stripScale,
                transformOrigin: "center center",
                transition: "width 0.32s cubic-bezier(0.25, 0.1, 0.25, 1), clip-path 0.32s cubic-bezier(0.25, 0.1, 0.25, 1)",
              }}
            >
              <motion.div
                onPointerDown={isNavigationLocked ? undefined : handleStripPointerDown}
                onClick={(e) => e.stopPropagation()}
                className="absolute top-0 left-0"
                style={{
                  // stripX 是基于全量宽度（n * 64px）的绝对偏移
                  // 缩略图项使用绝对索引定位（left = i*pitch），容器无需 marginLeft 补偿
                  // 容器宽度从 n*64px 降至 ~41*64px ≈ 2624px，大幅减少合成层面积
                  x: stripX,
                  width: (stripItems.items.length + 1) * (THUMB_SIZE + THUMB_GAP),
                  height: STRIP_ROW_HEIGHT,
                  touchAction: "pan-y",
                }}
              >
                {stripItems.items}
              </motion.div>
              <motion.div
                className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border-2"
                    style={{ borderColor: themeTokens.line, boxShadow: `0 0 0 2px ${themeTokens.line}40` }}
                initial={false}
                animate={{ width: HIGHLIGHT_CENTER_WIDTH, height: viewMode === 1 ? HIGHLIGHT_CENTER_WIDTH : CENTER_THUMB_SIZE }}
                transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.8 }}
              />
            </motion.div>
          </div>

          {renderToolbar ? (
            <div onClick={(e) => e.stopPropagation()}>
              {renderToolbar({
                realIndex,
                viewMode,
                density: stripDensityLevel,
                setViewMode: (mode: 1 | 2 | 3) => {
                  changeViewMode(mode);
                },
                setDensity: setStripDensityLevel,
                goToIndex,
                close,
                total: totalCount,
                t: t as unknown as Record<string, string>,
              })}
            </div>
          ) : (
          <>
          <div className="pointer-events-none fixed top-5 left-0 right-0 z-30 flex items-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex-1" />
            <div className="pointer-events-auto">
              <HintBar
                isOpen={isOpen}
                hintLabel={t.hint}
                hintZoomDesktop={t.hintZoomDesktop}
                hintZoomMobile={t.hintZoomMobile}
              />
            </div>
            <div className="flex-1 flex items-center justify-end gap-2" style={{ paddingRight: "calc((64px - 28px) / 2)" }}>
              {extraToolbarItems}
              <button
                onClick={(e) => { e.stopPropagation(); close(); }}
                className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full car__ctrl text-xs sm:backdrop-blur-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--car-ring)] group relative"
                aria-label={t.close}
              >
                ✕
                <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md car__tooltip px-2.5 py-1.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none shadow-lg backdrop-blur-sm z-50">
                  {t.close}
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-b-black/80" />
                </span>
              </button>
            </div>
          </div>

          {n > 1 && (
            <>
              <button
                type="button"
                onPointerDown={isNavigationLocked ? undefined : (e) => handleButtonPress(e, "left")}
                onPointerUp={isNavigationLocked ? undefined : (e) => handleButtonRelease(e)}
                onPointerCancel={isNavigationLocked ? undefined : (e) => handleButtonRelease(e)}
                onClick={(e) => e.stopPropagation()}
                disabled={isNavigationLocked}
                className={`fixed left-0 top-0 z-20 flex h-full w-16 items-center justify-center bg-black/0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--car-ring)] group ${isNavigationLocked ? "cursor-default opacity-30" : "cursor-pointer"} ${!isNavigationLocked && !isStripDragging ? "car__nav" : ""}`}
                aria-label={t.prev}
              >
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full text-lg sm:backdrop-blur-sm"
                  style={{ backgroundColor: themeTokens.arrowBg, color: themeTokens.arrowText }}
                  aria-hidden="true"
                >
                  ‹
                </span>
                <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md car__tooltip px-2.5 py-1.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none shadow-lg backdrop-blur-sm z-50">
                  {t.prev}
                  <span className="absolute right-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-r-black/80" />
                </span>
              </button>

              <div
                className="fixed right-0 top-0 z-20 h-full w-16"
                onClick={(e) => e.stopPropagation()}
              >
                {/* 居中箭头 — 与左侧 ‹ 按钮对齐方式一致 */}
                <div
                  className={`absolute inset-0 transition-colors group ${isNavigationLocked ? "cursor-default opacity-30" : "cursor-pointer"} ${!isNavigationLocked && !isStripDragging ? "car__nav" : ""}`}
                  onPointerDown={isNavigationLocked ? undefined : (e) => handleButtonPress(e, "right")}
                  onPointerUp={isNavigationLocked ? undefined : (e) => handleButtonRelease(e)}
                  onPointerCancel={isNavigationLocked ? undefined : (e) => handleButtonRelease(e)}
                  role="button"
                  aria-label={t.next}
                  tabIndex={-1}
                >
                  <div className="pointer-events-none flex h-full w-full items-center justify-center">
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-full text-lg sm:backdrop-blur-sm"
                  style={{ backgroundColor: themeTokens.arrowBg, color: themeTokens.arrowText }}
                      aria-hidden="true"
                    >
                  ›
                </span>
                  </div>
                  <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md car__tooltip px-2.5 py-1.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none shadow-lg backdrop-blur-sm z-50">
                    {t.next}
                    <span className="absolute left-full top-1/2 -translate-y-1/2 border-[5px] border-transparent car__tip" />
                  </span>
                </div>

                <div
                  className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 hidden lg:flex w-[56px] flex-col items-stretch rounded-2xl p-1 sm:backdrop-blur-sm gap-1"
                  style={{
                    backgroundColor: themeTokens.shellBg,
                    "--car-title": themeTokens.titleText,
                    "--car-title-active": themeTokens.titleTextActive,
                    "--car-option": themeTokens.optionText,
                    "--car-option-active": themeTokens.activeText,
                    "--car-pill": themeTokens.activePill,
                    "--car-sep": themeTokens.separator,
                    ...(isStripDragging ? { pointerEvents: 'none' } : {}),
                  } as React.CSSProperties}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onPointerCancel={(e) => e.stopPropagation()}
                >
                  {/* 视图模式 - 二级菜单 */}
                  <div className="relative" data-dropdown="viewmode">
                    <button
                      type="button"
                      onClick={() => setOpenMenu(openMenu === "viewmode" ? null : "viewmode")}
                      className={`relative flex h-6 w-full items-center justify-center rounded-lg text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--car-ring)] group ${
                        (n < 2) ? "opacity-30 cursor-not-allowed" : "car__title cursor-pointer"
                      }`}
                      disabled={n < 2}
                      aria-label={t.viewModeGroup}
                    >
                      <span className="relative z-10">{t[VIEW_MODE_CONFIG[viewMode].labelKey]}</span>
                      <span className={`absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md car__tooltip px-2.5 py-1.5 text-xs opacity-0 transition-opacity pointer-events-none shadow-lg backdrop-blur-sm z-40 ${openMenu !== "viewmode" ? "group-hover:opacity-100" : ""}`}>
                        {t.viewModeGroup}
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full border-[5px] border-transparent car__tip" />
                      </span>
                    </button>
                    <AnimatePresence>
                      {openMenu === "viewmode" && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.92, x: -4 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.92, x: -4 }}
                          transition={{ duration: 0.15, ease: "easeOut" }}
                          className="absolute right-full mr-2 top-0 flex flex-col items-stretch rounded-xl p-0.5 shadow-lg backdrop-blur-sm z-50 gap-px" style={{ minWidth: 56, backgroundColor: themeTokens.dropdownBg }}
                        >
                          {([1, 2, 3] as const).map((mode) => {
                            const isActive = viewMode === mode;
                            const cfg = VIEW_MODE_CONFIG[mode];
                            const isDisabled = (n < 2 && mode >= 2) || (n < 3 && mode >= 3);
                            return (
                              <button
                                key={mode}
                                type="button"
                                disabled={isDisabled}
                                onClick={() => {
                                  if (isDisabled || mode === viewMode) { setOpenMenu(null); return; }
                                  changeViewMode(mode);
                                  setOpenMenu(null);
                                }}
                                className={`relative flex h-6 items-center justify-center rounded-lg text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--car-ring)] whitespace-nowrap px-4 ${
                                  isDisabled
                                    ? "car__disabled cursor-not-allowed"
                                    : isActive
                                      ? "car__active"
                                      : "car__option cursor-pointer"
                                }`}
                                aria-label={t[cfg.labelKey]}
                                aria-pressed={isActive}
                              >
                                {isActive && (
                                  <motion.div
                                    layoutId="viewmode-active"
                                    layoutDependency={"viewmode-active" as any}
                                    className="absolute inset-0 rounded-lg car__pill"
                                    transition={{ type: "spring", stiffness: 420, damping: 26, mass: 0.8 }}
                                  />
                                )}
                                <span className="relative z-10">{t[cfg.labelKey]}</span>
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  {/* 分隔线 */}
                  <div className="mx-2 h-px car__sep" role="separator" aria-orientation="horizontal" />
                  {/* 密度 - 二级菜单 */}
                  <div className="relative" data-dropdown="density">
                    <button
                      type="button"
                      onClick={() => setOpenMenu(openMenu === "density" ? null : "density")}
                      className={`relative flex h-6 w-full items-center justify-center rounded-lg text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--car-ring)] group cursor-pointer car__title`}
                      aria-label={t.densityGroup}
                    >
                      <span className="relative z-10">{t[STRIP_DENSITY_CONFIG[stripDensityLevel].labelKey]}</span>
                      <span className={`absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md car__tooltip px-2.5 py-1.5 text-xs opacity-0 transition-opacity pointer-events-none shadow-lg backdrop-blur-sm z-40 ${openMenu !== "density" ? "group-hover:opacity-100" : ""}`}>
                        {t.densityGroup}
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full border-[5px] border-transparent car__tip" />
                      </span>
                    </button>
                    <AnimatePresence>
                      {openMenu === "density" && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.92, x: -4 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.92, x: -4 }}
                          transition={{ duration: 0.15, ease: "easeOut" }}
                          className="absolute right-full mr-2 top-0 flex flex-col items-stretch rounded-xl p-0.5 shadow-lg backdrop-blur-sm z-50 gap-px" style={{ minWidth: 56, backgroundColor: themeTokens.dropdownBg }}
                        >
                          {([1, 2, 3] as const).map((level) => {
                            const isActive = stripDensityLevel === level;
                            const cfg = STRIP_DENSITY_CONFIG[level];
                            return (
                              <button
                                key={level}
                                type="button"
                                onClick={() => { setStripDensityLevel(level); setOpenMenu(null); }}
                                className={`relative flex h-6 items-center justify-center rounded-lg text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--car-ring)] whitespace-nowrap px-4 cursor-pointer ${
                                  isActive
                                    ? "car__active"
                                    : "car__option"
                                }`}
                                aria-label={`${t[cfg.labelKey]}: ${cfg.visible}/${cfg.drag}`}
                                aria-pressed={isActive}
                              >
                                {isActive && (
                                  <motion.div
                                    layoutId="density-active"
                                    layoutDependency={"density-active" as any}
                                    className="absolute inset-0 rounded-lg car__pill"
                                    transition={{ type: "spring", stiffness: 420, damping: 26, mass: 0.8 }}
                                  />
                                )}
                                <span className="relative z-10">{t[cfg.labelKey]}</span>
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  {/* 分隔线 */}
                  <div className="mx-2 h-px car__sep" role="separator" aria-orientation="horizontal" />
                  {/* 滚轮功能 - 二级菜单 */}
                  <div className="relative" data-dropdown="wheel">
                    <button
                      type="button"
                      onClick={() => setOpenMenu(openMenu === "wheel" ? null : "wheel")}
                      className={`relative flex h-6 w-full items-center justify-center rounded-lg text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--car-ring)] group cursor-pointer car__title`}
                      aria-label={t.wheelGroup}
                    >
                      <span className="relative z-10">{t[wheelMode === "zoom" ? "wheelZoom" : "wheelSwitch"]}</span>
                      <span className={`absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md car__tooltip px-2.5 py-1.5 text-xs opacity-0 transition-opacity pointer-events-none shadow-lg backdrop-blur-sm z-40 ${openMenu !== "wheel" ? "group-hover:opacity-100" : ""}`}>
                        {t.wheelGroup}
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full border-[5px] border-transparent car__tip" />
                      </span>
                    </button>
                    <AnimatePresence>
                      {openMenu === "wheel" && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.92, x: -4 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.92, x: -4 }}
                          transition={{ duration: 0.15, ease: "easeOut" }}
                          className="absolute right-full mr-2 top-0 flex flex-col items-stretch rounded-xl p-0.5 shadow-lg backdrop-blur-sm z-50 gap-px" style={{ minWidth: 56, backgroundColor: themeTokens.dropdownBg }}
                        >
                          {(["zoom", "switch"] as const).map((mode) => {
                            const isActive = wheelMode === mode;
                            return (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => { setWheelMode(mode); setOpenMenu(null); }}
                                className={`relative flex h-6 items-center justify-center rounded-lg text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--car-ring)] whitespace-nowrap px-4 cursor-pointer ${
                                  isActive
                                    ? "car__active"
                                    : "car__option"
                                }`}
                                aria-label={t[mode === "zoom" ? "wheelZoom" : "wheelSwitch"]}
                                aria-pressed={isActive}
                              >
                                {isActive && (
                                  <motion.div
                                    layoutId="wheel-active"
                                    layoutDependency={"wheel-active" as any}
                                    className="absolute inset-0 rounded-lg car__pill"
                                    transition={{ type: "spring", stiffness: 420, damping: 26, mass: 0.8 }}
                                  />
                                )}
                                <span className="relative z-10">{t[mode === "zoom" ? "wheelZoom" : "wheelSwitch"]}</span>
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </>
          )}
          </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function SwiperLoopCarouselWithErrorBoundary({
  images,
  onNeedMore,
  hasMore,
  renderOverlay,
  renderToolbar,
  extraToolbarItems,
  extraOverlayContent,
  isOpen,
  initialIndex,
  onClose,
  onDownload,
  total,
  persistSettings,
  actions,
  renameInputClassName,
  enableConcurrent,
  concurrency,
  minChunkBytes,
  connectRetryMs,
  enableConnectRetry,
  maxActiveImages,
  preloadRange,
  useCache,
  maxCache,
  theme = "dark",
  deleteMode,
  debugPanel,
}: {
  images: GalleryImage[];
  onNeedMore?: () => void;
  hasMore?: boolean;
  renderOverlay?: (props: { image: GalleryImage; index: number; total: number; isActive: boolean }) => ReactNode;
  renderToolbar?: (props: {
    realIndex: number;
    viewMode: 1 | 2 | 3;
    density: 1 | 2 | 3;
    setViewMode: (mode: 1 | 2 | 3) => void;
    setDensity: (d: 1 | 2 | 3) => void;
    goToIndex: (idx: number) => void;
    close: () => void;
    total: number;
    t: Record<string, string>;
  }) => ReactNode;
  extraToolbarItems?: ReactNode;
  extraOverlayContent?: (props: { image: GalleryImage; index: number; total: number; isActive: boolean }) => ReactNode;
  /** 受控模式：是否打开。undefined 时使用内部非受控状态 */
  isOpen?: boolean;
  /** 受控模式：打开时定位到第几张图片（默认 0） */
  initialIndex?: number;
  /** 受控模式：关闭回调。调用后由父组件将 isOpen 设为 false */
  onClose?: () => void;
  /** 下载回调。传入后默认覆盖层会显示下载按钮 */
  onDownload?: (index: number) => void;
  /** 图片总数（含未加载）。用于覆盖层显示 "3/10000"，默认取 images.length */
  total?: number;
  /** 是否将设置（视图模式、缩略图密度、滚轮功能）持久化到 localStorage。
   *  - true：使用默认存储键
   *  - string：使用自定义存储键（不同组件可共享或隔离配置）
   *  - undefined / false：不持久化（每次打开重置为默认值）
   */
  persistSettings?: boolean | string;
  /** 图片功能插槽：自定义顺序/启停/图标/函数；内置 delete/rename 的本地行为始终执行 */
  actions?: CarouselAction[];
  /** 重命名输入框自定义类名（附加于默认样式之后） */
  renameInputClassName?: string;
  /** 并发分块下载总开关（默认 true） */
  enableConcurrent?: boolean;
  /** 分块段数（默认 6） */
  concurrency?: number;
  /** 分块大小阈值（默认 262144，256KB） */
  minChunkBytes?: number;
  /** 等待服务器响应（TTFB）超过该毫秒即重发本块；enableConnectRetry 为 true 时生效。默认 1000 */
  connectRetryMs?: number;
  /** 服务器响应超时重发机制开关（默认 true） */
  enableConnectRetry?: boolean;
  /** 同时下载的图片张数（默认 2） */
  maxActiveImages?: number;
  /** 自动下载范围：数字 N 等价于 [-N, N]；[] 或 0 关闭（默认 [-1,1]） */
  preloadRange?: number | [number, number] | [];
  /** URL 级结果缓存（默认 true） */
  useCache?: boolean;
  /** blob URL 缓存上限（默认 80） */
  maxCache?: number;
  /** 整体配色主题："dark"（默认）或 "light"（亮色）。调用方可按需切换 */
  theme?: CarouselTheme;
  /** 多图删除动画时序："parallel"（默认）/ "serial" */
  deleteMode?: "serial" | "parallel";
  /** 是否显示 Dev 调试面板（默认 false，外部引用不出现） */
  debugPanel?: boolean;
}) {
  return (
    <CarouselErrorBoundary>
      <SwiperLoopCarousel images={images} onNeedMore={onNeedMore} hasMore={hasMore} renderOverlay={renderOverlay} renderToolbar={renderToolbar} extraToolbarItems={extraToolbarItems} extraOverlayContent={extraOverlayContent} isOpen={isOpen} initialIndex={initialIndex} onClose={onClose} onDownload={onDownload} total={total} persistSettings={persistSettings} actions={actions} renameInputClassName={renameInputClassName} enableConcurrent={enableConcurrent} concurrency={concurrency} minChunkBytes={minChunkBytes} connectRetryMs={connectRetryMs} enableConnectRetry={enableConnectRetry} maxActiveImages={maxActiveImages} preloadRange={preloadRange} useCache={useCache} maxCache={maxCache} theme={theme} deleteMode={deleteMode} debugPanel={debugPanel} />
    </CarouselErrorBoundary>
  );
}

