"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

// ── i18n 键类型 ──

export type CarouselI18nKey =
  | "title"
  | "desc"
  | "hint"
  | "hintZoomDesktop"
  | "hintZoomMobile"
  | "viewMode1"
  | "viewMode2"
  | "viewMode3"
  | "close"
  | "dialogLabel"
  | "prev"
  | "next"
  | "densityFew"
  | "densityMed"
  | "densityMore"
  | "viewModeGroup"
  | "densityGroup"
  | "wheelGroup"
  | "wheelZoom"
  | "wheelSwitch";

export type CarouselI18nStrings = Record<CarouselI18nKey, string>;

// ── 默认翻译 ──

const defaultZh: CarouselI18nStrings = {
  title: "Swiper 连续轮播 · 缩略图导航",
  desc: "基于 Swiper Virtual + Loop 实现无限循环轮播，支持缩略图拖拽导航、键盘长按快速预览、滚轮/双指缩放、多视图模式切换。",
  hint: "← → 切换、长按快速预览 · 点击缩略图跳转 · 拖动缩略图条滑动 · 点击空白处退出",
  hintZoomDesktop: "滚轮缩放图片 · 拖动平移",
  hintZoomMobile: "双指缩放 · 单指平移",
  viewMode1: "单图",
  viewMode2: "双图",
  viewMode3: "三图",
  close: "关闭",
  dialogLabel: "图片预览",
  prev: "上一张",
  next: "下一张",
  densityFew: "少",
  densityMed: "中",
  densityMore: "多",
  viewModeGroup: "视图模式",
  densityGroup: "缩略图数量",
  wheelGroup: "滚轮功能",
  wheelZoom: "缩放",
  wheelSwitch: "切换",
};

const defaultEn: CarouselI18nStrings = {
  title: "Swiper Loop Carousel · Thumbnail Nav",
  desc: "Infinite loop carousel based on Swiper Virtual + Loop. Supports thumbnail drag navigation, keyboard long-press fast preview, scroll/pinch zoom, and multi-view mode switching.",
  hint: "← → to switch, hold for fast preview · Click thumbnails to jump · Drag strip to slide · Click empty area to exit",
  hintZoomDesktop: "Scroll to zoom image · Drag to pan",
  hintZoomMobile: "Pinch to zoom · Drag to pan",
  viewMode1: "1 PIC",
  viewMode2: "2 PIC",
  viewMode3: "3 PIC",
  close: "Close",
  dialogLabel: "Image preview",
  prev: "Previous",
  next: "Next",
  densityFew: "Few",
  densityMed: "Med",
  densityMore: "More",
  viewModeGroup: "View mode",
  densityGroup: "Thumbnail density",
  wheelGroup: "Wheel",
  wheelZoom: "Zoom",
  wheelSwitch: "Switch",
};

// ── Context ──

const CarouselI18nContext = createContext<CarouselI18nStrings>(defaultZh);
const CarouselLangContext = createContext<CarouselI18nLang>("zh");

// ── Provider ──

export type CarouselI18nLang = "zh" | "en";

export interface CarouselI18nProviderProps {
  lang?: CarouselI18nLang;
  overrides?: Partial<CarouselI18nStrings>;
  children: ReactNode;
}

const defaults: Record<CarouselI18nLang, CarouselI18nStrings> = {
  zh: defaultZh,
  en: defaultEn,
};

export function CarouselI18nProvider({ lang = "zh", overrides, children }: CarouselI18nProviderProps) {
  const value = useMemo<CarouselI18nStrings>(() => {
    const base = defaults[lang] ?? defaultZh;
    return overrides ? { ...base, ...overrides } : base;
  }, [lang, overrides]);
  return (
    <CarouselLangContext.Provider value={lang}>
      <CarouselI18nContext.Provider value={value}>
        {children}
      </CarouselI18nContext.Provider>
    </CarouselLangContext.Provider>
  );
}

// ── Hooks ──

export function useCarouselI18n(): CarouselI18nStrings {
  return useContext(CarouselI18nContext);
}

export function useCarouselLang(): CarouselI18nLang {
  return useContext(CarouselLangContext);
}
