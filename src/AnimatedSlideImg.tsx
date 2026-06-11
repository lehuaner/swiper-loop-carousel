"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback, type MutableRefObject } from "react";
import { motion, useMotionValue, animate } from "motion/react";

interface AnimatedSlideImgProps {
  src: string;
  alt: string;
  isActive: boolean;
  wasActive?: boolean;
  loading: "eager" | "lazy";
  viewModeEpoch?: number;
  viewModeOffsetX?: number;
  entryXFrom?: number;
  entryScaleFrom?: number;
  entryXOffset?: number;
  slideDirectionRef?: MutableRefObject<1 | -1>;
  isExitingOnViewModeChange?: boolean;
  onExitComplete?: () => void;
}

// Swiper 内单张图：
// - 进入视野时 0.25→1 + 飞入（方向由 slideDirection 决定）；
// - 离开视野时 1→0.25 + 飞出；
// - 视图模式变化时：已存在的图用 entryXFrom 作为起点平移+缩放到 0（保证视觉上平滑移动到新位置）；
//   新图通过 isActive 触发的入场动画飞入。
export default function AnimatedSlideImg({
  src,
  alt,
  isActive,
  wasActive: wasActiveProp,
  loading,
  viewModeEpoch = 0,
  viewModeOffsetX = 0,
  entryXFrom,
  entryScaleFrom,
  entryXOffset,
  slideDirectionRef,
  isExitingOnViewModeChange = false,
  onExitComplete,
}: AnimatedSlideImgProps) {
  const entryScale = useMotionValue(1);
  const entryOpacity = useMotionValue(1);
  const entryX = useMotionValue(0);
  // wasActiveProp 由父组件持久化，即使组件因 Swiper loopFix DOM 移动被重新挂载，
  // 也能获得正确的"上一次 isActive"值，避免动画丢失
  const wasActiveRef = useRef(wasActiveProp ?? isActive);
  const isFirstRenderRef = useRef(true);
  const lastViewModeEpochRef = useRef(viewModeEpoch);
  const isCompensatingRef = useRef(false);
  // 补偿期间 isActive 变化时记录，补偿完成后播放对应的入场/退出动画
  const pendingIsActiveRef = useRef(false);
  const isActiveRef = useRef(isActive);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  // 补偿开始时的 wasActive 值，用于补偿完成后判断是否需要播放动画
  const wasActiveBeforeCompensationRef = useRef(wasActiveProp ?? isActive);
  const onExitCompleteRef = useRef(onExitComplete);
  useEffect(() => {
    onExitCompleteRef.current = onExitComplete;
  }, [onExitComplete]);

  const imgRef = useRef<HTMLImageElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgLoadedRef = useRef(false);

  // 检测图片是否已缓存
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      imgLoadedRef.current = true;
      setImgLoaded(true);
    }
  }, []);

  const handleImgLoad = useCallback(() => {
    if (!imgLoadedRef.current) {
      imgLoadedRef.current = true;
      setImgLoaded(true);
    }
  }, []);

  // 统一追踪所有运行中的动画，确保快速切换时能全部取消
  const allAnimRef = useRef<ReturnType<typeof animate>[]>([]);

  // 动画世代：每次新动画序列开始时递增，用于防止旧 Promise 回调干扰新动画
  const animEpochRef = useRef(0);

  const cleanupAllAnims = useCallback(() => {
    allAnimRef.current.forEach((c) => c.stop());
    allAnimRef.current = [];
  }, []);

  // 视图模式变化时：已存在的图片直接设置到补偿起始位置（一镜到底），新图片保持隐藏等入场动画
  // 用 entryScaleFrom/entryXFrom 判断，确保 Swiper 重建导致的组件重新挂载也能正确处理
  // isActiveRef.current 在 useEffect 中更新（paint 后），此时仍为旧值，可用于判断是否为新图片
  useLayoutEffect(() => {
    if (entryScaleFrom != null && entryXFrom != null) {
      cleanupAllAnims();
      animEpochRef.current++;
      if (isActive && !isActiveRef.current) {
        // 新图片：保持隐藏，等补偿动画或入场动画处理
        entryOpacity.set(0);
      } else {
        // 已存在或退出的图片：设置到旧位置，实现一镜到底
        entryScale.set(entryScaleFrom);
        entryX.set(entryXFrom);
        entryOpacity.set(1);
      }
    }
    // isActive 读取当前渲染的 prop 值（新值），isActiveRef.current 是旧值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewModeEpoch, entryScaleFrom, entryXFrom, entryOpacity, cleanupAllAnims, entryScale, entryX]);

  // 补偿动画完成后，如果有 pending 的 isActive 变化，播放对应动画
  const playPendingAnimation = useCallback(() => {
    const wasActiveBefore = wasActiveBeforeCompensationRef.current;
    const targetActive = isActiveRef.current;
    wasActiveRef.current = targetActive;

    if (targetActive && !wasActiveBefore) {
      // 入场动画
      const currentEpoch = ++animEpochRef.current;
      cleanupAllAnims();
      entryScale.set(0.25);
      entryOpacity.set(0);
      const targetX = 0;
      const offset = 60;
      const dir = slideDirectionRef?.current ?? 1;
      entryX.set(targetX + offset * dir);
      allAnimRef.current = [
        animate(entryScale, 1, { duration: 0.4, ease: "easeOut" }),
        animate(entryOpacity, 1, { duration: 0.4, ease: "easeOut" }),
        animate(entryX, targetX, { duration: 0.4, ease: "easeOut" }),
      ];
      void currentEpoch;
    } else if (!targetActive && wasActiveBefore) {
      // 退出动画
      const currentEpoch = ++animEpochRef.current;
      cleanupAllAnims();
      entryScale.set(1);
      entryOpacity.set(1);
      const anims = [
        animate(entryScale, 0.25, { duration: 0.4, ease: "easeOut" }),
        animate(entryOpacity, 0, { duration: 0.4, ease: "easeOut" }),
      ];
      allAnimRef.current = anims;
      Promise.all(anims).then(() => {
        if (animEpochRef.current !== currentEpoch) return;
        if (wasActiveRef.current) return;
        entryScale.set(1);
        entryOpacity.set(1);
        entryX.set(0);
        onExitCompleteRef.current?.();
      });
    } else {
      // isActive 没有实际变化，重置到默认状态
      entryScale.set(1);
      entryOpacity.set(1);
      entryX.set(0);
    }
  }, [cleanupAllAnims, entryScale, entryOpacity, entryX, slideDirectionRef]);

  // 补偿动画
  useEffect(() => {
    lastViewModeEpochRef.current = viewModeEpoch;
    if (entryScaleFrom != null && entryXFrom != null) {
      isFirstRenderRef.current = false;
      isCompensatingRef.current = true;
      wasActiveBeforeCompensationRef.current = wasActiveRef.current;
      pendingIsActiveRef.current = false;
      const currentEpoch = ++animEpochRef.current;
      // Swiper 已在父组件 useLayoutEffect 中同步更新，slide 宽度已正确
      entryScale.set(entryScaleFrom);
      entryX.set(entryXFrom);
      entryOpacity.set(1);
      if (isExitingOnViewModeChange) {
        // 退出图片：始终向右退出，不受切换方向影响
        const exitOffset = entryXOffset ?? 60;
        const exitTargetX = entryXFrom + exitOffset;
        const anims = [
          animate(entryScale, 0.25, { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }),
          animate(entryOpacity, 0, { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }),
          animate(entryX, exitTargetX, { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }),
        ];
        allAnimRef.current = anims;
        Promise.all(anims).then(() => {
          if (animEpochRef.current !== currentEpoch) return;
          isCompensatingRef.current = false;
          // 补偿退出动画已完成，同步 wasActiveRef 避免重复播放退出动画
          wasActiveRef.current = isActiveRef.current;
          pendingIsActiveRef.current = false;
          entryScale.set(1);
          entryOpacity.set(1);
          entryX.set(0);
          onExitCompleteRef.current?.();
        });
      } else {
        // 保留图片：从旧位置旧大小平移+缩放到新位置新大小
        const anims = [
          animate(entryScale, 1, { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }),
          animate(entryX, viewModeOffsetX, { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }),
          animate(entryOpacity, 1, { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }),
        ];
        allAnimRef.current = anims;
        Promise.all(anims).then(() => {
          if (animEpochRef.current !== currentEpoch) return;
          isCompensatingRef.current = false;
          // 补偿移动动画已完成，同步 wasActiveRef 避免重复播放动画
          wasActiveRef.current = isActiveRef.current;
          pendingIsActiveRef.current = false;
        });
      }
    }
  }, [viewModeOffsetX, viewModeEpoch, entryXFrom, entryScaleFrom, isExitingOnViewModeChange, entryXOffset, slideDirectionRef, entryX, entryScale, entryOpacity]);

  // 入场 / 出场动画（退出动画直接内联，无需 exitFixed 状态，省 2 次渲染）
  useEffect(() => {
    const wasActive = wasActiveRef.current;

    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      // wasActiveProp == null 表示首次挂载（overlay 刚打开），跳过动画
      // wasActiveProp != null 表示 Swiper loopFix 导致的重新挂载，需要检查是否需要动画
      if (wasActiveProp == null) {
        wasActiveRef.current = isActive;
        return;
      }
      // 重新挂载：wasActiveRef 已从 wasActiveProp 正确初始化，不覆盖，继续执行动画逻辑
    }

    // 如果正在补偿动画中，记录 isActive 变化，补偿完成后播放动画
    if (isCompensatingRef.current) {
      if (wasActive !== isActive) {
        pendingIsActiveRef.current = true;
      }
      return;
    }

    wasActiveRef.current = isActive;

    if (isActive && !wasActive) {
      const currentEpoch = ++animEpochRef.current;
      // 入场动画：清理任何仍在运行的动画
      cleanupAllAnims();
      entryScale.set(0.25);
      entryOpacity.set(0);
      const targetX = viewModeOffsetX;
      const offset = entryXOffset ?? 60;
      // slideDirectionRef: 1 = 从右侧飞入（向左切换），-1 = 从左侧飞入（向右切换）
      const dir = slideDirectionRef?.current ?? 1;
      entryX.set(targetX + offset * dir);
      allAnimRef.current = [
        animate(entryScale, 1, { duration: 0.4, ease: "easeOut" }),
        animate(entryOpacity, 1, { duration: 0.4, ease: "easeOut" }),
        animate(entryX, targetX, { duration: 0.4, ease: "easeOut" }),
      ];
      // 入场动画无回调，但递增 epoch 可使旧回调失效
      void currentEpoch;
    } else if (!isActive && wasActive) {
      // 退出动画：直接启动，无需 exitFixed 中间状态
      const currentEpoch = ++animEpochRef.current;
      cleanupAllAnims();
      entryScale.set(1);
      entryOpacity.set(1);

      const anims = [
        animate(entryScale, 0.25, { duration: 0.4, ease: "easeOut" }),
        animate(entryOpacity, 0, { duration: 0.4, ease: "easeOut" }),
      ];
      allAnimRef.current = anims;

      Promise.all(anims).then(() => {
        if (animEpochRef.current !== currentEpoch) return;
        if (wasActiveRef.current) return;
        entryScale.set(1);
        entryOpacity.set(1);
        entryX.set(0);
        onExitCompleteRef.current?.();
      });
    }
  }, [isActive, viewModeOffsetX, entryXOffset, slideDirectionRef, entryScale, entryOpacity, entryX, cleanupAllAnims]);

  return (
    <motion.div
      style={{
        scale: entryScale,
        opacity: entryOpacity,
        x: entryX,
      }}
      className="relative flex h-full w-full items-center justify-center"
    >
      {!imgLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <svg className="h-8 w-8 animate-spin text-white/40" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        decoding="async"
        loading={loading}
        onLoad={handleImgLoad}
        onClick={(e) => e.stopPropagation()}
        style={{
          opacity: imgLoaded ? 1 : 0,
          transition: "opacity 0.2s ease-in",
        }}
        className="max-h-full max-w-full select-none object-contain cursor-grab active:cursor-grabbing"
      />
    </motion.div>
  );
}
