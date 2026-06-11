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

## Features

- **Infinite Loop** - Seamless head-to-tail transition via Swiper Loop
- **Thumbnail Strip** - Drag navigation, 3-tier keyboard long-press acceleration, adjustable density
- **Multi-View Modes** - Single/Dual/Triple image layouts with continuous camera-like transitions
- **Zoom** - Scroll wheel zoom, pinch-to-zoom on mobile, drag to pan
- **10K+ Images** - Swiper Virtual mode, thumbnail virtualization, incremental caching, memory auto-reclaim
- **Paginated Loading** - Built-in `usePaginatedImages` hook, auto-loads on scroll near end
- **Internationalization** - Built-in Chinese/English, supports custom overrides
- **Controlled/Uncontrolled** - Both open modes for flexible integration

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

#### `useImagePreloader(images)`

Preload images and obtain their original dimensions.

```ts
const preloader = useImagePreloader(images);
preloader.preload([0, 1, 2]);        // Preload specific indices
preloader.preloadAround(5);           // Preload center ±3
preloader.isLoaded(0);                // Check if loaded
preloader.getDims(0);                 // Get { w, h }
await preloader.waitFor(0);           // Wait for load to complete
```

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
