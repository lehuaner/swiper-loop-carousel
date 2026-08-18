# @lehuan/swiper-loop-carousel

<p align="center">
  <a href="https://www.npmjs.com/package/@lehuan/swiper-loop-carousel"><img src="https://img.shields.io/npm/v/@lehuan/swiper-loop-carousel?style=flat-square&logo=npm" alt="npm version" /></a>
  <a href="https://github.com/lehuaner/swiper-loop-carousel/releases"><img src="https://img.shields.io/github/v/release/lehuaner/swiper-loop-carousel?style=flat-square&logo=github" alt="GitHub release" /></a>
  <a href="https://github.com/lehuaner/swiper-loop-carousel"><img src="https://img.shields.io/github/stars/lehuaner/swiper-loop-carousel?style=flat-square&logo=github" alt="GitHub stars" /></a>
  <a href="https://github.com/lehuaner/swiper-loop-carousel/blob/master/LICENSE"><img src="https://img.shields.io/npm/l/@lehuan/swiper-loop-carousel?style=flat-square" alt="License" /></a>
  <a href="https://www.npmjs.com/package/@lehuan/swiper-loop-carousel"><img src="https://img.shields.io/npm/dm/@lehuan/swiper-loop-carousel?style=flat-square" alt="npm downloads" /></a>
  <img src="https://img.shields.io/badge/react-18%20%7C%2019-61DAFB?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/swiper-%5E12-6332F6?style=flat-square&logo=swiper" alt="Swiper" />
</p>

A Swiper-based infinite loop carousel component with thumbnail drag navigation, keyboard long-press fast preview, scroll/pinch zoom, and multi-view mode switching. Deeply optimized for 10K+ images.

- [GitHub Repository](https://github.com/lehuaner/swiper-loop-carousel)
- [NPM Package](https://www.npmjs.com/package/@lehuan/swiper-loop-carousel)
- [中文文档](./README.md)

## Screenshots

<p align="center">
  <img src="https://raw.githubusercontent.com/lehuaner/swiper-loop-carousel/master/assets/desktop.png" alt="Desktop screenshot" width="45%" />
  <img src="https://raw.githubusercontent.com/lehuaner/swiper-loop-carousel/master/assets/mobile.png" alt="Mobile screenshot" width="30%" />
  <br />
  <em>Desktop (left) and Mobile (right) preview</em>
</p>

## Features

- **Infinite Loop** - Seamless head-to-tail transition via Swiper Loop
- **Thumbnail Strip** - Drag navigation, 3-tier keyboard long-press acceleration, adjustable density
- **Multi-View Modes** - Single/Dual/Triple image layouts with continuous camera-like transitions
- **Zoom** - Scroll wheel zoom, pinch-to-zoom on mobile, drag to pan
- **10K+ Images** - Swiper Virtual mode, thumbnail virtualization, incremental caching, memory auto-reclaim
- **Paginated Loading** - Built-in `usePaginatedImages` hook, auto-loads on scroll near end
- **Internationalization** - Built-in Chinese/English, supports custom overrides
- **Controlled/Uncontrolled** - Both open modes for flexible integration
- **Settings Persistence** - View mode, thumbnail density, and wheel action can optionally persist to localStorage
- **Thumbnail Strip Wheel** - Hovering the thumbnail strip switches images with the wheel (always on, independent of zoom/switch mode), frame-batched and pagination-aware
- **Image Action Slots** - A customizable action bar inside the image name bar (built-in delete/rename), supporting free reordering, enable/disable, custom icons, and custom business logic
- **Concurrent Chunked Preloading** - Splits each full-size image into parallel segments via `fetch` + `Range` to break single-connection QoS throttling, with automatic degradation when unsupported
- **TTFB Timeout Retry** - Automatically re-requests a chunk when the server response exceeds the threshold; a ring shows the real download percentage (same ring spins when total size is unknown)
- **Theme Switching** - `dark` / `light` themes, one-click toggle for the whole palette

## Installation

```bash
npm install @lehuan/swiper-loop-carousel swiper motion
```

## Tailwind CSS Setup

**Required**: This component uses Tailwind CSS utility classes for all styling. Your project's Tailwind must scan the package's compiled output to generate the corresponding CSS.

### Tailwind v3

Add the package path to your `tailwind.config.js` `content` array:

```js
module.exports = {
  content: [
    "./src/**/*.{ts,tsx}",
    "./node_modules/@lehuan/swiper-loop-carousel/dist/**/*.{js,cjs}",
  ],
}
```

### Tailwind v4

Add the `@source` directive in your entry CSS file:

```css
@import "tailwindcss";
@source "../node_modules/@lehuan/swiper-loop-carousel/";
```

### Why is this necessary?

All component styles are written as Tailwind utility classes (e.g., `bg-black/90`, `text-white`, `rounded-xl`). These class names remain as string literals in the compiled output (`dist/*.{js,cjs}`), which the Tailwind content scanner can parse to generate the corresponding CSS. No separate CSS files need to be imported from the package, and there's no conflict with your project's Tailwind configuration.

## Quick Start

### Basic Usage (Uncontrolled)

```tsx
import { SwiperLoopCarousel } from "@lehuan/swiper-loop-carousel";
import type { GalleryImage } from "@lehuan/swiper-loop-carousel";

const images: GalleryImage[] = [
  { id: 1, src: "/img1.jpg", thumbSrc: "/thumb1.jpg", alt: "Photo 1" },
  { id: 2, src: "/img2.jpg", thumbSrc: "/thumb2.jpg", alt: "Photo 2" },
  // ...
];

function Gallery() {
  return <SwiperLoopCarousel images={images} />;
}
```

### Controlled Mode

```tsx
function Gallery() {
  const [isOpen, setIsOpen] = useState(false);
  const [idx, setIdx] = useState(0);

  return (
    <>
      <button onClick={() => { setIdx(0); setIsOpen(true); }}>Open Gallery</button>
      <SwiperLoopCarousel
        images={images}
        isOpen={isOpen}
        initialIndex={idx}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
```

### 10K+ Images with Paginated Loading

```tsx
import {
  SwiperLoopCarousel,
  CarouselI18nProvider,
  usePaginatedImages,
} from "@lehuan/swiper-loop-carousel";

const allImages: GalleryImage[] = generateImages(10000);

function MassiveGallery() {
  const { images, loadMore, hasMore, total } = usePaginatedImages(allImages, 200);
  const [isOpen, setIsOpen] = useState(false);
  const [idx, setIdx] = useState(0);

  return (
    <>
      <button onClick={() => { setIdx(0); setIsOpen(true); }}>Open</button>
      <SwiperLoopCarousel
        images={images}
        onNeedMore={loadMore}
        hasMore={hasMore}
        total={total}           // overlay shows "3/10000" instead of "3/200"
        isOpen={isOpen}
        initialIndex={idx}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
```

### Internationalization

```tsx
import { CarouselI18nProvider } from "@lehuan/swiper-loop-carousel";

<CarouselI18nProvider lang="en">
  <SwiperLoopCarousel images={images} />
</CarouselI18nProvider>

// Custom overrides
<CarouselI18nProvider lang="zh" overrides={{ close: "返回", prev: "上一页" }}>
  <SwiperLoopCarousel images={images} />
</CarouselI18nProvider>
```

### Settings Persistence

When enabled, view mode, thumbnail density, and wheel action are saved to browser localStorage. Closing and reopening the component (or opening another instance) will reuse the same settings.

```tsx
// Use default storage key (shared across all instances)
<SwiperLoopCarousel images={images} persistSettings />

// Use custom storage key (isolate or share as needed)
<SwiperLoopCarousel images={images} persistSettings="my-gallery-settings" />
```

### Theme Switching

Use the `theme` prop to toggle the whole palette with one switch (arrows, action menu, toolbar, thumbnail strip backgrounds/text colors change together; the overlay backdrop stays transparent and can be fine-tuned via CSS variables):

```tsx
// Light theme
<SwiperLoopCarousel images={images} theme="light" />

// Dark theme (default). Black controls are brightened by 10% over pure black for a softer silhouette
<SwiperLoopCarousel images={images} theme="dark" />
```

### Concurrent Loading Configuration

By default the component uses `fetch` + `Range` to split each full-size image into `concurrency` (default 6) parallel segments, merges them into a `Blob`, and uses the `blob:` URL as the final render source — breaking the single-connection QoS throttling seen on some CDNs (e.g. Cloudflare anycast IPs) in China. Real-world measurement: ~150KB/s on a single connection, up to 600KB/s+ with 6–8 concurrent segments. See the "Concurrent Chunked Preloading" section below for the mechanism and degradation rules.

**Loading progress**: before the full-size image is ready, the thumbnail serves as a persistent underlay (no black-flash), with a unified ring on top — it fills to the real percentage when the total file size is known, and spins (same ring) when unknown; once ready, the thumbnail fades out and the `blob:` full image takes over.

```tsx
<SwiperLoopCarousel
  images={images}
  enableConcurrent          // enable chunked concurrency (default)
  concurrency={8}           // 8 parallel segments per image
  minChunkBytes={256 * 1024}
  maxActiveImages={2}       // download at most 2 images concurrently
  connectRetryMs={1200}     // re-request when TTFB exceeds this
  enableConnectRetry        // enable timeout retry (default)
  preloadRange={[-2, 2]}    // auto-preload ±2 images
/>
```

> Each of `enableConcurrent`/`concurrency`/`minChunkBytes`/`maxActiveImages`/`connectRetryMs`/`preloadRange`/`useCache`/`maxCache`/`loadDebounceMs`/`maxTasks` can also be controlled individually — see the Props table below.

## API

### SwiperLoopCarousel Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `images` | `GalleryImage[]` | **Required** | Array of image data |
| `isOpen` | `boolean` | `undefined` | Controlled mode: whether open. `undefined` uses internal state |
| `initialIndex` | `number` | `0` | Controlled mode: initial image index |
| `onClose` | `() => void` | - | Controlled mode: close callback |
| `total` | `number` | `images.length` | Total image count (including unloaded), for overlay "3/10000" display |
| `onNeedMore` | `() => void` | - | Pagination: triggered when scrolling near the end |
| `hasMore` | `boolean` | `false` | Whether more images are available to load |
| `renderOverlay` | `(props) => ReactNode` | - | Custom overlay content, replaces default index/alt/size info |
| `renderToolbar` | `(props) => ReactNode` | - | Custom toolbar, fully replaces the default |
| `extraToolbarItems` | `ReactNode` | - | Extra items appended to the right of the default toolbar |
| `extraOverlayContent` | `(props) => ReactNode` | - | Extra content appended to the overlay area |
| `onDownload` | `(index: number) => void` | - | Download callback; shows download button when provided |
| `persistSettings` | `boolean \| string` | `undefined` | Persist settings to localStorage. `true` uses default key, `string` uses custom key, `undefined`/`false` disables |
| `actions` | `CarouselAction[]` | built-in `[rename, delete]` | Image name bar action slots. Caller fully controls order, enable/disable, icon and function; built-in `delete`/`rename` always run their local behavior, `onSelect` appends real business logic |
| `renameInputClassName` | `string` | - | Custom class name appended to the rename input default styles, to override font/color/size |
| `enableConcurrent` | `boolean` | `true` | Concurrent chunked download master switch. `false` falls back to native full-image preload |
| `concurrency` | `number` | `6` | Number of chunk segments. More segments better break single-connection throttling, at higher connection cost |
| `minChunkBytes` | `number` | `262144` | Chunk-size threshold (default 256KB). Files smaller than this are not chunked; the first request downloads the whole file |
| `maxActiveImages` | `number` | `2` | Concurrently downloaded image count. Avoids bandwidth fragmentation |
| `preloadRange` | `number \| [number, number] \| []` | `[-1,1]` | Auto-download range. `N` equals `[-N, N]`; `[a,b]` offsets from `a` to `b`; `[]`/`0` disables auto preload |
| `useCache` | `boolean` | `true` | URL-level result cache. Each URL downloads once per session |
| `maxCache` | `number` | `80` | Blob URL cache limit. Evicts oldest blob URLs beyond limit (exempts currently displayed image) |
| `loadDebounceMs` | `number` | `120` | Rapid-switch debounce ms. During consecutive switching no download happens; commit after user pauses |
| `maxTasks` | `number` | `5` | Bounded task queue limit. When full, the tail (maxTasks-th) task is dropped to free room for new ones |
| `enableConnectRetry` | `boolean` | `true` | Master switch for TTFB timeout retry. `false` disables it |
| `connectRetryMs` | `number` | `1000` | Re-request a chunk if the server response (TTFB) exceeds this many ms; only when `enableConnectRetry` is `true` |
| `theme` | `"dark" \| "light"` | `"dark"` | Overall color theme. `"dark"` brightens black controls by 10% over pure black; `"light"` is a light theme |

### GalleryImage

```ts
interface GalleryImage {
  id: number;
  src: string;        // Full-size image URL
  thumbSrc: string;   // Thumbnail URL
  alt: string;        // Image description
  width?: number;     // Original width (shown in overlay)
  height?: number;    // Original height (shown in overlay)
  fileSize?: number;  // File size in bytes (shown in overlay)
  sizeLabel?: string; // Custom file size text, takes priority over fileSize
  dimensions?: string;// Custom dimension text, takes priority over width×height
}
```

### Image Action Slots (`actions`)

The action bar renders inside the same container as the image name bar. Two built-in actions are provided by default: `rename` and `delete`. When `actions` is omitted, the built-in defaults apply; when provided, the caller fully controls order, enable/disable, icon and function:

```tsx
import type { CarouselAction } from "@lehuan/swiper-loop-carousel";

const actions: CarouselAction[] = [
  { key: "rename", label: "Rename" },
  {
    key: "delete",
    label: "Delete",
    // Built-in delete always runs its local behavior (fly-out animation + local
    // unload + updates top counter / thumbnail strip). onSelect appends real logic.
    onSelect: ({ image }) => {
      // Hook your real deletion here (e.g. call a delete API)
      void image;
    },
  },
];

<SwiperLoopCarousel images={images} actions={actions} renameInputClassName="custom-input-class" />
```

`CarouselAction` fields:

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | Unique id. Built-in actions use `"delete"` and `"rename"` |
| `icon` | `ReactNode` | Icon node (built-in actions use default SVG icons when omitted) |
| `label` | `string` | Tooltip / accessible label (recommended for custom actions) |
| `enabled` | `boolean` | Whether enabled. `false` grays out and disables (default `true`) |
| `onSelect` | `(ctx) => void` | Click callback. Built-in `delete`/`rename` always run their local behavior; this appends caller logic. Non-built-in actions only invoke this callback |

Behavior notes:

- **Delete**: plays a "fly-out" vanish animation on click, then locally unloads the image within the preview — top counter, name bar, and thumbnail strip update immediately. **The component does not delete the resource**; the caller designs real deletion in `onSelect`. The image returns after closing/reopening unless the caller also removes it from the `images` source.
- **Rename**: invokes a rename input (default style, overridable via `renameInputClassName`), refreshing the name bar live while typing; `Enter` commits, `Esc` cancels. Renaming is local and dynamic; persistence is the caller's responsibility.

### Hooks

#### `usePaginatedImages(allImages, pageSize?)`

Load image data in batches to avoid processing too much data at once.

```ts
const { images, loadMore, hasMore, total, loaded } = usePaginatedImages(allImages, 200);
```

| Return | Type | Description |
|--------|------|-------------|
| `images` | `GalleryImage[]` | Currently loaded image slice |
| `loadMore` | `() => void` | Load the next batch |
| `hasMore` | `boolean` | Whether more images exist |
| `total` | `number` | Total number of all images |
| `loaded` | `number` | Number of loaded images |

#### `useImagePreloader(images, options?)`

Concurrent image preloading. Defaults to "concurrent chunked download + priority queue + configurable download range"; works with zero config and degrades gracefully (never errors) when the server is unsupported.

```ts
const preloader = useImagePreloader(images, { preloadRange: [-2, 2] });
preloader.preload([0, 1, 2]);              // Preload specific indices
preloader.preloadAround(5);                 // Immediately commit centered tasks by preloadRange
preloader.requestLoad(5);                   // Debounced load: resets on consecutive switches, commits after loadDebounceMs
preloader.requestActive(5, [4, 5, 6]);      // Immediately commit auto-range tasks for "center + visible set"
preloader.clearPendingLoad();               // Clear the pending debounced load (call on close)
preloader.isLoaded(0);                      // Check if loaded
preloader.getProgress("https://.../img.jpg"); // { loaded, total } bytes downloaded for a URL, for progress UI
preloader.hasError(0);                      // Check if load failed
preloader.getDims(0);                       // Get { w, h }
preloader.getReadySrc(0);                   // Final src once ready (blob: or original URL); undefined if not ready
preloader.markRendered(0);                  // Mark as currently rendered; exempts its blob URL from cache eviction
preloader.inRange(0);                       // Whether it is within the auto-download range
preloader.getQueue();                       // Current queue & states (pending/downloading/done/error)
await preloader.waitFor(0);                 // Wait for load to complete
preloader.setPriority(3, 0);                // Dynamically raise priority (pin on rapid switching)
preloader.pause(); preloader.resume();      // Pause / resume
preloader.cancel("https://.../img.jpg");    // Cancel a URL
preloader.progressVersion;                  // Download-progress change counter; render beat for the progress ring
preloader.version;                          // Queue-state change counter; drives the seamless thumbnail→blob swap
```

All parameters have defaults, so `useImagePreloader(images)` works directly.

### Concurrent Chunked Preloading

To break the single-connection QoS throttling some CDNs (e.g. Cloudflare anycast IPs) impose on domestic networks, the component splits each full-size image into `concurrency` (default 6) parallel segments via `fetch` + `Range`, merges them into a `Blob`, and renders the `blob:` URL. Measured ~150KB/s on one connection, 600KB/s+ with 6–8 segments.

**Preconditions for chunked concurrency** (otherwise it degrades to full-file download, then native loading — functionality is unaffected):

- Server supports `Range` (returns `Content-Length` and `Accept-Ranges: bytes`);
- The storage domain is **CORS**-configured, allowing cross-origin `fetch` and exposing `Content-Length` / `Accept-Ranges` / `Content-Type`;
- The file is large enough (files `< 256KB` are downloaded whole by default — chunking is not worthwhile);
- The browser supports `fetch` + `Blob` + `URL.createObjectURL` (all modern browsers).

**Behavior notes**:

- **Priority queue**: sorted by distance from the current center image, distance 0 (current) highest; within range "right before left", out-of-range never enqueued.
- **Rapid switching**: consecutive switches (keyboard/button mashing) trigger no downloads; after the user pauses `loadDebounceMs` (default 120ms) the chunked load commits, avoiding bandwidth contention. In-flight downloads are never aborted; old tasks finish then are removed.
- **Bounded task queue**: `maxTasks` (default 5) caps the queue. When full, the tail task is dropped (download aborted, item removed) so the new task wins.
- **Concurrent images**: `maxActiveImages` (default 2) caps how many images download at once, avoiding bandwidth fragmentation.
- **URL-level cache**: each URL downloads once per session; `maxCache` (default 80) revokes the oldest blob URLs, exempting the currently displayed image to avoid white screens.
- **TTFB timeout retry**: `connectRetryMs` (default 1000ms) sets the server-response (TTFB) threshold. If a chunk's response exceeds it (throttled/congested), the chunk is cancelled and re-requested — up to 3 retries per chunk. Disable with `enableConnectRetry={false}`. Combined with the ring progress below, slow sources visibly get re-pulled.
- **Loading progress indicator**: the thumbnail persists as the underlay (no black-flash); a unified ring sits on top — filled to the real `downloadProgress` percentage when the total size is known (`progressKnown`), spinning in the same style when unknown. Both share one visual to avoid abrupt switches.
- **CSP note**: under a strict CSP without the image host in `connect-src`, `fetch` is blocked; the component automatically falls back to native `<img>` loading — images still show, just without the speedup.

> To fully disable it, pass `enableConcurrent={false}` to fall back to native full-image preload; to disable auto-preload, pass `preloadRange={0}` or `preloadRange={[]}`.

#### `useWindowWidth()`

Responsive window width with 150ms debounce.

#### `useLazyVisibleSet(itemCount)`

IntersectionObserver-based lazy loading visible set.

## Performance Optimization Strategy

Multi-layer optimizations for 10K+ image scenarios:

| Layer | Strategy | Effect |
|-------|----------|--------|
| Data | `usePaginatedImages` batch loading | `images.length` starts at 200, grows on demand |
| Swiper | Virtual mode (n > 20) | Only ~10 slide nodes in the DOM |
| React | Incremental cache + visible range replacement | ~11 React Elements created per navigation |
| Thumbnails | Virtualization + relative offset positioning | ~40 thumbnails in DOM, container width constant ~2600px |
| MotionValue | Lazy creation + auto cleanup | Created on demand, auto-reclaimed when far from current index |
| Swiper props | useMemo caching | Prevents re-renders from modules/virtual config changes |

## Dependencies

| Dependency | Version | Notes |
|------------|---------|-------|
| react | ^18 \|\| ^19 | Peer |
| react-dom | ^18 \|\| ^19 | Peer |
| swiper | ^12 | Peer |
| motion | ^11 \|\| ^12 | Peer |
| tailwindcss | ^3 \|\| ^4 | Peer (optional) |

## License

MIT &copy; [lehuan](https://github.com/lehuaner). See [LICENSE](https://github.com/lehuaner/swiper-loop-carousel/blob/master/LICENSE) for details.
