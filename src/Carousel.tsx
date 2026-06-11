"use client";

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, startTransition, Component, type CSSProperties, type ReactNode } from "react";
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
import { useImagePreloader, useWindowWidth } from "./hooks";
import { useCarouselI18n, useCarouselLang } from "./i18n";
import AnimatedSlideImg from "./AnimatedSlideImg";
import HintBar from "./HintBar";

// ── Memoized 子组件 ──

// AnimatedSlideImg：忽略 onExitComplete（内部已用 ref 追踪），避免父组件渲染导致不必要的子组件重渲染
const MemoAnimatedSlideImg = React.memo(
  AnimatedSlideImg,
  (prev, next) =>
    prev.src === next.src &&
    prev.isActive === next.isActive &&
    prev.wasActive === next.wasActive &&
    prev.loading === next.loading &&
    prev.viewModeEpoch === next.viewModeEpoch &&
    prev.viewModeOffsetX === next.viewModeOffsetX &&
    prev.entryXFrom === next.entryXFrom &&
    prev.entryScaleFrom === next.entryScaleFrom &&
    prev.entryXOffset === next.entryXOffset &&
    prev.isExitingOnViewModeChange === next.isExitingOnViewModeChange
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
    const [loaded, setLoaded] = useState(false);
    const loadedRef = useRef(false);
    const imgElRef = useRef<HTMLImageElement>(null);

    // 检测图片是否已缓存（remount 时避免闪烁，useLayoutEffect 在 paint 前执行）
    useLayoutEffect(() => {
      const img = imgElRef.current;
      if (img && img.complete && img.naturalWidth > 0) {
        loadedRef.current = true;
        setLoaded(true);
      }
    }, []);

    return (
      <motion.button
        onClick={() => onThumbClick(idx)}
        animate={{
          scale: active ? activeScale : 1,
          opacity: active ? 1 : 0.6,
        }}
        transition={{
          type: "spring",
          stiffness: 320,
          damping: 24,
          mass: 0.7,
        }}
        className={`flex-shrink-0 overflow-hidden rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${active ? "relative z-10" : ""}`}
        style={{ position: "absolute", left: offsetX, top: (stripHeight - THUMB_SIZE) / 2, width: THUMB_SIZE, height: THUMB_SIZE }}
        aria-label={`Go to ${img.alt}`}
        aria-current={active ? "true" : undefined}
      >
        <div className="relative h-full w-full">
          {!loaded && (
            <div className="absolute inset-0 animate-pulse bg-slate-700/50" />
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

function SwiperLoopCarousel({
  images,
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
}) {
  const t = useCarouselI18n();
  const lang = useCarouselLang();
  const [activeId, setActiveId] = useState<number | null>(null);
  const isControlled = isOpenProp !== undefined;
  const isOpen = isControlled ? isOpenProp : activeId !== null;
  const [realIndex, setRealIndex] = useState(0);
  const [viewMode, setViewMode] = useState<1 | 2 | 3>(1);
  const [viewModeEpoch, setViewModeEpoch] = useState(0);
  const swiperRef = useRef<SwiperClass | null>(null);
  const initialLoadRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [isStripDragging, setIsStripDragging] = useState(false);
  const [dragMoved, setDragMoved] = useState(false);
  const [stripDensityLevel, setStripDensityLevel] = useState<1 | 2 | 3>(3);
  const [isKeyboardActive, setIsKeyboardActive] = useState(false);
  const isKeyboardActiveRef = useRef(false);
  useEffect(() => { isKeyboardActiveRef.current = isKeyboardActive; }, [isKeyboardActive]);
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
  const [wheelMode, setWheelMode] = useState<"zoom" | "switch">("zoom");
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

  const preloader = useImagePreloader(images);

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
        }
        setRealIndex(idx);
        realIndexRef.current = idx;
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
        // hasMore 时到达边界：在 state updater 外部触发加载，避免渲染期间调用 setState
        const currentPending = pendingRealIndexRef.current;
        const atBoundaryNow =
          (direction === "right" && currentPending >= n - step) ||
          (direction === "left" && currentPending < step);
        if (atBoundaryNow && hasMore) {
          onNeedMore?.();
          return;
        }
        startTransition(() => {
          setPendingRealIndex((prev) => {
            if (postWrapRef.current) {
              return prev;
            }
            const next = direction === "right" ? prev + step : prev - step;
            const atBoundary =
              (direction === "right" && prev >= n - step) ||
              (direction === "left" && prev < step);
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
        processArrowPress(direction, true);
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
      const idx = images.findIndex((i) => i.id === id);
      setIsKeyboardActive(false);
      setIsStripDragging(false);
      setDragMoved(false);
      if (idx >= 0) {
        preloader.preload([idx]);

        const w = window.innerWidth;
        const wideCount = w < 1024 ? 11 : 15;
        const initialStripWidth =
          wideCount * THUMB_SIZE + (wideCount - 1) * THUMB_GAP;
        const initialBaseX = (initialStripWidth - THUMB_SIZE) / 2;
        const initialTargetX = initialBaseX - idx * (THUMB_SIZE + THUMB_GAP);
        stripX.set(initialTargetX);
        setPendingRealIndex(idx);
        pendingRealIndexRef.current = idx;
        setRealIndex(idx);
        // 每张图片的 motionX/Y/Scale 独立，无需保存/恢复。
        // 同步到 preViewModeIndexRef，防止视图模式变化的 useEffect 读到默认值 0 而覆盖位置
        preViewModeIndexRef.current = idx;
      }
      setActiveId((prev) => (prev === id ? prev : id));

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
      const focusable =
        overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      // 使用 preventScroll 阻止 focus 导致的自动滚动，避免外部页面 scroll 回到顶部
      focusable[0]?.focus({ preventScroll: true });
    }
    const startKeyboardHold = (direction: "left" | "right") => {
      // 使用三级加速模拟按钮长按效果
      keyboardHoldStartRef.current = Date.now();
      const tick = () => {
        processArrowPress(direction, true);
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
        processArrowPress("right", false);
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
        processArrowPress("left", false);
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
  }, [isOpen, processArrowPress, processArrowRelease, clearButtonHold]);

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

  useEffect(() => {
    realIndexRef.current = realIndex;
    if (!isOpen) return;
    preloader.preload([realIndex]);

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
  }, [isOpen, realIndex, preloader]);

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
        setIsStripDragging(true);
        setDragMoved(true);
      }
      if (dragStarted) {
        stripDragRef.current.delta = delta;
        const scale = stripScale.get();
        const adjustedDelta = scale < 1 ? delta / scale : delta;
        stripX.set(capturedBaseXRef.current + adjustedDelta);
        // 根据当前拖拽位置计算可见中心索引，用于扩展虚拟范围
        // 用 rAF 节流 setStripDragVisibleIdx，避免每次 pointermove 都触发重渲染
        const currentIdx = Math.round((STRIP_BASE_X - stripX.get()) / STRIP_THUMB_PITCH);
        const clampedIdx = Math.max(0, Math.min(n - 1, currentIdx));
        if (clampedIdx !== stripDragVisibleIdxRef.current) {
          stripDragVisibleIdxRef.current = clampedIdx;
          if (stripDragIdxRafRef.current == null) {
            stripDragIdxRafRef.current = requestAnimationFrame(() => {
              stripDragIdxRafRef.current = null;
              setStripDragVisibleIdx(stripDragVisibleIdxRef.current);
            });
          }
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
  }, [stripX, stripScale, n, STRIP_THUMB_PITCH, STRIP_BASE_X, goToIndex]);

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

  // 用 ref 绑定 wheel（{ passive: false }），避免 passive listener 中 preventDefault 的警告
  useEffect(() => {
    if (!isOpen) return;
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      if (wheelModeRef.current === "switch") {
        // 滚轮切换到切换模式
        const dir = e.deltaY > 0 ? 1 : -1;
        const swiper = swiperRef.current;
        if (!swiper || swiper.destroyed || isNavigationLockedRef.current || n <= 1) return;
        const currentIdx = realIndexRef.current;
        const total = hasMore ? n : n;
        const nextIdx = currentIdx + dir;
        if (hasMore && (nextIdx < 0 || nextIdx >= total)) {
          onNeedMore?.();
          return;
        }
        const targetIdx = hasMore ? nextIdx : ((nextIdx % n) + n) % n;
        slideDirectionRef.current = dir > 0 ? 1 : -1;
        if (swiper.params.loop) {
          swiper.slideToLoop(targetIdx);
        } else {
          swiper.slideTo(targetIdx);
        }
        setRealIndex(targetIdx);
        realIndexRef.current = targetIdx;
        pendingRealIndexRef.current = targetIdx;
        setPendingRealIndex(targetIdx);
        return;
      }
      // 滚轮缩放模式（默认）
      const idx = resolveImgIndexFromTarget(e.target);
      const motions = imageMotionsMapRef.current.get(idx);
      if (!motions) return;
      const oldScale = motions.scale.get();
      const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
      const newScale = Math.max(0.5, Math.min(5, oldScale * factor));
      if (newScale === oldScale) return;
      const imgEl = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-img-index]");
      const imgRect = imgEl?.getBoundingClientRect();
      const containerRect = el.getBoundingClientRect();
      if (!containerRect) return;
      const { newX, newY } = computeZoomTransform({
        pointerX: e.clientX,
        pointerY: e.clientY,
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
      dirtyMotionIndicesRef.current.add(idx);
      if (swiperRef.current) {
        swiperRef.current.allowTouchMove = newScale <= 1;
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [isOpen, resolveImgIndexFromTarget]);

  // ── 触摸缩放手势 ──

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      setIsPinching(true);
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
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      const newDist = Math.hypot(
        t1.clientX - t2.clientX,
        t1.clientY - t2.clientY
      );
      const factor = newDist / ps.initialDist;
      const motions = imageMotionsMapRef.current.get(ps.idx);
      if (!motions) return;
      const oldScale = motions.scale.get();
      const newScale = Math.max(0.5, Math.min(5, ps.initialScale * factor));
      const imgEl = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-img-index]");
      const imgRect = imgEl?.getBoundingClientRect();
      const midX = (t1.clientX + t2.clientX) / 2;
      const midY = (t1.clientY + t2.clientY) / 2;
      const { newX, newY } = computeZoomTransform({
        pointerX: midX,
        pointerY: midY,
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
    },
    []
  );

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      pinchStateRef.current = null;
      setIsPinching(false);
      // 优化：只检查当前图片的缩放状态，而非遍历全部图片
      const motions = imageMotionsMapRef.current.get(realIndexRef.current);
      const zoomed = motions ? motions.scale.get() > 1 : false;
      if (swiperRef.current) {
        swiperRef.current.allowTouchMove = !zoomed;
      }
    }
  }, []);

  // ── 渲染 ──

  const swiperContainerStyle = {
    width: "90vw",
    height: `calc(100dvh - ${BOTTOM_RESERVED}px - 32px)`,
  } as CSSProperties;

  // 稳定化 Swiper props，避免每次渲染触发 Swiper 内部 updateSwiper
  // modules 和 virtual 配置用 useMemo 缓存，防止每次渲染创建新数组/对象导致 MemoSwiper 失效
  const swiperModules = useMemo(() => useVirtual ? [Virtual] : undefined, [useVirtual]);
  const swiperVirtual = useMemo(() => useVirtual ? { addSlidesBefore: 5, addSlidesAfter: 5, cache: false } : undefined, [useVirtual]);
  const handleSwiperInit = useCallback((s: SwiperClass) => {
    swiperRef.current = s;
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
    }
  }, []);
  const handleSlideChange = useCallback((s: SwiperClass) => {
    if (s.destroyed) return;
    if (isViewModeChangingRef.current) return;
    const newIdx = s.realIndex;
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
    setPendingRealIndex(newIdx);
    pendingRealIndexRef.current = newIdx;

    // 分页加载：当用户滑动到接近末尾时，通知父组件加载更多
    if (onNeedMore) {
      const threshold = Math.max(10, Math.min(30, n * 0.1));
      if (newIdx >= n - threshold) {
        onNeedMore();
      }
    }
  }, [onNeedMore, n, hasMore, useVirtual]);

  const currentAlt = images[realIndex]?.alt ?? "";
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
  const renderSlideContent = useCallback((index: number) => {
    const img = images[index];
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
    return (
      <SwiperSlide key={index} virtualIndex={index} className={`!flex items-center justify-center${viewMode === 1 && !isTransitioningViewMode ? " !overflow-hidden" : ""}`}>
        <div
          data-img-index={index}
          className={`relative flex h-full w-full items-center justify-center ${isTransitioningViewMode ? "" : "overflow-hidden"}`}
          style={viewModeZIndex != null ? { position: "relative", zIndex: viewModeZIndex } : undefined}
        >
          <motion.div
            drag={!isPinching}
            dragElastic={0}
            dragMomentum={false}
            onDragStart={() => {
              if (swiperRef.current) {
                swiperRef.current.allowTouchMove = false;
              }
            }}
            onDragEnd={() => {
              if (swiperRef.current) {
                swiperRef.current.allowTouchMove = !isZoomedRef.current;
              }
            }}
            style={{
              x: getOrCreateImageMotions(index).x,
              y: getOrCreateImageMotions(index).y,
              scale: getOrCreateImageMotions(index).scale,
              willChange: "transform",
              touchAction: "none",
            }}
            className="flex h-full w-full items-center justify-center"
          >
            <MemoAnimatedSlideImg
              src={img.src}
              alt=""
              isActive={isActive}
              wasActive={wasActiveMap.get(index)}
              loading={index === realIndex ? "eager" : "lazy"}
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
              className="pointer-events-none absolute top-2 z-10 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white sm:backdrop-blur-sm whitespace-nowrap left-1/2 -translate-x-1/2 sm:left-3 sm:translate-x-0"
            >
              {renderOverlay ? renderOverlay({ image: img, index, total: totalCount, isActive }) : (
                <>
                  <span>{index + 1} / {totalCount}</span>
                  <span className="ml-2 text-white/70">{img.alt}</span>
                  {img.dimensions
                    ? <span className="ml-2 text-white/50">{img.dimensions}</span>
                    : (img.width && img.height && <span className="ml-2 text-white/50">{img.width}×{img.height}</span>)
                  }
                  {img.sizeLabel
                    ? <span className="ml-2 text-white/50">{img.sizeLabel}</span>
                    : (img.fileSize != null && <span className="ml-2 text-white/50">{formatFileSize(img.fileSize)}</span>)
                  }
                  {onDownload && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDownload(index); }}
                      className="pointer-events-auto ml-2 inline-flex items-center justify-center text-white/70 hover:text-white"
                      aria-label="Download"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </button>
                  )}
                </>
              )}
            </motion.div>
          )}
        </div>
      </SwiperSlide>
    );
  }, [images, realIndex, n, prevViewMode, viewMode, isTransitioningViewMode, containerWidth, containerHeight, preloader, isPinching, activeIndices, wasActiveMap, viewModeEpoch, slideDirectionRef, getOrCreateImageMotions, renderOverlay, onDownload]);

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
  }, [isOpen, placeholderSlides, nearActiveSet, renderSlideContent]);

  // 缩略图条虚拟化列表：仅当 realIndex/active/loaded 变化时重算
  // 使用相对偏移定位（offsetX = 相对 startIdx 的像素偏移），避免大 idx 时 left 值过大
  const stripItems = useMemo(() => {
    const STRIP_VIRTUAL_RANGE = 20;
    // 拖拽时以拖拽可见中心为基准，键盘/按钮长按时以 pendingRealIndex 为基准，确保即将进入视口的缩略图已渲染
    const centerIdx = isStripDragging ? stripDragVisibleIdx : isKeyboardActive ? pendingRealIndex : realIndex;
    const startIdx = Math.max(0, centerIdx - STRIP_VIRTUAL_RANGE);
    const endIdx = Math.min(n - 1, centerIdx + STRIP_VIRTUAL_RANGE);
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
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 sm:bg-black/85 sm:backdrop-blur-sm select-none pt-8 overflow-hidden"
          style={{ overscrollBehavior: "none" }}
          onClick={() => {
            if (closeSuppressedRef.current) {
              closeSuppressedRef.current = false;
              return;
            }
            close();
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
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
              initialSlide={activeIndex}
              speed={400}
              onSwiper={handleSwiperInit}
              onSlideChange={handleSlideChange}
              className={`absolute inset-0 h-full w-full${isTransitioningViewMode ? " !overflow-visible" : ""}`}
            >
              {slides}
            </MemoSwiper>
          </div>

          {extraOverlayContent && isOpen && extraOverlayContent({ image: images[realIndex], index: realIndex, total: totalCount, isActive: true })}

          <div className="flex justify-center w-full" onClick={(e) => e.stopPropagation()}>
            <motion.div
              className={`relative z-[60] mt-[15px] shrink-0 overflow-hidden ${isStripDragging && dragMoved ? "cursor-grabbing" : "cursor-grab"}`}
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
                className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-white shadow-[0_0_0_2px_rgba(255,255,255,0.25)]"
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
                className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-xs text-white sm:backdrop-blur-sm hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white group relative"
                aria-label={t.close}
              >
                ✕
                <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/80 px-2.5 py-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none shadow-lg backdrop-blur-sm z-50">
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
                className={`fixed left-0 top-0 z-20 flex h-full w-16 items-center justify-center bg-black/0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white group ${isNavigationLocked ? "cursor-default opacity-30" : "cursor-pointer"} ${!isNavigationLocked && !isStripDragging ? "hover:bg-black/20" : ""}`}
                aria-label={t.prev}
              >
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-lg text-white sm:backdrop-blur-sm"
                  aria-hidden="true"
                >
                  ‹
                </span>
                <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/80 px-2.5 py-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none shadow-lg backdrop-blur-sm z-50">
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
                  className={`absolute inset-0 transition-colors group ${isNavigationLocked ? "cursor-default opacity-30" : "cursor-pointer"} ${!isNavigationLocked && !isStripDragging ? "hover:bg-black/20" : ""}`}
                  onPointerDown={isNavigationLocked ? undefined : (e) => handleButtonPress(e, "right")}
                  onPointerUp={isNavigationLocked ? undefined : (e) => handleButtonRelease(e)}
                  onPointerCancel={isNavigationLocked ? undefined : (e) => handleButtonRelease(e)}
                  role="button"
                  aria-label={t.next}
                  tabIndex={-1}
                >
                  <div className="pointer-events-none flex h-full w-full items-center justify-center">
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-lg text-white sm:backdrop-blur-sm"
                      aria-hidden="true"
                    >
                  ›
                </span>
                  </div>
                  <span className="absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/80 px-2.5 py-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none shadow-lg backdrop-blur-sm z-50">
                    {t.next}
                    <span className="absolute left-full top-1/2 -translate-y-1/2 border-[5px] border-transparent border-l-black/80" />
                  </span>
                </div>

                <div
                  className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 hidden lg:flex w-[56px] flex-col items-stretch rounded-2xl bg-black/40 p-1 sm:backdrop-blur-sm gap-1"
                  style={isStripDragging ? { pointerEvents: 'none' } : undefined}
                  onPointerDown={(e) => e.stopPropagation()}
                  onPointerUp={(e) => e.stopPropagation()}
                  onPointerCancel={(e) => e.stopPropagation()}
                >
                  {/* 视图模式 - 二级菜单 */}
                  <div className="relative" data-dropdown="viewmode">
                    <button
                      type="button"
                      onClick={() => setOpenMenu(openMenu === "viewmode" ? null : "viewmode")}
                      className={`relative flex h-6 w-full items-center justify-center rounded-lg text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white group ${
                        (n < 2) ? "opacity-30 cursor-not-allowed" : "text-white/70 hover:text-white cursor-pointer"
                      }`}
                      disabled={n < 2}
                      aria-label={t.viewModeGroup}
                    >
                      <span className="relative z-10">{t[VIEW_MODE_CONFIG[viewMode].labelKey]}</span>
                      <span className={`absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/80 px-2.5 py-1.5 text-xs text-white opacity-0 transition-opacity pointer-events-none shadow-lg backdrop-blur-sm z-40 ${openMenu !== "viewmode" ? "group-hover:opacity-100" : ""}`}>
                        {t.viewModeGroup}
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full border-[5px] border-transparent border-l-black/80" />
                      </span>
                    </button>
                    <AnimatePresence>
                      {openMenu === "viewmode" && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.92, x: -4 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.92, x: -4 }}
                          transition={{ duration: 0.15, ease: "easeOut" }}
                          className="absolute right-full mr-2 top-0 flex flex-col items-stretch rounded-xl bg-black/75 p-0.5 shadow-lg backdrop-blur-sm z-50 gap-px" style={{ minWidth: 56 }}
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
                                className={`relative flex h-6 items-center justify-center rounded-lg text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white whitespace-nowrap px-4 ${
                                  isDisabled
                                    ? "text-white/20 cursor-not-allowed"
                                    : isActive
                                      ? "text-black"
                                      : "text-white/70 hover:text-white cursor-pointer"
                                }`}
                                aria-label={t[cfg.labelKey]}
                                aria-pressed={isActive}
                              >
                                {isActive && (
                                  <motion.div
                                    layoutId="viewmode-active"
                                    className="absolute inset-0 rounded-lg bg-white"
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
                  <div className="mx-2 h-px bg-white/20" role="separator" aria-orientation="horizontal" />
                  {/* 密度 - 二级菜单 */}
                  <div className="relative" data-dropdown="density">
                    <button
                      type="button"
                      onClick={() => setOpenMenu(openMenu === "density" ? null : "density")}
                      className={`relative flex h-6 w-full items-center justify-center rounded-lg text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white group cursor-pointer text-white/70 hover:text-white`}
                      aria-label={t.densityGroup}
                    >
                      <span className="relative z-10">{t[STRIP_DENSITY_CONFIG[stripDensityLevel].labelKey]}</span>
                      <span className={`absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/80 px-2.5 py-1.5 text-xs text-white opacity-0 transition-opacity pointer-events-none shadow-lg backdrop-blur-sm z-40 ${openMenu !== "density" ? "group-hover:opacity-100" : ""}`}>
                        {t.densityGroup}
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full border-[5px] border-transparent border-l-black/80" />
                      </span>
                    </button>
                    <AnimatePresence>
                      {openMenu === "density" && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.92, x: -4 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.92, x: -4 }}
                          transition={{ duration: 0.15, ease: "easeOut" }}
                          className="absolute right-full mr-2 top-0 flex flex-col items-stretch rounded-xl bg-black/75 p-0.5 shadow-lg backdrop-blur-sm z-50 gap-px" style={{ minWidth: 56 }}
                        >
                          {([1, 2, 3] as const).map((level) => {
                            const isActive = stripDensityLevel === level;
                            const cfg = STRIP_DENSITY_CONFIG[level];
                            return (
                              <button
                                key={level}
                                type="button"
                                onClick={() => { setStripDensityLevel(level); setOpenMenu(null); }}
                                className={`relative flex h-6 items-center justify-center rounded-lg text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white whitespace-nowrap px-4 cursor-pointer ${
                                  isActive
                                    ? "text-black"
                                    : "text-white/70 hover:text-white"
                                }`}
                                aria-label={`${t[cfg.labelKey]}: ${cfg.visible}/${cfg.drag}`}
                                aria-pressed={isActive}
                              >
                                {isActive && (
                                  <motion.div
                                    layoutId="density-active"
                                    className="absolute inset-0 rounded-lg bg-white"
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
                  <div className="mx-2 h-px bg-white/20" role="separator" aria-orientation="horizontal" />
                  {/* 滚轮功能 - 二级菜单 */}
                  <div className="relative" data-dropdown="wheel">
                    <button
                      type="button"
                      onClick={() => setOpenMenu(openMenu === "wheel" ? null : "wheel")}
                      className={`relative flex h-6 w-full items-center justify-center rounded-lg text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white group cursor-pointer text-white/70 hover:text-white`}
                      aria-label={t.wheelGroup}
                    >
                      <span className="relative z-10">{t[wheelMode === "zoom" ? "wheelZoom" : "wheelSwitch"]}</span>
                      <span className={`absolute right-full mr-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/80 px-2.5 py-1.5 text-xs text-white opacity-0 transition-opacity pointer-events-none shadow-lg backdrop-blur-sm z-40 ${openMenu !== "wheel" ? "group-hover:opacity-100" : ""}`}>
                        {t.wheelGroup}
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full border-[5px] border-transparent border-l-black/80" />
                      </span>
                    </button>
                    <AnimatePresence>
                      {openMenu === "wheel" && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.92, x: -4 }}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.92, x: -4 }}
                          transition={{ duration: 0.15, ease: "easeOut" }}
                          className="absolute right-full mr-2 top-0 flex flex-col items-stretch rounded-xl bg-black/75 p-0.5 shadow-lg backdrop-blur-sm z-50 gap-px" style={{ minWidth: 56 }}
                        >
                          {(["zoom", "switch"] as const).map((mode) => {
                            const isActive = wheelMode === mode;
                            return (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => { setWheelMode(mode); setOpenMenu(null); }}
                                className={`relative flex h-6 items-center justify-center rounded-lg text-[10px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white whitespace-nowrap px-4 cursor-pointer ${
                                  isActive
                                    ? "text-black"
                                    : "text-white/70 hover:text-white"
                                }`}
                                aria-label={t[mode === "zoom" ? "wheelZoom" : "wheelSwitch"]}
                                aria-pressed={isActive}
                              >
                                {isActive && (
                                  <motion.div
                                    layoutId="wheel-active"
                                    className="absolute inset-0 rounded-lg bg-white"
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
}) {
  return (
    <CarouselErrorBoundary>
      <SwiperLoopCarousel images={images} onNeedMore={onNeedMore} hasMore={hasMore} renderOverlay={renderOverlay} renderToolbar={renderToolbar} extraToolbarItems={extraToolbarItems} extraOverlayContent={extraOverlayContent} isOpen={isOpen} initialIndex={initialIndex} onClose={onClose} onDownload={onDownload} total={total} />
    </CarouselErrorBoundary>
  );
}
