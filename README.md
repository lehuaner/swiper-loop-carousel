# @lehuan/swiper-loop-carousel

<p align="center">
  <a href="https://www.npmjs.com/package/@lehuan/swiper-loop-carousel"><img src="https://img.shields.io/npm/v/@lehuan/swiper-loop-carousel?style=flat-square&logo=npm" alt="npm version" /></a>
  <a href="https://github.com/lehuaner/swiper-loop-carousel"><img src="https://img.shields.io/github/stars/lehuaner/swiper-loop-carousel?style=flat-square&logo=github" alt="GitHub stars" /></a>
  <a href="https://github.com/lehuaner/swiper-loop-carousel/blob/master/LICENSE"><img src="https://img.shields.io/npm/l/@lehuan/swiper-loop-carousel?style=flat-square" alt="License" /></a>
  <a href="https://www.npmjs.com/package/@lehuan/swiper-loop-carousel"><img src="https://img.shields.io/npm/dm/@lehuan/swiper-loop-carousel?style=flat-square" alt="npm downloads" /></a>
  <img src="https://img.shields.io/badge/react-18%20%7C%2019-61DAFB?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/swiper-%5E12-6332F6?style=flat-square&logo=swiper" alt="Swiper" />
</p>

基于 Swiper 的无限循环轮播组件，支持缩略图拖拽导航、键盘长按快速预览、滚轮/双指缩放、多视图模式切换。

针对万级图片量做了深度性能优化：Swiper Virtual 虚拟化、缩略图条虚拟化、增量缓存、内存自动回收。

- [GitHub 仓库](https://github.com/lehuaner/swiper-loop-carousel)
- [NPM 包](https://www.npmjs.com/package/@lehuan/swiper-loop-carousel)
- [English Docs](./README.en.md)

## 特性

- **无限循环** - 基于 Swiper Loop，首尾无缝衔接
- **缩略图条** - 拖拽导航、键盘长按三级加速、密度可调
- **多视图模式** - 单图 / 双图 / 三图，切换时一镜到底动画
- **缩放** - 滚轮缩放 + 双指缩放 + 拖动平移
- **万级图片** - Swiper Virtual + 缩略图虚拟化 + 增量缓存 + 内存回收
- **分页加载** - 内置 `usePaginatedImages` hook，滑动到末尾自动加载
- **国际化** - 内置中/英文，支持自定义覆盖
- **受控/非受控** - 两种打开模式，灵活集成

## 安装

```bash
npm install @lehuan/swiper-loop-carousel swiper motion
```

## Tailwind CSS 配置

**必须配置**：本组件使用 Tailwind CSS utility class 实现样式，需要让消费者项目的 Tailwind 扫描到本包的编译产物。

### Tailwind v3

在 `tailwind.config.js` 的 `content` 中追加包的路径：

```js
module.exports = {
  content: [
    "./src/**/*.{ts,tsx}",
    "./node_modules/@lehuan/swiper-loop-carousel/dist/**/*.{js,cjs}",
  ],
}
```

### Tailwind v4

在入口 CSS 文件中添加 `@source` 指令：

```css
@import "tailwindcss";
@source "../node_modules/@lehuan/swiper-loop-carousel/";
```

### 为什么需要这一步？

本组件所有样式都通过 Tailwind utility class（如 `bg-black/90`、`text-white`、`rounded-xl` 等）实现。这些 class name 在编译产物（`dist/*.{js,cjs}`）中仍然是字符串字面量，Tailwind 的 content 扫描器可以解析它们并生成对应的 CSS。因此无需从包中额外导入 CSS 文件，也不会与项目的 Tailwind 配置冲突。

## 快速开始

### 基础用法（非受控模式）

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

### 受控模式

```tsx
function Gallery() {
  const [isOpen, setIsOpen] = useState(false);
  const [idx, setIdx] = useState(0);

  return (
    <>
      <button onClick={() => { setIdx(0); setIsOpen(true); }}>打开轮播</button>
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

### 万级图片 + 分页加载

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
      <button onClick={() => { setIdx(0); setIsOpen(true); }}>打开</button>
      <SwiperLoopCarousel
        images={images}
        onNeedMore={loadMore}
        hasMore={hasMore}
        total={total}           // 覆盖层显示 "3/10000" 而非 "3/200"
        isOpen={isOpen}
        initialIndex={idx}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
```

### 国际化

```tsx
import { CarouselI18nProvider } from "@lehuan/swiper-loop-carousel";

<CarouselI18nProvider lang="en">
  <SwiperLoopCarousel images={images} />
</CarouselI18nProvider>

// 自定义覆盖
<CarouselI18nProvider lang="zh" overrides={{ close: "返回", prev: "上一页" }}>
  <SwiperLoopCarousel images={images} />
</CarouselI18nProvider>
```

## API

### SwiperLoopCarousel Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `images` | `GalleryImage[]` | **必填** | 图片数据数组 |
| `isOpen` | `boolean` | `undefined` | 受控模式：是否打开。`undefined` 时使用内部非受控状态 |
| `initialIndex` | `number` | `0` | 受控模式：打开时定位到第几张图片 |
| `onClose` | `() => void` | - | 受控模式：关闭回调 |
| `total` | `number` | `images.length` | 图片总数（含未加载），用于覆盖层显示 "3/10000" |
| `onNeedMore` | `() => void` | - | 分页加载：滑动到接近末尾时触发 |
| `hasMore` | `boolean` | `false` | 是否还有更多图片可加载 |
| `renderOverlay` | `(props) => ReactNode` | - | 自定义覆盖层，替换默认的序号/alt/尺寸信息 |
| `renderToolbar` | `(props) => ReactNode` | - | 自定义工具栏，整体替换默认工具栏 |
| `extraToolbarItems` | `ReactNode` | - | 追加到默认工具栏右侧的额外内容 |
| `extraOverlayContent` | `(props) => ReactNode` | - | 追加到覆盖层区域的额外内容 |
| `onDownload` | `(index: number) => void` | - | 下载回调，传入后覆盖层显示下载按钮 |

### GalleryImage

```ts
interface GalleryImage {
  id: number;
  src: string;        // 原图 URL
  thumbSrc: string;   // 缩略图 URL
  alt: string;        // 图片描述
  width?: number;     // 原始宽度（覆盖层显示）
  height?: number;    // 原始高度（覆盖层显示）
  fileSize?: number;  // 文件大小字节数（覆盖层显示）
  sizeLabel?: string; // 自定义文件大小文本，优先于 fileSize
  dimensions?: string;// 自定义尺寸文本，优先于 width×height
}
```

### Hooks

#### `usePaginatedImages(allImages, pageSize?)`

分页加载图片数据，避免一次性处理过多数据。

```ts
const { images, loadMore, hasMore, total, loaded } = usePaginatedImages(allImages, 200);
```

| 返回值 | 类型 | 说明 |
|--------|------|------|
| `images` | `GalleryImage[]` | 当前已加载的图片切片 |
| `loadMore` | `() => void` | 加载下一批 |
| `hasMore` | `boolean` | 是否还有更多 |
| `total` | `number` | 全量图片总数 |
| `loaded` | `number` | 已加载数量 |

#### `useImagePreloader(images)`

图片预加载，获取原始尺寸。

```ts
const preloader = useImagePreloader(images);
preloader.preload([0, 1, 2]);        // 预加载指定索引
preloader.preloadAround(5);           // 预加载中心 ±3
preloader.isLoaded(0);                // 是否已加载
preloader.getDims(0);                 // 获取 { w, h }
await preloader.waitFor(0);           // 等待加载完成
```

#### `useWindowWidth()`

响应式窗口宽度，150ms 防抖。

#### `useLazyVisibleSet(itemCount)`

基于 IntersectionObserver 的懒加载可见集合。

## 性能优化策略

万级图片场景下的多层优化：

| 层级 | 策略 | 效果 |
|------|------|------|
| 数据层 | `usePaginatedImages` 分页加载 | `images.length` 从 200 起步，按需增长 |
| Swiper 层 | Virtual 模式 (n > 20) | DOM 中只有 ~10 个 slide 节点 |
| React 层 | 增量缓存 + 可见范围替换 | 每次切图只创建 ~11 个 React Element |
| 缩略图层 | 虚拟化 + 相对偏移定位 | DOM 中 ~40 个缩略图，容器宽度恒定 ~2600px |
| MotionValue | 懒创建 + 自动回收 | 按需创建，远离当前索引的自动清理 |
| Swiper props | useMemo 缓存 | 避免 modules/virtual 配置变化触发重渲染 |

## 依赖

| 依赖 | 版本 | 说明 |
|------|------|------|
| react | ^18 \|\| ^19 | Peer |
| react-dom | ^18 \|\| ^19 | Peer |
| swiper | ^12 | Peer |
| motion | ^11 \|\| ^12 | Peer |
| tailwindcss | ^3 \|\| ^4 | Peer (可选) |

## License

MIT &copy; [lehuan](https://github.com/lehuaner). See [LICENSE](https://github.com/lehuaner/swiper-loop-carousel/blob/master/LICENSE) for details.
