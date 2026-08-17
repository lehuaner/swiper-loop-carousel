# @lehuan/swiper-loop-carousel 并发分块预加载改造方案 · 评审

> 评审对象：把 `useImagePreloader` 的单连接 `new Image()` 预加载，升级为「并发分块下载 + 优先级队列 + 可配置下载范围」。
> 依据源代码核对：`src/hooks.ts`、`src/Carousel.tsx`、`src/AnimatedSlideImg.tsx`、`src/utils.ts`、`dist/index.d.ts`。

---

## 一、结论（TL;DR）

- **方向正确，值得做。** 国内运营商对 Cloudflare 泛播 IP 的单连接 QoS 限流是真实存在的，Range 分块是浏览器能力范围内唯一能"单张图多条 TCP 连接"的可行手段。方案对 Range/CORS 的降级设计、URL 级缓存与上限、默认开启零配置，都是对的。
- **但方案有一个"致命"且显然被低估的点：双份下载。** 只要渲染端 `<img>` 仍挂着原始 `src`，浏览器原生 lazy/eager 就会再发一次整图请求，与分块 fetch 同时打同一个被限速的端点，等于白烧一倍带宽、且用户看到的还是慢的那份。**"未就绪先用 thumbSrc"不是可选项，而是这个方案成立的前提。**
- **有 4 个实现层缺口需要补齐**：blob URL 撤销在途图片会白屏、fetch 拿不到 `naturalWidth/naturalHeight` 会破坏 `getDims/waitFor` 兼容、CSP `connect-src` 会让整块 fetch 兜底也失败需再加 `new Image()` 兜底、激活图 `loading="eager"` 与预加载冲突。
- **必须改源码仓库而非打 dist 补丁。** 本仓库就有源工程（`packages/swiper-loop-carousel`，tsup 构建），直接改 `hooks.ts` + `AnimatedSlideImg.tsx` 重新构建即可，`prepublishOnly` 已自动 build。

---

## 二、方案诊断合理性核对

| 结论 | 核对 |
|---|---|
| 多连接能突破单连接限速 | 成立。浏览器对单 `<img>` 只开一条 TCP，QoS 按连接限流时一条连接被卡死；Range 分块是唯一能对单资源开多条连接、且不浪费带宽的做法。方向上认可。 |
| 8 线程 ≈ 687KB/s（vs 单连接 150KB/s） | 与 Cloudflare anycast + 运营商按连接限流的实测特征吻合。注意 6 段只是经验值，建议做成可配置并按 Content-Length 自适应。 |
| 默认 Range 不支持则整块 fetch | 方向对，但**不完整**：见「缺口 B」——CSP 会连 fetch 一起封。 |
| URL 级缓存 + 上限 80 | 对的，但**撤销逻辑有白屏风险**：见「缺口 A」。 |
| 触发时机放在 realIndex 变化处 | 正确，源码里就在 `useEffect`（Carousel.tsx:1006）`preload([realIndex])`。
| 默认下载范围左右各 1 张 | 合理。**顺带发现**：源码 `preloadAround`（±`PRELOAD_RANGE=3`）定义了但从没被调用，当前实际只预加载当前图。所以"按范围自动预载 ±N"是**新增行为**，不是对现有行为的优化。 |

---

## 三、关键问题与风险（按严重度排序）

### A. 双份下载 —— 方案成立的前提，却最容易被忽略

现状（Carousel.tsx:1579）`<MemoAnimatedSlideImg src={img.src} ...>`，AnimatedSlideImg（AnimatedSlideImg.tsx:300）直接渲染 `<img src={src} loading={active?"eager":"lazy"}>`。

叠加你的分块预加载后，范围内图片会同时发生：

1. 预加载器用 fetch 分块拉同一 `img.src` → N 条连接；
2. 浏览器原生 `<img>` 又对**同一个原始 URL** 发一次整图请求（懒加载进入视口即触发）。

后果：**同一被限速端点被打了两次**，带宽翻倍浪费；且用户屏幕上走的是慢的原生那份，快的那份 blob 却一直闲置到 src 切换。**激活图（`loading="eager"`）最严重，浏览器立刻抢那次慢请求。**

**必须的集成要求**：范围内图片的渲染 `<img>` 一律不准用原始 `src`，只能先用 `thumbSrc`，等分块完成、blob 解码后就绪后**无缝替换**。这要求改 `AnimatedSlideImg` 的 src 接线（从"接收 src"改为"接收 resolvedSrc + pending 状态"），不是只改 hooks 就行。

> 推荐：**让预加载器成为范围内图片 src 的唯一真相源（single source of truth）**——范围内一律 thumb → blob，范围外保持原生 lazy `img.src`。这样彻底消除双份下载，也顺带统一了"并发张数上限"与"浏览器原生加载"的带宽控制（否则原生 lazy 不受你的 `maxActiveImages` 约束，会继续碎片化带宽）。

### B. fetch 拿不到图片尺寸，`getDims` / `waitFor` 兼容会被破坏

现状 `getDims` 依赖 `img.naturalWidth / naturalHeight`（hooks.ts:135）。fetch+Blob **没有解码后的图片**，拿不到天然尺寸。想维持 `getDims(idx)` 语义，必须补一步解码：

- `createImageBitmap(blob)` → 得到尺寸；或
- 把 blob URL 塞进一个隐藏 `<img>` 读 `naturalWidth`。

这一步解码本身就是成本，且 `waitFor(idx)` 的"完成"语义要改为"下载完成 + 尺寸可用"。方案里完全没提这一点，属于实现缺口。

### C. blob URL 撤销在途图片会白屏（内存上限的副作用）

`maxCache=80` 超限撤销最旧 blob 时，若某张**正在显示**的图片 src 正指向那个 blob URL，撤销后图片立刻空白。这在长画廊（>80 张）里是真实会发生的。

**必须豁免在用 blob**：`isActive` / 当前正在渲染的 slide 所引用的 blob URL 从 LRU 撤销名单里排除（引用计数或"当前显示集合"标记），只撤销既不在显示、又最旧的。撤销与显示要用同一份状态协调，避免竞态。

### D. 「整块 fetch 兜底」在严格 CSP 下也会失败，缺最后一级 `new Image()` 兜底

方案的最低降级点是整块 fetch。但浏览器对 fetch 走 `connect-src`、对 `<img>` 走 `img-src`。**消费者若配置了严格 CSP（`connect-src` 不含图床域），fetch 会直接被拒绝，连整块兜底也失败 → 图片完全加载不出来，相对现状是回归。**

降级链应为三段：`分块 fetch → 整块 fetch → new Image()`。且对同一 URL 的"是否支持 Range/CORS"判定结果要**缓存**，别每张图重复探测。

### E. 激活图 `loading="eager"` 与预加载冲突

激活图被预言载器优先下载，同时 `loading="eager"` 又让浏览器原生去抢。按 A 的结论统一由预加载器供给 src 后，激活图也应改为走 `thumbSrc → blob`，或干脆 `loading="lazy"`，二选一，避免重复。

### F. 内存瞬态翻倍

下载 6 段持有 6 个 ArrayBuffer + 合并后的整块 Blob ≈ 源文件 2 倍瞬时内存。`maxActiveImages=2` × 6 段时峰值约 2~3 个文件大小。对大图（10MB+）峰值可达 20~30MB，可接受但**合并后应立即释放各段 buffer**，并注意 `maxActiveImages` 别设太大。

### G. API 边界：props 与 methods 混在同一层

方案把 `enableConcurrent/concurrency/maxActiveImages/preloadRange...`（应挂在 `<SwiperLoopCarousel>` **props**）和 `enqueue/setPriority/getQueue/pause/cancel/onProgress/onStateChange`（应挂在 `useImagePreloader` **返回对象**上）混为一谈。二者是不同层：

- props 只负责"零配置默认可用"的开关和少量数值；
- 高级队列/进度接口应放在 hook 返回对象上（现有 `useImagePreloader` 已返回一个 curried 对象，直接扩展它即可），不要全部塞进组件 props 污染公共 API。

另外 `pause/cancel` 对轮播场景偏过度设计，建议保留但默认不用，避免没意义的 API 表面积。

### H. 移动端连接数偏激进

默认 2 张 × 6 段 = 12 条并发。4G/弱网下可能过载。建议 `concurrency`（段数）和 `maxActiveImages` 在移动端按 UA 或网络类型自适应（`navigator.connection`），或至少文档标注。

---

## 四、推荐的落地架构

```
useImagePreloader(images, options)
  │
  ├─ 三种下载策略（按 URL 判定并缓存结果）：
  │    分块 fetch(concurrency 段) ──> 整块 fetch ──> new Image()
  │
  ├─ 全局优先级队列（并发 maxActiveImages）
  │    按 |idx - realIndex| 排序，0 距离最高；快速切换把当前图置顶；
  │    范围内"先右后左"入队；范围外不入队
  │
  ├─ 结果缓存 Map<src, blobUrl>（上限 maxCache，撤销时豁免在用 URL）
  │
  └─ 返回：resolveSrc(idx)=>blobUrl  | 原 preload/isLoaded/hasError/getDims/waitFor
                          ▲
AnimatedSlideImg 改为接收 resolvedSrc + pending：
  范围内：thumbSrc（未就绪）→ blobUrl（就绪，解码后无缝替换）
  范围外：原生 lazy img.src（浏览器自管）
```

关键原则：**渲染端 src 与预加载器是同一份状态**，杜绝双份下载；`getDims` 增加解码步；esnure 撤销豁免在用 blob。

---

## 五、建议的配置项与默认值

| 配置 | 默认 | 说明 |
|---|---|---|
| `enableConcurrent` | `true` | 并发分块总开关 |
| `concurrency` | `6` | 分块段数（可按 Content-Length 自适应） |
| `maxActiveImages` | `2` | 同时下载的图片张数 |
| `preloadRange` | `[-1,1]` | 自动下载范围；`[]`/`0` 关闭 |
| `useCache` | `true` | URL 级结果缓存 |
| `maxCache` | `80` | blob URL 上限（撤销豁免在用） |
| `minChunkSize` | `256KB` | 小于该值走整块下载 |
| `onDownloadProgress` | — | 进度回调 |
| `onQueueChange` | — | 队列状态回调 |

> 若保留 `preloadAround` 兼容，注意它目前用 `PRELOAD_RANGE=3`（7 张）；新默认 `[-1,1]`（3 张）与它不一致，需明确旧接口走哪个范围。

---

## 六、落地路径（不要打 dist 补丁）

本仓库就有源工程：`packages/swiper-loop-carousel/`，入口 `src/hooks.ts`（`useImagePreloader`）+ `src/AnimatedSlideImg.tsx`（接收 src）+ `src/Carousel.tsx`（传参 + realIndex 触发）。`package.json` 的 `prepublishOnly` 已自动 `tsup` 构建。

1. `src/hooks.ts`：重构 `useImagePreloader`，新增策略判定 + 优先级队列 + 缓存 + 解码尺寸；返回对象补齐队列/进度接口。
2. `src/AnimatedSlideImg.tsx`：props 改为 `resolvedSrc` + `pending`，范围内图片 thumb→blob 无缝替换。
3. `src/Carousel.tsx`：realIndex 变化处调用范围入队；激活图避免 eager 与预加载重复。
4. `src/utils.ts`：`PRELOAD_RANGE` 与新 `preloadRange` 的关系理顺。
5. 重建 + `dist/index.d.ts` 补类型声明（`GalleryImage` 不变，新增可选项与 hook 返回类型）。
6. README 补一段「并发前提条件」（Range / CORS / 文件大小 / CSP 兜底）与降级说明。

---

## 七、验证与测试策略

- **判定缓存**：同一 URL 的 Range/CORS 探测结果只做一次，避免重复探测。
- **降级矩阵**：构造 4 种服务端（支持Range+CORS / 只Range无CORS / 无Range有CORS / 全不支持）与 2 种文件大小（<256KB / 大图），验证逐级降级不报错、图片最终能显示。
- **快切竞态**：快速前后切换，校验当前图能置顶、切走的在途请求被 `AbortController` 取消、迟到的响应被丢弃（stale-guard）。
- **撤销白屏**：长画廊 + `maxCache` 调小，验证在用 blob 不被撤销。
- **CSP 回归**：配一条不含图床域的 `connect-src`，验证最终落到 `new Image()`，图片仍能显示。
- **真实带宽**：在限速网络下对比单连接 / 分块 / 整块三种模式的加载耗时，确认提速幅度与连接数关系。
- **调试开关**：加一个 `debug` 标志，逐个 URL 输出走的是 `chunked / whole / native` 哪条路径，便于线上核对降级是否发生。