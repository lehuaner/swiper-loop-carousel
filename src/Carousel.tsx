"use client";

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, startTransition, Component, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useMotionValue, animate, MotionValue } from "motion/react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Virtual } from "swiper/modules";
import type { Swiper as SwiperClass } from "swiper";

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
    prev.viewModeOffsetX === next.viewModeOffsetX &&
    prev.entryXFrom === next.entryXFrom &&
    prev.entryScaleFrom === next.entryScaleFrom &&
    prev.entryXOffset === next.entryXOffset &&
    prev.isExitingOnViewModeChange === next.isExitingOnViewModeChange &&
    prev.showSpinner === next.showSpinner &&
    prev.downloadProgress === next.downloadProgress &&
    prev.progressKnown === next.progressKnown
);

// 缩略图条单项：忽略 onThumbClick（稳定引用 + 内部仅触发一次），仅当 active 等视觉状态变化时重渲染
// loaded 状态由组件内部管理，避免父组件 stripLoadVersion 变化导致所有缩略图重算
const ThumbnailItem = React.memo(
  function ThumbnailItem({
    img,
    idx,
    active,
    activeScale,
    onThumbClick,
    stripHeight,
    offsetX,
  }: {
    img: GalleryImage;
    idx: number;
    active: boolean;
    activeScale: number;
    onThumbClick: (idx: number) => void;
    stripHeight: number;
    /** 相对于 strip 容器左边缘的 X 偏移（px），由父组件根据 startIdx 偏移计算 */
    offsetX: number;
  }) {
    // 局部可见性检测：进出视口只更新本缩略图组件，不触发 Carousel / 缩略图条整体重渲染
    const [inView, setRef] = useInView<HTMLButtonElement>("50px");
    const [loaded, setLoaded] = useState(false);
    const loadedRef = useRef(false);
    const imgElRef = useRef<HTMLImageElement>(null);

    // 稳定化 animate/transition 引用：重渲染时若 active/activeScale 未变，
    // motion 复用同一对象，避免 41 个缩略图在拖拽/导航时每次都重新设置 spring 动画。
    const thumbAnimate = useMemo(
      () => ({ scale: active ? activeScale : 1, opacity: active ? 1 : 0.6 }),
      [active, activeScale]
    );
    const thumbTransition = useMemo(
      () => ({ type: "spring" as const, stiffness: 320, damping: 24, mass: 0.7 }),
      []
    );

    // 检测图片是否已缓存（进入可见区域时 remount <img>，避免缓存命中时仍闪烁 skeleton）
    useLayoutEffect(() => {
      const img = imgElRef.current;
      if (img && img.complete && img.naturalWidth > 0) {
        loadedRef.current = true;
        setLoaded(true);
      }
    }, [inView]);

    return (
      <motion.button
        ref={setRef}
        onClick={(e) => {
          onThumbClick(idx);
          // 点击缩略图是“跳转”语义，不应让该按钮保持键盘焦点，
          // 否则后续用方向键切换中心图时，焦点仍停在此按钮上，
          // 残留 focus-visible 白色 ring（白圈）。失焦后由 dialog 容器承接焦点。
          e.currentTarget.blur();
        }}
        animate={thumbAnimate}
        transition={thumbTransition}
        className={`flex-shrink-0 overflow-hidden rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--car-ring)] ${active ? "relative z-10" : ""}`}
        style={{ position: "absolute", left: offsetX, top: (stripHeight - THUMB_SIZE) / 2, width: THUMB_SIZE, height: THUMB_SIZE }}
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
            }}
              />
            </>
          ) : (
            <div className="absolute inset-0 car__strip" />
          )}
        </div>
      </motion.button>
    );
  },
  (prev, next) =>
    prev.img.id === next.img.id &&
    prev.idx === next.idx &&
    prev.active === next.active &&
    prev.activeScale === next.activeScale &&
    prev.stripHeight === next.stripHeight &&
    prev.offsetX === next.offsetX
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
  /** 图标（可自定义节点） */
  icon: ReactNode;
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
  // 虚拟模式分层定位：捕获 Swiper virtual slidesGrid（各 index 在 wrapper 内的真实 x 偏移）用于逐像素对齐
  const virtualGridRef = useRef<number[] | null>(null);
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
  const keyboardHoldTimerRef = useRef<number | null>(null);
  const keyboardHoldStartRef = useRef(0);
  const closeSuppressedRef = useRef(false);
  // 图片拖拽期间置真：拖拽开始后到"下一次新交互(pointerdown)"之前，一律抑制根节点关闭。
  // 精确拦截拖拽释放后紧邻的那一次 click（pointerdown 尚未发生），且不误吞后续正常点击。
  const imageDragSuppressedRef = useRef(false);
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
  const containerRef = useRef<HTMLDivElement>(null);
  const pinchStateRef = useRef<{
    initialDist: number;
    initialScale: number;
    idx: number;
  } | null>(null);

  // 每张图片独立的 motionX/Y/Scale（按 images 数组下标存储，切换时不会互相影响）
  // 懒加载：只在 slide 实际渲染时创建 MotionValue，避免 2000 张图一次性创建 6000 个对象
  const imageMotionsMapRef = useRef<Map<number, ImageMotions>>(new Map());
  const getOrCreateImageMotions = useCallback((index: number): ImageMotions => {
    let m = imageMotionsMapRef.current.get(index);
    if (!m) {
      m = { x: new MotionValue(0), y: new MotionValue(0), scale: new MotionValue(1) };
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
    (index: number, img: GalleryImage) => {
      if (deletingId === img.id || removedIdsRef.current.has(img.id)) return;
      setDeletingId(img.id);
      const m = getOrCreateImageMotions(index);
      // 飞出动画：向右下飞出并缩小，动画结束后再真正移除
      animate(m.scale, 0.12, { duration: 0.3, ease: "backIn" });
      animate(m.x, 64, { duration: 0.3, ease: "backIn" });
      animate(m.y, 40, { duration: 0.3, ease: "backIn" });
      window.setTimeout(() => {
        removedIdsRef.current.add(img.id);
        // 清除该下标的历史 motion 状态，避免重排后隔壁图片（占据该下标）继承飞到一半的动画
        imageMotionsMapRef.current.delete(index);
        dirtyMotionIndicesRef.current.delete(index);
        setDeletingId(null);
        setRemoveEpoch((e) => e + 1);
      }, 320);
    },
    [deletingId, getOrCreateImageMotions]
  );

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
  const actionsConfig: CarouselAction[] = actions ?? [
    { key: "rename", icon: RenameIcon, label: t.renameImage },
    { key: "delete", icon: TrashIcon, label: t.deleteImage },
  ];

  // ── 虚拟化 ──
  // 图片数量超过阈值时启用 Swiper Virtual 模式，只渲染可见 slides，避免 2000 个 DOM 节点
  const VIRTUAL_THRESHOLD = 20;
  const useVirtual = n > VIRTUAL_THRESHOLD;

  // ── 导航锁定 ──
  // 图片数量不足以切换时，禁止所有导航（键盘、按钮、拖拽、点击、Swiper 滑动）
  const isNavigationLocked = (n === 2 && viewMode === 2) || (n === 3 && viewMode === 3);
  const isNavigationLockedRef = useRef(isNavigationLocked);
  useEffect(() => { isNavigationLockedRef.current = isNavigationLocked; }, [isNavigationLocked]);

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
    (idx: number) => {
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
          if (swiper.params.loop) {
            swiper.slideToLoop(idx);
          } else {
            swiper.slideTo(idx);
          }
          // 实际发生了滑动才标记跳转目标（抑制中间 slideChange）
          jumpTargetRef.current = idx;
        }
        // realIndex 必须同步提交：Swiper virtual 模式在 slideTo 的过渡回调里依赖
        // React 同步反映最新索引来填充/重排 slides，若异步化（startTransition）会
        // 导致 transform 不更新、切换无动画甚至不切换。故这里保持同步。
        setRealIndex(idx);
        realIndexRef.current = idx;
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
        const initialTargetX = initialBaseX - (idx + (vm - 1) / 2) * (THUMB_SIZE + THUMB_GAP) - (vm === 2 ? DUAL_HIGHLIGHT_EXTRA_GAP / 2 : 0);
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
  const STRIP_TARGET_X =
    STRIP_BASE_WIDTH / 2 -
    THUMB_SIZE / 2 -
    (STRIP_TARGET_IDX + (viewMode - 1) / 2) * STRIP_THUMB_PITCH -
    (viewMode === 2 ? DUAL_HIGHLIGHT_EXTRA_GAP / 2 : 0);

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

  // 当前展示图是否因缩放/位移而溢出画布视口：是则放开最外层容器裁剪，
  // 让溢出边缘以半透明"框架"透到画布外的背景上（配合框架层 dim），而非被裁掉。
  // 单图、多图模式均生效；各图片自身仍按格子裁剪（viewMode>1 时 inner div 保持
  // overflow-hidden），保证多图之间彼此不重叠。
  // 用 React state 而非渲染期读 motion 判定溢出：滚轮缩放/触屏双指只改 motion 值、
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
    // style 覆盖 className 的 overflow-hidden：仅当溢出且放开裁剪时透出，否则保持裁剪
    overflow: imgOverflowActive ? "visible" : "hidden",
  } as CSSProperties;

  // 稳定化 Swiper props，避免每次渲染触发 Swiper 内部 updateSwiper
  // modules 和 virtual 配置用 useMemo 缓存，防止每次渲染创建新数组/对象导致 MemoSwiper 失效
  const swiperModules = useMemo(() => useVirtual ? [Virtual] : undefined, [useVirtual]);
  const swiperVirtual = useMemo(() => useVirtual ? { addSlidesBefore: 5, addSlidesAfter: 5, cache: false } : undefined, [useVirtual]);
  const handleSwiperInit = useCallback((s: SwiperClass) => {
    swiperRef.current = s;
    // 捕获虚拟网格与 wrapper，供分层对齐使用
    if (s.virtual) virtualGridRef.current = (s.virtual as any).slidesGrid ?? null;
    if (s.el) wrapperElRef.current = s.el.querySelector(".swiper-wrapper");
    setVirtualReady(true);
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
    }
  }, []);
  const handleSlideChange = useCallback((s: SwiperClass) => {
    if (s.destroyed) return;
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
    setRealIndex(newIdx);
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
    if (!isOpen) return activeIndicesCacheRef.current;
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
    if (!isOpen) return nearActiveSetCacheRef.current;
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
  const wasActiveMap = useMemo(() => {
    const map = new Map<number, boolean | undefined>();
    for (const index of nearActiveSet) {
      if (everRenderedSetRef.current.has(index)) {
        // 之前渲染过：提供准确的 wasActive 值
        map.set(index, prevActiveIndicesRef.current.has(index));
      }
      // 之前没渲染过：不设置，wasActiveMap.get(index) 返回 undefined
    }
    // 更新已渲染集合
    for (const index of nearActiveSet) {
      everRenderedSetRef.current.add(index);
    }
    prevActiveIndicesRef.current = activeIndices;
    return map;
  }, [activeIndices, nearActiveSet]);

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
    // 并发预加载：范围内图片就绪前用缩略图兜底，分块完成后无缝替换为 blob URL；
    // 范围外图片保持原生 lazy 加载原始 src，避免与预加载产生双份下载。
    const readySrc = preloader.getReadySrc(index);
    // 原图下载只由预加载器负责（避免"原生 <img> 整包 + 预加载分块"双重下载同一原图）。
    // 范围外可见 slide 不再用 img.src 原生拉原图，就绪前一律用缩略图兜底；
    // 该 slide 进入中心/范围后由预加载器下载并替换为就绪的 src/blob。
    const displaySrc = readySrc ?? (img.thumbSrc || img.src);
    // 当前活跃图（单图=中心，双图/三图/多图=全部可见图）：任一原图尚未就绪时都稳定显示转圈，
    // 而非仅 index===realIndex 的第一张，保证所有共视图加载进度一致可见
    const showSpinner = activeIndices.has(index) && !Boolean(readySrc);
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

      const dims = preloader.getDims(index);
      if (dims && containerHeight > 0) {
        const oldSize = computeContainedSize(dims.w, dims.h, getSlideW(prevVM), containerHeight);
        const newSize = computeContainedSize(dims.w, dims.h, getSlideW(newVM), containerHeight);
        entryScaleFrom = oldSize.w / newSize.w;
      } else {
        entryScaleFrom = newVM / prevVM;
      }

      if (relIdx < prevVM && relIdx >= newVM) {
        isExitingOnViewModeChange = true;
      }
    }
    const viewModeOffsetX = 0;
    const slideWidth = containerWidth / viewMode;
    const entryAnimXOffset = slideWidth > 0 ? slideWidth * 0.6 : 60;
    const viewModeZIndex = (() => {
      if (!isTransitioningViewMode) return undefined;
      if (relIdx < prevVM) return 2;
      if (relIdx < newVM) return 1;
      return undefined;
    })();
    const isActive = activeIndices.has(index);
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
    let horizontalClip: string | undefined;
    if (viewMode === 1) {
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
    const innerDivStyle: React.CSSProperties = {
      ...(viewModeZIndex != null ? { position: "relative", zIndex: viewModeZIndex } : {}),
      // overflow 全 visible（横/纵都能溢出透出），横向是否被裁完全交给上面的 clip-path
      overflow: "visible",
      ...(horizontalClip ? { clipPath: horizontalClip, WebkitClipPath: horizontalClip } : {}),
      // 溢出透图时隐藏非活跃相邻图：窄屏下 canvas 宽度小，相邻滑片会有一部分落到屏幕边缘，
      // 若不隐藏会从半透明"框架"区域直接看到左右两张邻图。
      ...(imgOverflowActive && !isActive ? { visibility: "hidden" } : {}),
    };
    // 该滑片内容（图片+motion）与滑片外壳(overflow 裁剪)拆分：
    // - 非虚拟(小 n)：外壳 = SwiperSlide，内容放其内部
    // - 虚拟(大 n)：内容放入独立分层(absolute)，盖在 Swiper 空占位滑片上，避免每次切图重渲染全量 children
    const overflowClip = viewMode === 1 && !isTransitioningViewMode && !imgOverflowing;
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
              willChange: "transform",
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
              loading={index === realIndex ? "eager" : "lazy"}
              showSpinner={showSpinner}
              downloadProgress={downloadProgress}
              progressKnown={progressKnown}
              viewModeEpoch={viewModeEpoch}
              viewModeOffsetX={viewModeOffsetX}
              entryXFrom={entryXFrom}
              entryScaleFrom={entryScaleFrom}
              entryXOffset={entryAnimXOffset}
              slideDirectionRef={slideDirectionRef}
              isExitingOnViewModeChange={isExitingOnViewModeChange}
              onExitComplete={() => {
                const m = imageMotionsMapRef.current.get(index);
                if (m) {
                  m.x.set(0);
                  m.y.set(0);
                  m.scale.set(1);
                }
              }}
            />
          </motion.div>
          {isActive && (
            <motion.div
              initial={{ y: -24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.3, ease: "easeOut" }}
              className="pointer-events-none absolute top-[calc(56px-20px)] z-10 rounded-full car__ctrl px-3 py-1 text-xs font-medium whitespace-nowrap left-1/2 -translate-x-1/2 sm:left-3 sm:translate-x-0 sm:backdrop-blur-sm"
            >
              {renderOverlay ? renderOverlay({ image: img, index, total: totalCount, isActive }) : (
                <>
                  <span>{index + 1} / {totalCount}</span>
                  <span className="ml-2" style={{ color: themeTokens.textDim }}>{renamedMapRef.current.get(img.id) ?? img.alt}</span>
                  {img.dimensions
                    ? <span className="ml-2" style={{ color: themeTokens.textFaint }}>{img.dimensions}</span>
                    : (img.width && img.height && <span className="ml-2" style={{ color: themeTokens.textFaint }}>{img.width}×{img.height}</span>)
                  }
                  {img.sizeLabel
                    ? <span className="ml-2" style={{ color: themeTokens.textFaint }}>{img.sizeLabel}</span>
                    : (img.fileSize != null && <span className="ml-2" style={{ color: themeTokens.textFaint }}>{formatFileSize(img.fileSize)}</span>)
                  }
                  {onDownload && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDownload(index); }}
                      className="pointer-events-auto ml-2 inline-flex items-center justify-center"
                      style={{ color: themeTokens.textDim }}
                      aria-label="Download"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                  )}
                  {actionsConfig.map((a) => {
                    const disabled = a.enabled === false || deletingId === img.id;
                    const ctx: CarouselActionCtx = { image: img, index, total: totalCount };
                    return (
                      <button
                        key={a.key}
                        disabled={disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (a.key === "delete") flyOutAndRemove(index, img);
                          else if (a.key === "rename") startRename(index, img);
                          a.onSelect?.(ctx);
                        }}
                        className="pointer-events-auto ml-2 inline-flex items-center justify-center"
                        style={{ color: disabled ? themeTokens.textFaint : themeTokens.textDim }}
                        aria-label={a.label}
                        title={a.label}
                      >
                        {a.icon}
                      </button>
                    );
                  })}
                </>
              )}
            </motion.div>
          )}
        </div>
    );
    return { node, slideClassName, overflowClip };
  }, [images, realIndex, n, prevViewMode, viewMode, isTransitioningViewMode, containerWidth, containerHeight, preloader, preloader.version, isPinching, activeIndices, wasActiveMap, viewModeEpoch, slideDirectionRef, getOrCreateImageMotions, renderOverlay, onDownload, imgDraggingIdx, imgOverflowActive, actionsConfig, flyOutAndRemove, startRename, deletingId, renamedMapRef, renameSeq]);

  // 非虚拟(<n)：内容包回 SwiperSlide，行为与原来完全一致
  const renderSlideContent = useCallback((index: number) => {
    const { node, slideClassName } = renderSlideInner(index);
    return (
      <SwiperSlide key={index} virtualIndex={index} onClick={(e) => e.stopPropagation()} className={slideClassName}>
        {node}
      </SwiperSlide>
    );
  }, [renderSlideInner]);

  // 虚拟(大 n)：内容包进绝对定位分层，盖在 Swiper 空占位滑片之上。
  // 分层经 createPortal 放进 .swiper-wrapper，继承其 transform，切图时仅重渲染近活跃窗口。
  // left 用 Swiper virtual slidesGrid 的真实偏移，保证与占位滑片逐像素对齐。
  const virtualSpaceBetween = viewMode > 1 ? 8 : 2;
  const virtualCellW = containerWidth > 0 ? (containerWidth - (viewMode - 1) * virtualSpaceBetween) / viewMode : 1;
  const renderVirtualOverlaySlide = useCallback((index: number) => {
    const { node, overflowClip } = renderSlideInner(index);
    const g = virtualGridRef.current;
    const left = g && index < g.length ? g[index] : index * (virtualCellW + virtualSpaceBetween);
    return (
      <div
        key={index}
        style={{ position: "absolute", top: 0, left, width: virtualCellW, height: "100%", overflow: overflowClip ? "hidden" : "visible" }}
      >
        {node}
      </div>
    );
  }, [renderSlideInner, virtualCellW, virtualSpaceBetween]);

  // 活跃 slide：统一使用浅拷贝占位 + 只替换 nearActiveSet 中的项
  // 避免 images.map() 全量创建 React Element（1000+ 张时每次切图都要重建）
  // 延迟到 overlay 打开时计算，退出动画期间保留缓存
  const slidesCacheRef = useRef<React.ReactElement[]>([]);
  const slides = useMemo(() => {
    if (!isOpen) return slidesCacheRef.current;
    const result = placeholderSlides.slice();
    for (const index of nearActiveSet) {
      result[index] = renderSlideContent(index);
    }
    slidesCacheRef.current = result;
    return result;
  }, [isOpen, placeholderSlides, nearActiveSet, renderSlideContent, preloader.progressVersion]);

  // 缩略图条虚拟化列表：仅当 realIndex/active/loaded 变化时重算
  // 使用相对偏移定位（offsetX = 相对 startIdx 的像素偏移），避免大 idx 时 left 值过大
  const stripItems = useMemo(() => {
    // 拖拽时以拖拽可见中心为基准，键盘/按钮长按时以 pendingRealIndex 为基准，确保即将进入视口的缩略图已渲染
    const centerIdx = isStripDragging ? stripDragVisibleIdx : isKeyboardActive ? pendingRealIndex : realIndex;
    const range = isStripDragging ? STRIP_DRAG_VIRTUAL_RANGE : STRIP_VIRTUAL_RANGE;
    const startIdx = Math.max(0, centerIdx - range);
    const endIdx = Math.min(n - 1, centerIdx + range);
    const thumbActiveTarget = isKeyboardActive ? pendingRealIndex : realIndex;
    const activeScale = isKeyboardActive ? 1 : (viewMode === 1 ? CENTER_SCALE : viewMode === 2 ? 1.15 : 1.1);
    const stripHeight = viewMode === 1 ? HIGHLIGHT_CENTER_WIDTH : CENTER_THUMB_SIZE;
    const items = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const img = images[i];
      const active = i >= thumbActiveTarget && i < thumbActiveTarget + viewMode;
      // 相对偏移：idx 相对于 startIdx 的像素位置 + 双图模式额外间距
      const extraLeft = viewMode === 2 && active && i === thumbActiveTarget + 1 ? DUAL_HIGHLIGHT_EXTRA_GAP : 0;
      const offsetX = (i - startIdx) * (THUMB_SIZE + THUMB_GAP) + extraLeft;
      items.push(
        <ThumbnailItem
          key={i}
          img={img}
          idx={i}
          active={active}
          activeScale={activeScale}
          onThumbClick={handleThumbClick}
          stripHeight={stripHeight}
          offsetX={offsetX}
        />
      );
    }
    return { items, startIdx };
  }, [realIndex, isKeyboardActive, pendingRealIndex, viewMode, n, handleThumbClick, isStripDragging, stripDragVisibleIdx, images]);

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
          <div
            ref={containerRef}
            className="relative flex items-center justify-center overflow-hidden"
            style={swiperContainerStyle}
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
              className={`absolute inset-0 h-full w-full${isTransitioningViewMode ? " !overflow-visible" : ""}`}
              wrapperClass="swiper-wrapper h-full min-h-0"
              style={imgOverflowActive ? { overflow: "visible" } : undefined}
            >
              {/* 虚拟(大 n)：Swiper 只拿"稳定的空占位 children"，切图不再触发其全量 getChildren/协调 */}
              {useVirtual ? placeholderSlides : slides}
            </MemoSwiper>

            {/* 虚拟(大 n)图片分层：内联渲染近活跃窗口的图片，放 .swiper-wrapper 内继承 Swiper transform。
                因占位 children 引用稳定，切图时 MemoSwiper 直接 bail，仅重渲染此分层(O(近活跃集)) */}
            {useVirtual && isOpen && wrapperElRef.current && virtualReady && createPortal(
              <div className="absolute inset-0">
                {Array.from(nearActiveSet).map((i) => renderVirtualOverlaySlide(i))}
              </div>,
              wrapperElRef.current
            )}

            {/* 半透明"框架"边缘层：图片不做裁切，溢出部分被此半透明框覆盖而呈半透明，形成清晰边界。
              仅imgOverflowActive(单图模式拖拽/缩放溢出)时渲染；容器此时 overflow-visible 让框影透出。 */}
            {imgOverflowActive && (
              <div
                className="pointer-events-none absolute inset-0 z-[5]"
                style={{ borderRadius: 14, boxShadow: "0 0 0 9999px var(--car-frame)" }}
              />
            )}
          </div>

          {extraOverlayContent && isOpen && extraOverlayContent({ image: images[realIndex], index: realIndex, total: totalCount, isActive: true })}

          {/* 图片功能：重命名输入面板（与名称栏同域，默认样式，可通过 renameInputClassName 覆盖） */}
          {renameState && isOpen && (() => {
            const renamingImg = images.find((i) => i.id === renameState.id);
            if (!renamingImg) return null;
            return (
              <motion.div
                initial={{ y: -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="fixed left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-lg car__ctrl px-3 py-2 sm:backdrop-blur-sm"
                style={{ top: CANVAS_EDGE_PX, border: `1px solid ${themeTokens.line}`, boxShadow: `0 8px 24px ${themeTokens.ring}26` }}
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
            );
          })()}

          <div className="flex justify-center w-full" onClick={(e) => e.stopPropagation()}>
            <motion.div
              ref={stripWheelRef}
              className={`relative z-[60] mt-[17px] shrink-0 overflow-hidden ${isStripDragging && dragMoved ? "cursor-grabbing" : "cursor-grab"}`}
              style={{
                width: STRIP_BASE_WIDTH,
                height: viewMode === 1 ? HIGHLIGHT_CENTER_WIDTH : CENTER_THUMB_SIZE,
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
                  // marginLeft 补偿 startIdx 的偏移量，使容器只需覆盖可见缩略图范围
                  // 容器宽度从 n*64px 降至 ~41*64px ≈ 2624px，大幅减少合成层面积
                  x: stripX,
                  marginLeft: stripItems.startIdx * (THUMB_SIZE + THUMB_GAP),
                  width: (stripItems.items.length + 1) * (THUMB_SIZE + THUMB_GAP),
                  height: viewMode === 1 ? HIGHLIGHT_CENTER_WIDTH : CENTER_THUMB_SIZE,
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
                  if (mode === viewMode) return;
                  preViewModeIndexRef.current = realIndexRef.current;
                  prevViewModeRef.current = viewMode;
                  setPrevViewMode(viewMode);
                  const s = swiperRef.current;
                  if (s && !s.destroyed) {
                    const wrapper = s.wrapperEl as HTMLElement;
                    wrapper.style.transition = "none";
                    const currentTransform = window.getComputedStyle(wrapper).transform;
                    wrapper.style.transform = currentTransform;
                    s.params.speed = 0;
                  }
                  isViewModeChangingRef.current = true;
                  setIsTransitioningViewMode(true);
                  setViewMode(mode);
                  setViewModeEpoch((e) => e + 1);
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
                                  preViewModeIndexRef.current = realIndexRef.current;
                                  prevViewModeRef.current = viewMode;
                                  setPrevViewMode(viewMode);
                                  const s = swiperRef.current;
                                  if (s && !s.destroyed) {
                                    const wrapper = s.wrapperEl as HTMLElement;
                                    wrapper.style.transition = "none";
                                    const currentTransform = window.getComputedStyle(wrapper).transform;
                                    wrapper.style.transform = currentTransform;
                                    s.params.speed = 0;
                                  }
                                  isViewModeChangingRef.current = true;
                                  setIsTransitioningViewMode(true);
                                  setViewMode(mode);
                                  setViewModeEpoch((e) => e + 1);
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
}) {
  return (
    <CarouselErrorBoundary>
      <SwiperLoopCarousel images={images} onNeedMore={onNeedMore} hasMore={hasMore} renderOverlay={renderOverlay} renderToolbar={renderToolbar} extraToolbarItems={extraToolbarItems} extraOverlayContent={extraOverlayContent} isOpen={isOpen} initialIndex={initialIndex} onClose={onClose} onDownload={onDownload} total={total} persistSettings={persistSettings} actions={actions} renameInputClassName={renameInputClassName} enableConcurrent={enableConcurrent} concurrency={concurrency} minChunkBytes={minChunkBytes} connectRetryMs={connectRetryMs} enableConnectRetry={enableConnectRetry} maxActiveImages={maxActiveImages} preloadRange={preloadRange} useCache={useCache} maxCache={maxCache} theme={theme} />
    </CarouselErrorBoundary>
  );
}
