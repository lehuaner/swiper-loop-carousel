import { useState, useEffect, useCallback, useMemo, useRef, useReducer } from "react";
import type { GalleryImage, PreloadedDims } from "./utils";
import { ConcurrentPreloader, type PreloadOptions, type QueueItem } from "./concurrentPreloader";

// ── useWindowWidth ──

export function useWindowWidth() {
  const [width, setWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1024
  );
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timerId);
      timerId = setTimeout(() => setWidth(window.innerWidth), 150);
    };
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      clearTimeout(timerId);
    };
  }, []);
  return width;
}

// ── useLazyVisibleSet ──
// 用 IntersectionObserver 追踪哪些索引进入/离开视口附近，
// 只渲染可见区域 ± margin 的图片，大幅减少 DOM 节点数。

const VISIBLE_MARGIN = 0; // 只在图片实际进入视口时才渲染

export function useLazyVisibleSet(itemCount: number): {
  visibleSet: Set<number>;
  observeRef: (idx: number) => (el: HTMLElement | null) => void;
  version: number;
} {
  // 用 reducer 触发重渲染；version 供父组件在可见集合变化时重算依赖项
  const [version, bump] = useReducer((c: number) => c + 1, 0);
  const visibleRef = useRef<Set<number>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elMapRef = useRef<Map<number, HTMLElement>>(new Map());

  // 延迟创建 observer（仅客户端）
  const getObserver = useCallback(() => {
    if (observerRef.current) return observerRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const idx = (entry.target as HTMLElement).dataset.lazyIdx;
          if (idx == null) continue;
          const i = Number(idx);
          if (entry.isIntersecting && !visibleRef.current.has(i)) {
            visibleRef.current.add(i);
            changed = true;
          } else if (!entry.isIntersecting && visibleRef.current.has(i)) {
            visibleRef.current.delete(i);
            changed = true;
          }
        }
        if (changed) bump();
      },
      { rootMargin: `${VISIBLE_MARGIN}px 0px ${VISIBLE_MARGIN}px 0px` }
    );
    observerRef.current = obs;
    return obs;
  }, []);

  const observeRef = useCallback(
    (idx: number) => (el: HTMLElement | null) => {
      const prev = elMapRef.current.get(idx);
      if (prev) {
        getObserver().unobserve(prev);
        elMapRef.current.delete(idx);
      }
      if (el) {
        elMapRef.current.set(idx, el);
        getObserver().observe(el);
      }
    },
    [getObserver]
  );

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const visibleSet = visibleRef.current;
  return { visibleSet, observeRef, version };
}

// ── useInView ──
// 单个元素进入/离开视口的局部检测。可见性变化只更新本组件局部 state，
// 不触发父级/全局重渲染，适合缩略图条这类"谁可见谁加载"的场景。

export function useInView<T extends HTMLElement = HTMLElement>(
  rootMargin = "0px"
): [boolean, (el: T | null) => void] {
  const [inView, setInView] = useState(false);
  const ioRef = useRef<IntersectionObserver | null>(null);

  const setRef = useCallback(
    (el: T | null) => {
      if (ioRef.current) {
        ioRef.current.disconnect();
        ioRef.current = null;
        setInView(false);
      }
      if (el) {
        const obs = new IntersectionObserver(
          (entries) => setInView(entries[0]?.isIntersecting ?? false),
          { rootMargin }
        );
        ioRef.current = obs;
        obs.observe(el);
      }
    },
    [rootMargin]
  );

  useEffect(() => () => ioRef.current?.disconnect(), []);

  return [inView, setRef];
}

// ── useImgLoaded ──
// 追踪单张图片的加载状态，用于 motion.img 的异步加载+占位符

export function useImgLoaded() {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const loadedRef = useRef(false);
  const erroredRef = useRef(false);
  const onLoad = useCallback(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      setLoaded(true);
    }
  }, []);
  const onError = useCallback(() => {
    if (!erroredRef.current) {
      erroredRef.current = true;
      setErrored(true);
    }
  }, []);
  return { loaded, errored, onLoad, onError };
}

// ── useImagePreloader ──
// 基于并发分块引擎（concurrentPreloader）的预加载器。
// 默认开启并发分块 + 优先级队列 + 可配置下载范围，零配置可用；
// 服务端不支持 Range / CORS 或文件过小时自动降级为整块 / 原生加载。

export interface ImagePreloaderApi {
  preload: (indices: number[]) => void;
  /** 立即提交加载任务（人为停止/点击缩略图等明确意图时调用） */
  preloadAround: (centerIdx: number) => void;
  /** 防抖请求加载：连续切换时重置，用户停顿后才提交（快速连点切换时调用） */
  requestLoad: (idx: number) => void;
  requestActive: (centerIdx: number, visible: number[]) => void;
  /** 清除待执行的防抖加载（关闭/卸载时调用） */
  clearPendingLoad: () => void;
  isLoaded: (idx: number) => boolean;
  hasError: (idx: number) => boolean;
  getDims: (idx: number) => PreloadedDims | undefined;
  waitFor: (idx: number) => Promise<void>;
  /** 返回某张图就绪后的最终 src（blob: 或原始 URL）；未就绪返回 undefined，调用方用缩略图兜底 */
  getReadySrc: (idx: number) => string | undefined;
  /** 返回某张原图当前的下载进度（loaded/total 字节）；未开始或未知返回 undefined */
  getProgress: (url: string) => { loaded: number; total: number } | undefined;
  /** 下载进度变化计数。作为渲染节拍，供 Carousel 在进度更新时重算 slides 刷新进度环 */
  progressVersion: number;
  /** 标记某张图正在渲染，缓存淘汰时豁免其 blob URL */
  markRendered: (idx: number) => void;
  /** 当前图是否在自动下载范围内 */
  inRange: (idx: number) => boolean;
  /** 当前队列与下载状态 */
  getQueue: () => QueueItem[];
  /** 手动入队 */
  enqueue: (idx: number) => void;
  /** 动态调整某张图优先级（数值越小越优先） */
  setPriority: (idx: number, priority: number) => void;
  pause: () => void;
  resume: () => void;
  cancel: (url: string) => void;
  /** 队列状态变化计数。用作渲染依赖，驱动"缩略图→blob"的无缝替换 */
  version: number;
}

export function useImagePreloader(images: GalleryImage[], options?: PreloadOptions): ImagePreloaderApi {
  // 每个使用方（轮播实例）持有独立的预加载器，而不是共享模块级单例：
  // 单例的 knownIdx/urls/results 都以 idx 为键，多个实例并存时会互相覆盖、
  // 导致某张图先显示原图、随后被别的实例的结果顶掉回退成缩略图。
  const preloader = useMemo(() => new ConcurrentPreloader(), []);
  const [version, setVersion] = useState(0);
  // 各 URL 的实时下载进度（loaded/total 字节）。由 onDownloadProgress 更新，
  // 供进度环显示真实百分比。回调频率=分块完成次数，直接 setState 即可，无需 rAF 合并。
  const [progressMap, setProgressMap] = useState<Record<string, { loaded: number; total: number }>>({});
  // 下载进度变化计数。作为渲染节拍：progressMap 更新时递增，
  // 让 Carousel 的 slides 重算并把最新百分比传给进度环。
  const [progressVersion, setProgressVersion] = useState(0);
  // progressMap 每次都是新对象，用 ref 保存最新值，避免 getProgress 闭包过期
  const progressRef = useRef(progressMap);
  progressRef.current = progressMap;
  // 用 rAF 把同一帧内的多次队列变化合并为一次重渲染：
  // 并发分块每次状态变更（入队/开始下载/分块完成/finally）都会触发 notifyQueue，
  // 若每次都 setVersion 会形成全量重渲染风暴，导致滑动/切换卡顿。
  const versionRafRef = useRef(0);
  // 下载进度渲染合并：progressMap 实时写 ref(进度环可取最新值)，仅渲染随 rAF 合并到一帧一次。
  const progressRafRef = useRef(0);
  const onQueueChange = useCallback(() => {
    if (versionRafRef.current) return;
    versionRafRef.current = requestAnimationFrame(() => {
      versionRafRef.current = 0;
      setVersion((v) => v + 1);
    });
  }, []);

  useEffect(() => {
    preloader.setImages(images);
  }, [preloader, images]);

  useEffect(() => {
    return () => {
      if (versionRafRef.current) cancelAnimationFrame(versionRafRef.current);
      if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
    };
  }, []);

  useEffect(() => {
    preloader.configure({
      ...options,
      onQueueChange,
      onDownloadProgress: (url, info) => {
        // 实时写 ref：进度环通过 getProgress 立即拿到最新字节，无需等待渲染
        progressRef.current = { ...progressRef.current, [url]: info };
        // 渲染合并：同一帧内多个分块完成只触发一次 progressMap/progressVersion 更新
        if (progressRafRef.current) return;
        progressRafRef.current = requestAnimationFrame(() => {
          progressRafRef.current = 0;
          setProgressMap(progressRef.current);
          setProgressVersion((v) => v + 1);
        });
      },
    });
  }, [preloader, options, onQueueChange]);

  const preload = useCallback((indices: number[]) => {
    for (const idx of indices) preloader.enqueue(idx);
  }, [preloader]);

  const preloadAround = useCallback((centerIdx: number) => {
    preloader.commitLoad(centerIdx);
  }, [preloader]);

  const requestLoad = useCallback((idx: number) => {
    preloader.requestLoad(idx);
  }, [preloader]);

  const requestActive = useCallback((centerIdx: number, visible: number[]) => {
    preloader.requestActive(centerIdx, visible);
  }, [preloader]);

  const clearPendingLoad = useCallback(() => {
    preloader.clearPendingLoad();
  }, [preloader]);

  const isLoaded = useCallback((idx: number) => preloader.isLoaded(idx), [preloader]);
  const hasError = useCallback((idx: number) => preloader.hasError(idx), [preloader]);
  const getDims = useCallback((idx: number): PreloadedDims | undefined => preloader.getDims(idx), [preloader]);
  const waitFor = useCallback(async (idx: number) => { await preloader.waitFor(idx); }, [preloader]);
  const getReadySrc = useCallback((idx: number) => preloader.getSrc(idx), [preloader]);
  const getProgress = useCallback((url: string) => progressRef.current[url], []);
  const markRendered = useCallback((idx: number) => preloader.markRendered(idx), [preloader]);
  const inRange = useCallback((idx: number) => preloader.inRange(idx), [preloader]);
  const getQueue = useCallback(() => preloader.getQueue(), [preloader]);
  const enqueue = useCallback((idx: number) => preloader.enqueue(idx), [preloader]);
  const setPriority = useCallback((idx: number, priority: number) => preloader.setPriority(idx, priority), [preloader]);
  const pause = useCallback(() => preloader.pause(), [preloader]);
  const resume = useCallback(() => preloader.resume(), [preloader]);
  const cancel = useCallback((url: string) => preloader.cancel(url), [preloader]);

  return useMemo(
    () => ({ preload, preloadAround, requestLoad, requestActive, clearPendingLoad, isLoaded, hasError, getDims, waitFor, getReadySrc, getProgress, progressVersion, markRendered, inRange, getQueue, enqueue, setPriority, pause, resume, cancel, version }),
    [preload, preloadAround, requestLoad, requestActive, clearPendingLoad, isLoaded, hasError, getDims, waitFor, getReadySrc, getProgress, progressVersion, markRendered, inRange, getQueue, enqueue, setPriority, pause, resume, cancel, version]
  );
}

// ── useFps ──
// 利用 requestAnimationFrame 统计实时帧率，用于性能调试。

export function useFps() {
  const [fps, setFps] = useState(0);
  const framesRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    let rafId: number;
    let running = true;

    const tick = (now: number) => {
      if (!running) return;
      framesRef.current++;
      const elapsed = now - lastTimeRef.current;
      if (elapsed >= 1000) {
        setFps(Math.round((framesRef.current * 1000) / elapsed));
        framesRef.current = 0;
        lastTimeRef.current = now;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafId);
    };
  }, []);

  return fps;
}

// ── usePaginatedImages ──
// 分页加载图片数据，避免一次性处理过多数据。
// 调用方提供全量数据源和每页大小，hook 返回当前已加载的切片和 loadMore 回调。

export function usePaginatedImages(
  allImages: GalleryImage[],
  pageSize: number = 100
) {
  const [loadedCount, setLoadedCount] = useState(() => Math.min(pageSize, allImages.length));
  const loadedCountRef = useRef(loadedCount);

  // 当 allImages 变化（如首次挂载），重置分页
  useEffect(() => {
    const next = Math.min(pageSize, allImages.length);
    setLoadedCount(next);
    loadedCountRef.current = next;
  }, [allImages, pageSize]);

  const loadMore = useCallback(() => {
    setLoadedCount((prev) => {
      // 防止重复触发时超过总量
      if (prev >= allImages.length) return prev;
      const next = Math.min(prev + pageSize, allImages.length);
      loadedCountRef.current = next;
      return next;
    });
  }, [allImages.length, pageSize]);

  const images = useMemo(() => allImages.slice(0, loadedCount), [allImages, loadedCount]);
  const hasMore = loadedCount < allImages.length;

  return { images, loadMore, hasMore, total: allImages.length, loaded: loadedCount };
}
