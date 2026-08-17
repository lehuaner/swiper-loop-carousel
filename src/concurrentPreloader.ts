// 并发分块预加载引擎：
// - 用 fetch + Range 头把单张图分成多段并行拉取，突破单连接 QoS 限速；
// - 服务端不支持 Range / CORS 或文件过小时自动降级；
// - 全局优先级队列控制并发图片张数，按距中心图距离排序、先右后左；
// - URL 级结果缓存 + blob URL 上限，超限撤销（豁免当前显示中的图片）。

export type PreloadStrategy = "chunked" | "whole" | "native";
export type QueueState = "pending" | "downloading" | "done" | "error";

export interface QueueItem {
  url: string;
  idx: number;
  priority: number;
  state: QueueState;
  strategy?: PreloadStrategy;
}

export interface ResolvedResource {
  url: string;
  idx: number;
  /** 最终渲染 src：分块/整块成功为 blob:，否则回退为原始 URL */
  src: string;
  w: number;
  h: number;
  strategy: PreloadStrategy;
  errored: boolean;
}

export type PreloadRange = number | [number, number];

export interface PreloadOptions {
  /** 并发分块总开关 */
  enableConcurrent?: boolean;
  /** 分块段数 */
  concurrency?: number;
  /** 同时下载的图片张数 */
  maxActiveImages?: number;
  /** 自动下载范围：数字 N 等价于 [-N, N]；[] 或 0 表示关闭 */
  preloadRange?: PreloadRange | [];
  /** URL 级结果缓存 */
  useCache?: boolean;
  /** blob URL 缓存上限 */
  maxCache?: number;
  /** 小于该字节数的文件不做分块，直接整块下载 */
  minChunkBytes?: number;
  /** 等待服务器响应（TTFB）超过该毫秒即 abort 并重发本块（含探测首块）。
   *  仅检测请求头到达，不判定 body 下载带宽；用于服务器响应偶发卡死时换连接重开 */
  connectRetryMs?: number;
  /** 上述超时重发机制的开关 */
  enableConnectRetry?: boolean;
  /** 快速切换防抖：连续切换时重置定时器，用户停顿该毫秒后才提交加载任务（默认 120） */
  loadDebounceMs?: number;
  /** 有界任务队列上限：同时最多保留多少个图片加载任务。
   *  新增任务时若已排满，直接停止末位（第 maxTasks 个）任务（默认 5） */
  maxTasks?: number;
  onDownloadProgress?: (url: string, info: { loaded: number; total: number }) => void;
  onQueueChange?: (queue: QueueItem[]) => void;
}

const DEFAULTS = {
  enableConcurrent: true,
  concurrency: 6,
  maxActiveImages: 2,
  preloadRange: [-1, 1] as PreloadRange,
  useCache: true,
  maxCache: 80,
  minChunkBytes: 256 * 1024,
  connectRetryMs: 1000,
  enableConnectRetry: true,
  loadDebounceMs: 120,
  maxTasks: 5,
};

/** 分块请求需要等服务器响应（TTFB）。当 fetch 的请求头在 timeoutMs 内未到达时 abort 并重发。
 *  - 仅当外层未取消（outer 未 abort）且确实是超时（非网络错误）才重试，最多 MAX 次；
 *  - timeoutMs 为 false 表示关闭该机制，正常单次请求。 */
const CONNECT_RETRY_MAX = 3;
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number | false,
  outer?: AbortSignal
): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const ctrl = new AbortController();
    const onOuterAbort = () => ctrl.abort();
    outer?.addEventListener("abort", onOuterAbort, { once: true });
    const timer = timeoutMs !== false && timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : undefined;
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      const timedOut = !!timer && ctrl.signal.aborted && !outer?.aborted;
      attempt++;
      if (timedOut && attempt < CONNECT_RETRY_MAX) continue; // 仅超时重发，换一次连接
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    }
  }
}

function normalizeRange(range: PreloadRange | []): [number, number] {
  if (Array.isArray(range)) {
    if (range.length === 0) return [0, 0];
    const a = Math.min(range[0], range[1]);
    const b = Math.max(range[0], range[1]);
    return [a, b];
  }
  const n = Math.max(0, Math.abs(range));
  return [-n, n];
}

export class ConcurrentPreloader {
  private opts: Required<Omit<PreloadOptions, "onDownloadProgress" | "onQueueChange">> = {
    ...DEFAULTS,
  };
  private onDownloadProgress?: PreloadOptions["onDownloadProgress"];
  private onQueueChange?: PreloadOptions["onQueueChange"];

  private urls: string[] = [];
  private results = new Map<string, ResolvedResource>();
  private inflight = new Map<string, Promise<void>>();
  private queue: (QueueItem & { controller?: AbortController })[] = [];
  private activeCount = 0;
  private centerIdx = 0;
  private usedIdx = new Set<number>();
  private cacheOrder: string[] = [];
  private knownIdx = new Map<number, string>();
  private paused = false;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingIdx: number | null = null;
  private pendingActive: { center: number; visible: number[] } | null = null;

  setImages(images: { src: string }[]) {
    this.urls = images.map((i) => i.src);
  }

  configure(options: PreloadOptions) {
    if (options.enableConcurrent != null) this.opts.enableConcurrent = options.enableConcurrent;
    if (options.concurrency != null) this.opts.concurrency = Math.max(1, options.concurrency);
    if (options.maxActiveImages != null) this.opts.maxActiveImages = Math.max(1, options.maxActiveImages);
    if (options.preloadRange != null) this.opts.preloadRange = options.preloadRange;
    if (options.useCache != null) this.opts.useCache = options.useCache;
    if (options.maxCache != null) this.opts.maxCache = Math.max(1, options.maxCache);
    if (options.minChunkBytes != null) this.opts.minChunkBytes = Math.max(1, options.minChunkBytes);
    if (options.connectRetryMs != null) this.opts.connectRetryMs = Math.max(0, options.connectRetryMs);
    if (options.enableConnectRetry != null) this.opts.enableConnectRetry = options.enableConnectRetry;
    if (options.loadDebounceMs != null) this.opts.loadDebounceMs = Math.max(0, options.loadDebounceMs);
    if (options.maxTasks != null) this.opts.maxTasks = Math.max(1, options.maxTasks);
    if (options.onDownloadProgress != null) this.onDownloadProgress = options.onDownloadProgress;
    if (options.onQueueChange != null) this.onQueueChange = options.onQueueChange;
  }

  getRange(): PreloadRange | [] {
    return this.opts.preloadRange;
  }

  private priorityOf(idx: number): number {
    const dist = Math.abs(idx - this.centerIdx);
    if (dist === 0) return 0;
    // 距离近优先；同距离先右后左
    return dist * 2 - (idx > this.centerIdx ? 1 : 0);
  }

  private notifyQueue() {
    this.onQueueChange?.(this.queue.map((q) => ({ url: q.url, idx: q.idx, priority: q.priority, state: q.state, strategy: q.strategy })));
  }

  /** 设置中心图索引，仅更新优先级，不再中止任何在途下载。
   *  新的防抖 + 有界队列模式由 commitLoad 管理，不再需要切换时中止。 */
  setCenter(idx: number) {
    this.centerIdx = idx;
    // 只保留中心附近的渲染标记，避免 usedIdx 无界增长而失去缓存淘汰能力
    const WINDOW = 4;
    for (const i of this.usedIdx) {
      if (Math.abs(i - idx) > WINDOW) this.usedIdx.delete(i);
    }
    for (const item of this.queue) {
      if (item.state === "pending") {
        item.priority = this.priorityOf(item.idx);
      }
    }
  }

  inRange(idx: number): boolean {
    const [a, b] = normalizeRange(this.opts.preloadRange);
    return idx >= this.centerIdx + a && idx <= this.centerIdx + b;
  }

  /** 防抖请求加载：连续切换（键盘/按钮连点）时重置定时器不加载，
   *  用户停顿 loadDebounceMs 后才提交加载任务。由切换时调用。 */
  requestLoad(idx: number) {
    this.pendingIdx = idx;
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = setTimeout(() => {
      this.loadTimer = null;
      const target = this.pendingIdx;
      this.pendingIdx = null;
      if (target != null) this.commitLoad(target);
    }, this.opts.loadDebounceMs);
  }

  /** 清除待执行的防抖加载（关闭/卸载时调用，避免关闭后仍加载旧图） */
  clearPendingLoad() {
    if (this.loadTimer) {
      clearTimeout(this.loadTimer);
      this.loadTimer = null;
    }
    this.pendingIdx = null;
    this.pendingActive = null;
  }

  /** 防抖请求加载一组共视图片（双图/三图/多图：全部可见 slide 的原图都应就绪，
   *  而非只加载中心图）。连续切换时重置定时器不加载，停顿后才提交。 */
  requestActive(centerIdx: number, visible: number[]) {
    this.pendingActive = { center: centerIdx, visible: visible.slice() };
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = setTimeout(() => {
      this.loadTimer = null;
      const p = this.pendingActive;
      this.pendingActive = null;
      if (p) this.commitActive(p.center, p.visible);
    }, this.opts.loadDebounceMs);
  }

  /** 提交加载：目标集 = 中心图及其 preloadRange 邻图 ∪ 当前全部可见图。
   *  有界队列、中心优先、不中止在途下载。确保双图/三图里第二张及以后的
   *  可见原图也会被预载（preloadRange 较小时 commitLoad 只覆盖中心，导致它们停在缩略图）。 */
  commitActive(centerIdx: number, visible: number[]) {
    this.setCenter(centerIdx);
    const [a, b] = normalizeRange(this.opts.preloadRange);
    const targets = new Set<number>();
    for (let off = a; off <= b; off++) {
      const t = centerIdx + off;
      if (t >= 0 && t < this.urls.length) targets.add(t);
    }
    for (const i of visible) {
      if (i >= 0 && i < this.urls.length) targets.add(i);
    }
    console.log("[preloader] commitActive targets", JSON.stringify([...targets]), "queueBefore", this.queue.length, "paused", this.paused);
    // 保留仍在途的下载，复用其进度（切图只是降级，不杀任务）
    const rest = this.queue.filter((q) => q.state === "downloading");
    const front: QueueItem[] = [];
    const ordered = [...targets].sort((x, y) => this.priorityOf(x) - this.priorityOf(y));
    for (const i of ordered) {
      const url = this.urls[i];
      if (!url) continue;
      if (this.results.has(url)) continue;
      if (this.inflight.has(url)) continue;
      if (front.some((q) => q.url === url)) continue;
      front.push({ url, idx: i, priority: this.priorityOf(i), state: "pending" as QueueState });
    }
    this.queue = [...front, ...rest];
    // 有界队列：超出容量则直接停止末位任务
    while (this.queue.length > this.opts.maxTasks) {
      this.dropTask(this.queue[this.queue.length - 1]);
    }
    this.reclaimForFront();
    this.process();
    this.notifyQueue();
  }

  /** 提交加载任务：用户停在 idx 时，把 idx 及其邻图（preloadRange）放入任务队列前端。
   *  - 在途下载不中止，让其继续完成（切换只是降级，不杀任务）
   *  - 队列有界（maxTasks），超出时直接停止末位任务
   *  - 新任务放队首，旧任务整体后移 */
  commitLoad(idx: number) {
    this.setCenter(idx);
    const [a, b] = normalizeRange(this.opts.preloadRange);
    const indices: number[] = [];
    for (let off = a; off <= b; off++) {
      const t = idx + off;
      if (t >= 0 && t < this.urls.length) indices.push(t);
    }
    indices.sort((x, y) => this.priorityOf(x) - this.priorityOf(y));
    const front: QueueItem[] = [];
    for (const i of indices) {
      const url = this.urls[i];
      if (!url) continue;
      if (this.results.has(url)) continue;
      if (this.inflight.has(url)) continue;
      if (this.queue.some((q) => q.url === url)) continue;
      front.push({ url, idx: i, priority: this.priorityOf(i), state: "pending" as QueueState });
    }
    if (front.length) this.queue = [...front, ...this.queue];
    // 有界队列：超出容量则直接停止末位任务
    while (this.queue.length > this.opts.maxTasks) {
      this.dropTask(this.queue[this.queue.length - 1]);
    }
    // 抢占槽位：当前显示的图（队首、优先级最高）必须立即下载。
    // 若下载槽位被更低优先级的在途任务占满，将它们暂停（置回 pending 保留在队列），
    // 让出槽位给中心图，而不是让中心图干等慢速的无关下载。
    this.reclaimForFront();
    this.process();
    this.notifyQueue();
  }

  /** 让当前中心图优先占用下载槽位：暂停所有比队首待下载任务更无关（优先级更低）的在途下载 */
  private reclaimForFront() {
    const top = this.queue.find((q) => q.state === "pending");
    if (!top) return;
    const topPrio = this.priorityOf(top.idx);
    // 按当前中心图重算各在途任务的优先级，挑出比 top 更无关的，最无关的优先暂停
    const toAbort = this.queue
      .filter((q) => q.state === "downloading" && this.priorityOf(q.idx) > topPrio)
      .sort((a, b) => this.priorityOf(b.idx) - this.priorityOf(a.idx));
    for (const t of toAbort) t.controller?.abort();
  }

  /** 直接停止某任务：中止在途下载并从队列移除（用于队列超限时舍弃末位） */
  private dropTask(item: QueueItem & { controller?: AbortController }) {
    item.controller?.abort();
    this.queue = this.queue.filter((q) => q !== item);
  }

  enqueue(idx: number) {
    if (idx < 0 || idx >= this.urls.length) return;
    const url = this.urls[idx];
    if (!url) return;
    if (this.results.has(url)) return;
    if (this.inflight.has(url)) return;
    let item = this.queue.find((q) => q.url === url);
    if (item) {
      const np = this.priorityOf(idx);
      if (np < item.priority) item.priority = np;
      return;
    }
    item = { url, idx, priority: this.priorityOf(idx), state: "pending" as QueueState };
    this.queue.push(item);
    this.process();
  }

  /** 标记某张图片正在渲染，缓存淘汰时豁免其 blob URL */
  markRendered(idx: number) {
    this.usedIdx.add(idx);
  }

  private process() {
    if (this.paused) return;
    while (this.activeCount < this.opts.maxActiveImages) {
      const pending = this.queue.filter((q) => q.state === "pending");
      if (!pending.length) break;
      // 按队列顺序（重排后的优先级）取第一个 pending
      this.startDownload(pending[0]);
    }
  }

  private startDownload(item: QueueItem & { controller?: AbortController }) {
    item.state = "downloading";
    item.controller = new AbortController();
    this.activeCount++;
    // 下载开始时通知一次（total 未知），让进度环立即出现并归零
    this.onDownloadProgress?.(item.url, { loaded: 0, total: 0 });
    const p = this.runDownload(item).finally(() => {
      this.activeCount--;
      // 完成/出错的任务移出队列；被暂停（优先级抢占时 abort 置回 pending）的任务保留在队列，
      // 等槽位释放后继续下载——即"其他正在下载的任务可以暂停"。
      if (item.state !== "pending") {
        this.queue = this.queue.filter((q) => q !== item);
      }
      this.process();
    });
    this.inflight.set(item.url, p);
  }

  private async runDownload(item: QueueItem & { controller?: AbortController }) {
    const url = item.url;
    const signal = item.controller?.signal;
    try {
      if (signal?.aborted) {
        item.state = "pending";
        return;
      }
      let blob: Blob | null = null;
      let strategy: PreloadStrategy = "native";
      if (this.opts.enableConcurrent) {
        try {
          const r = await this.downloadBlob(url, signal);
          blob = r.blob;
          strategy = r.strategy;
        } catch {
          blob = null;
        }
      }
      if (signal?.aborted) {
        item.state = "pending";
        return;
      }
      if (blob) {
        const { w, h } = await this.measureBlob(blob);
        if (signal?.aborted) {
          item.state = "pending";
          return;
        }
        const src = this.opts.useCache ? URL.createObjectURL(blob) : url;
        if (this.opts.useCache) {
          this.cacheOrder.push(url);
          this.evictCache();
        }
        this.results.set(url, { url, idx: item.idx, src, w, h, strategy, errored: w <= 0 || h <= 0 });
        this.knownIdx.set(item.idx, url);
      } else {
        // CORS 拒绝 / 网络错误 / 关闭并发：退回原生整图加载
        const dims = await this.loadNative(url, signal);
        if (signal?.aborted) {
          item.state = "pending";
          return;
        }
        this.results.set(url, {
          url,
          idx: item.idx,
          src: url,
          w: dims.w,
          h: dims.h,
          strategy,
          errored: dims.w <= 0 || dims.h <= 0,
        });
        this.knownIdx.set(item.idx, url);
      }
      item.state = "done";
      // 仅在图片真正就绪（src 可替换）时通知，触发一次全局重渲染换 src；
      // 入队/开始下载/中止等导航伴随操作不通知，避免导航过程中频繁重建整个 Swiper 树导致卡顿。
      this.notifyQueue();
    } catch {
      item.state = signal?.aborted ? "pending" : "error";
    } finally {
      this.inflight.delete(url);
    }
  }

  /** 分块下载。
   *  1. 直接发第一块 Range bytes=0-{minChunkBytes-1}，首块数据与 total 一次拿到，
   *     响应头 Content-Range 携带 total，首块体同时已在路上——省掉原先"bytes=0-0 单独探测"
   *     那一次完整串行 RTT（关键路径从「探测RTT + 全部块」缩为「探测块下载」）。
   *  2. 拿到 total 与首块体后，从首块末尾起把剩余部分并行切块下载。
   *  兜底：
   *   - 200：服务器忽略 Range，整图下载；
   *   - 206 + content-range 可读：上一步分块；
   *   - 206 + content-range 不可读（跨域未暴露）：无法预知 total，用开区间 Range bytes=0- 整拉。 */
  private async downloadBlob(url: string, signal?: AbortSignal): Promise<{ blob: Blob; strategy: PreloadStrategy }> {
    // 超时阈值：开关关闭或时长为 0 时传 false，表示不启用超时重发
    const timeoutMs = this.opts.enableConnectRetry && this.opts.connectRetryMs > 0 ? this.opts.connectRetryMs : false;
    const firstRange = `bytes=0-${Math.max(0, this.opts.minChunkBytes - 1)}`;
    const first = await fetchWithTimeout(url, { headers: { Range: firstRange } }, timeoutMs, signal);
    if (!first.ok) throw new Error("range response not ok");

    // 200 = 服务器忽略 Range，返回完整内容
    if (first.status !== 206) {
      return { blob: await first.blob(), strategy: "whole" };
    }

    // 用重定向后的最终 URL 发分块，避免每块重复 302
    const finalUrl = first.url;
    const firstBlob = await first.blob();
    const cr = first.headers.get("content-range");

    if (cr) {
      const total = Number(cr.split("/")[1]) || 0;
      // 首块已覆盖全部（小文件）→ 直接返回首块
      if (total > 0 && firstBlob.size >= total) {
        this.onDownloadProgress?.(url, { loaded: total, total });
        return { blob: firstBlob, strategy: "chunked" };
      }
      if (total > 0) {
        const remaining = total - firstBlob.size;
        const parts = Math.min(this.opts.concurrency, Math.max(1, Math.ceil(remaining / this.opts.minChunkBytes)));
        const chunkSize = Math.ceil(remaining / parts);
        const ranges: [number, number][] = [];
        for (let i = 0; i < parts; i++) {
          const s = firstBlob.size + i * chunkSize;
          ranges.push([s, Math.min(s + chunkSize - 1, total - 1)]);
        }
        let acc = firstBlob.size;
        this.onDownloadProgress?.(url, { loaded: acc, total });
        const blobs = await Promise.all(
          ranges.map(([s, e]) =>
            fetchWithTimeout(finalUrl, { headers: { Range: `bytes=${s}-${e}` } }, timeoutMs, signal)
              .then((r) => {
                if (!r.ok) throw new Error("range response not ok");
                return r.blob();
              })
              .then((b) => {
                // 每块完成即累计回调，让进度环反映真实下载进度（而非整张结束才一次性 100%）
                acc += b.size;
                this.onDownloadProgress?.(url, { loaded: Math.min(acc, total), total });
                return b;
              })
          )
        );
        this.onDownloadProgress?.(url, { loaded: total, total });
        return { blob: new Blob([firstBlob, ...blobs], { type: firstBlob.type || "" }), strategy: "chunked" };
      }
      // total 解析异常：退回整图下载
      const full = await fetchWithTimeout(finalUrl, {}, timeoutMs, signal);
      if (!full.ok) throw new Error("range response not ok");
      return { blob: await full.blob(), strategy: "whole" };
    }

    // 206 但 CORS 不暴露 content-range：跨域无法得知 total，无法精确切块。
    // 用开区间 Range bytes=0- 整拉文件；服务器忽略时回 200 完整内容，两种都是完整图。
    const restRes = await fetchWithTimeout(finalUrl, { headers: { Range: "bytes=0-" } }, timeoutMs, signal);
    if (!restRes.ok) throw new Error("range response not ok");
    const restBlob = await restRes.blob();
    if (restRes.status !== 206) return { blob: restBlob, strategy: "whole" };
    this.onDownloadProgress?.(url, { loaded: restBlob.size, total: restBlob.size });
    return { blob: restBlob, strategy: "chunked" };
  }

  private async measureBlob(blob: Blob): Promise<{ w: number; h: number }> {
    try {
      const bmp = await createImageBitmap(blob);
      const w = bmp.width;
      const h = bmp.height;
      bmp.close();
      return { w, h };
    } catch {
      return { w: 0, h: 0 };
    }
  }

  private loadNative(url: string, signal?: AbortSignal): Promise<{ w: number; h: number }> {
    return new Promise((resolve) => {
      const img = new Image();
      const onAbort = () => resolve({ w: 0, h: 0 });
      signal?.addEventListener("abort", onAbort, { once: true });
      img.onload = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve({ w: 0, h: 0 });
      };
      img.src = url;
    });
  }

  private evictCache() {
    const toRemove = this.cacheOrder.length - this.opts.maxCache;
    if (toRemove <= 0) return;
    let removed = 0;
    const keep: string[] = [];
    for (const url of this.cacheOrder) {
      if (removed < toRemove) {
        const res = this.results.get(url);
        const inUse = res && (this.usedIdx.has(res.idx) || res.idx === this.centerIdx);
        if (res && res.src.startsWith("blob:") && !inUse) {
          URL.revokeObjectURL(res.src);
          this.results.delete(url);
          this.knownIdx.delete(res.idx);
          removed++;
          continue;
        }
      }
      keep.push(url);
    }
    this.cacheOrder = keep;
  }

  isLoaded(idx: number): boolean {
    const url = this.knownIdx.get(idx) ?? this.urls[idx];
    const res = url ? this.results.get(url) : undefined;
    return !!res && !res.errored;
  }

  hasError(idx: number): boolean {
    const url = this.knownIdx.get(idx) ?? this.urls[idx];
    const res = url ? this.results.get(url) : undefined;
    return !!res && res.errored;
  }

  getSrc(idx: number): string | undefined {
    const url = this.knownIdx.get(idx) ?? this.urls[idx];
    const res = url ? this.results.get(url) : undefined;
    return res && !res.errored ? res.src : undefined;
  }

  getDims(idx: number): { w: number; h: number } | undefined {
    const url = this.knownIdx.get(idx) ?? this.urls[idx];
    const res = url ? this.results.get(url) : undefined;
    return res ? { w: res.w, h: res.h } : undefined;
  }

  async waitFor(idx: number): Promise<void> {
    const url = this.urls[idx];
    if (!url) return;
    if (this.results.has(url)) return;
    const inf = this.inflight.get(url);
    if (inf) {
      await inf;
      return;
    }
    this.enqueue(idx);
    const p = this.inflight.get(url);
    if (p) await p;
  }

  getQueue(): QueueItem[] {
    return this.queue.map((q) => ({ url: q.url, idx: q.idx, priority: q.priority, state: q.state, strategy: q.strategy }));
  }

  setPriority(idx: number, priority: number) {
    const url = this.urls[idx];
    const item = url ? this.queue.find((q) => q.url === url) : undefined;
    if (item && item.state === "pending") {
      item.priority = priority;
      this.notifyQueue();
    }
  }

  cancel(url: string) {
    const item = this.queue.find((q) => q.url === url);
    if (item) {
      item.controller?.abort();
      this.queue = this.queue.filter((q) => q.url !== url);
      this.notifyQueue();
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.process();
  }
}

let singleton: ConcurrentPreloader | null = null;

export function getPreloader(): ConcurrentPreloader {
  if (!singleton) singleton = new ConcurrentPreloader();
  return singleton;
}