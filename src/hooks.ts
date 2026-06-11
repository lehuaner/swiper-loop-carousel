import { useState, useEffect, useCallback, useMemo, useRef, useReducer } from "react";
import type { GalleryImage, PreloadedDims } from "./utils";
import { PRELOAD_RANGE } from "./utils";

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
  observeRef: (idx: number) => (el: HTMLDivElement | null) => void;
} {
  // 用 reducer 触发重渲染
  const [, bump] = useReducer((c: number) => c + 1, 0);
  const visibleRef = useRef<Set<number>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elMapRef = useRef<Map<number, HTMLDivElement>>(new Map());

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
    (idx: number) => (el: HTMLDivElement | null) => {
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
  return { visibleSet, observeRef };
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

export function useImagePreloader(images: GalleryImage[]) {
  const loadedRef = useRef<Set<number>>(new Set());
  const erroredRef = useRef<Set<number>>(new Set());
  const loadingRef = useRef<Map<number, Promise<void>>>(new Map());
  const dimsRef = useRef<Map<number, PreloadedDims>>(new Map());

  const preload = useCallback((indices: number[]) => {
    for (const idx of indices) {
      if (idx < 0 || idx >= images.length) continue;
      if (loadedRef.current.has(idx) || erroredRef.current.has(idx) || loadingRef.current.has(idx)) continue;
      const img = new Image();
      const promise = new Promise<void>((resolve) => {
        img.onload = () => {
          loadedRef.current.add(idx);
          loadingRef.current.delete(idx);
          dimsRef.current.set(idx, { w: img.naturalWidth, h: img.naturalHeight });
          resolve();
        };
        img.onerror = () => {
          // 加载失败：记录到 erroredRef，不标记为 loaded，避免 isLoaded 误判
          erroredRef.current.add(idx);
          loadingRef.current.delete(idx);
          resolve();
        };
      });
      loadingRef.current.set(idx, promise);
      img.src = images[idx].src;
    }
  }, []);

  const isLoaded = useCallback((idx: number) => loadedRef.current.has(idx), []);

  const hasError = useCallback((idx: number) => erroredRef.current.has(idx), []);

  const getDims = useCallback((idx: number): PreloadedDims | undefined => {
    return dimsRef.current.get(idx);
  }, []);

  const waitFor = useCallback(async (idx: number): Promise<void> => {
    if (loadedRef.current.has(idx)) return;
    const existing = loadingRef.current.get(idx);
    if (existing) {
      await existing;
      return;
    }
    preload([idx]);
    const promise = loadingRef.current.get(idx);
    if (promise) await promise;
  }, [preload]);

  const preloadAround = useCallback((centerIdx: number) => {
    const indices: number[] = [];
    for (let offset = -PRELOAD_RANGE; offset <= PRELOAD_RANGE; offset++) {
      const idx = centerIdx + offset;
      if (idx >= 0 && idx < images.length) {
        indices.push(idx);
      }
    }
    preload(indices);
  }, [preload]);

  return useMemo(
    () => ({ preload, preloadAround, isLoaded, hasError, getDims, waitFor }),
    [preload, preloadAround, isLoaded, hasError, getDims, waitFor]
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
