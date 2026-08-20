"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback, type MutableRefObject } from "react";
import { motion, useMotionValue, animate, useTransform } from "motion/react";

// 进度环：viewBox 48，圆半径 20 → 周长 2π·20 ≈ 125.66
const CIRCUMFERENCE = 2 * Math.PI * 20;
const clampPct = (v: number) => Math.max(0, Math.min(100, v));

interface AnimatedSlideImgProps {
  src: string;
  alt: string;
  /** 底层兜底图（缩略图）。原图就绪前常驻显示，避免 src 切换时的黑屏闪烁 */
  underlaySrc?: string;
  isActive: boolean;
  wasActive?: boolean;
  loading: "eager" | "lazy";
  viewModeEpoch?: number;
  /** 删除动作递增：删除发生时递增，作为"右幸存图左移补位"的触发信号（与第一张飞出同一时刻启动）。 */
  deleteEpoch?: number;
  /** 仅当位于被删图右侧、仍活跃的幸存图（重排前）时为 true：驱动它左移一格补位，与飞出同步。 */
  deleteShiftActive?: boolean;
  /** 重排后装到新槽位的右幸存图（按图标识记）：对象已在删除窗口内完成左移补位，须静置到位，
   *  不再重放进场/补位动画，避免"闪一下再位移"。 */
  deleteFillTarget?: boolean;
  /** 父级记录的该图"删除静置归位"时刻（performance.now，ms）。跨重挂载稳定：
   *  删除重排/复位会让组件多次重挂载，本地 ref 会随挂载重置，父级时间戳能持续
   *  抑制复位产生的异步 isActive 抖动导致的二次入场（"到位后又闪一下入场"）。 */
  deleteFillSettledAt?: number;
  /** 删除窗口内、从右侧进入新末位的下一张图：做标准"切换入场"（缩放+淡入+飞入左移一格），
   *  与幸存图的左移补位、第一张飞出三者同一帧同步。 */
  deleteEntryTarget?: boolean;
  /** 删除补位的水平平移量（px，一格槽距）。 */
  deleteTranslateX?: number;
  /** 源码级删除共享平移：被删图右侧"整段"图统一读取该 motion 值，随它平滑左移一格补位；
   *  左侧图不绑定（不传 / undefined）→ 原地不动。动画只对这一个共享值发生，多卡由同一动画源
   *  驱动、零逐卡失步，观感等同"下一张"wrapper 平移。 */
  groupShiftX?: import("motion/react").MotionValue<number>;
  /** 本卡的缩放/拖拽外层变换 scale motion 值（等效 motionsNow.scale）。
   *  组内共享 groupShiftX 是被"right 幸存图整段"共用的屏幕位移（一格），而它施加在本卡内层
   *  （被外层 scale 缩放的坐标系里），视觉位移会被乘以外层 scale。缩放≠1（被缩放/拖拽）的幸存图
   *  删除补位时平移更快/更远，与左侧未缩放图失步。传入本卡的 scale 后，共享位移改为
   *  groupShiftX ÷ scale，使屏幕位移恒定为一格、与缩放无关（未缩放卡 scale=1 不受影响）。 */
  groupShiftScaleX?: import("motion/react").MotionValue<number>;
  viewModeOffsetX?: number;
  entryXFrom?: number;
  entryScaleFrom?: number;
  entryXOffset?: number;
  slideDirectionRef?: MutableRefObject<1 | -1>;
  isExitingOnViewModeChange?: boolean;
  onExitComplete?: () => void;
  /** 显式指定是否显示加载转圈。传入时优先于内部的 imgLoaded 判定；
   * 由 Carousel 驱动"当前目标图原图是否就绪"，避免缓存/下载时机导致的转圈时有时无 */
  showSpinner?: boolean;
  /** 当前原图下载进度百分比 0-100；progressKnown 为 true 时显示为圆环进度条而非转圈 */
  downloadProgress?: number;
  /** 是否已知道文件总大小（能计算真实百分比）。未知时进度环回退为旋转转圈 */
  progressKnown?: boolean;
  /** 外部共享的水平位移 motion value（与顶部名称/功能按钮栏共用，使二者在删除补位时同步平移）。
   *  不传时在组件内部创建，行为与原来一致。 */
  entryX?: import("motion/react").MotionValue<number>;
  /** 原图是否已在 preloader 中就绪（displaySrc 就是原图）。为 true 时新实例直接以原图显示、
   *  跳过底层缩略图的加载淡入——删除重排后重挂载的幸存图原图已就绪，避免平移到位瞬间闪现缩略图。 */
  originalReady?: boolean;
  /** 该图的缩略图 key（通常为 img.thumbSrc）。原图未就绪时主 <img> 内容即为缩略图，
   *  其加载完成（含缓存命中）与底层缩略图 <img> 加载完成都会触发 onThumbLoaded(key)。
   *  父组件据此判断"切换动画期间缩略图已就位 → 用缩略图兜底、不再叠加转圈"。 */
  thumbKey?: string;
  /** 缩略图实际加载完成回调（原始缩略图就位时刻，非原图）。幂等：同一 key 多次触发无副作用。 */
  onThumbLoaded?: (thumbKey: string) => void;
}

// Swiper 内单张图：
// - 进入视野时 0.25→1 + 飞入（方向由 slideDirection 决定）；
// - 离开视野时 1→0.25 + 飞出；
// - 视图模式变化时：已存在的图用 entryXFrom 作为起点平移+缩放到 0（保证视觉上平滑移动到新位置）；
//   新图通过 isActive 触发的入场动画飞入。
export default function AnimatedSlideImg({
  src,
  alt,
  underlaySrc,
  isActive,
  wasActive: wasActiveProp,
  loading,
  viewModeEpoch = 0,
  deleteEpoch = 0,
  deleteShiftActive = false,
  deleteFillTarget = false,
  deleteFillSettledAt,
  deleteEntryTarget = false,
  deleteTranslateX,
  groupShiftX,
  groupShiftScaleX,
  viewModeOffsetX = 0,
  entryXFrom,
  entryScaleFrom,
  entryXOffset,
  slideDirectionRef,
  isExitingOnViewModeChange = false,
  onExitComplete,
  showSpinner,
  downloadProgress = 0,
  progressKnown = false,
  entryX: entryXProp,
  originalReady = false,
  thumbKey,
  onThumbLoaded,
}: AnimatedSlideImgProps) {
  const entryScale = useMotionValue(1);
  const entryOpacity = useMotionValue(1);
  const internalEntryX = useMotionValue(0);
  // 外部共享水平位移：直接复用父组件传入的 motion value（与名称/功能按钮栏同源），
  // 仅在未传入时使用内部创建值，保证"不传则行为不变"。
  const entryX = entryXProp ?? internalEntryX;
  // 源码级共享平移合成：删除动画只发生在共享 groupShiftX 这一个 motion 值上（右侧整段一次平滑左移一格），
  // 这里把它与自身 entryX 叠加为最终水平位移。左侧卡不传 groupShiftX → combinedX 恒等于 entryX，行为不变。
  const combinedX = useTransform(() => {
    const shift = groupShiftX?.get() ?? 0;
    // 共享删除补位位移在本卡内层（被外层 scale 缩放），为保持屏幕位移恒定为一格，
    // 用本卡外层 scale 反推：shift ÷ scale。scale≤0 时退化原值（异常保护）。
    const sc = groupShiftScaleX?.get() ?? 1;
    const scale = sc > 0.05 ? sc : 1;
    return entryX.get() + shift / scale;
  });
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

  // 该卡最近一次"删除静置归位"的时刻（见 effect-silent）。删除后 loop 复位异步拨动 realIndex 会让
  // 幸存卡 isActive 闪断再激活；在此窗口内抑制二次入场，避免"先缩小再进入"。
  // 优先使用父级传入的 deleteFillSettledAt（跨重挂载稳定），本地 ref 仅作兜底。
  const deleteSettledAtRef = useRef(-1);
  // 删除静置后再放二次入场的抑制窗口（ms）。足够覆盖 loop 复位产生的异步 realIndex 波动，又远小于
  // 一次真实导航所需时间，因此不会误伤删除后及时进行的正常切换。
  // 该窗口须覆盖"重排(460) + Swiper 复位(500) + 复位抑制(500) + rAF 连锁拨动余量"之后的
  // 残留 isActive 抖动。快速连续删除时主线程繁忙，复位延迟事件可能更晚到达。
  const DELETE_SETTLE_SUPPRESS_MS = 2000;
  // 已为该次删除(deleteEpoch)执行过"左移补位"：避免同窗口内 re-render 重复触发补位
  const deleteShiftEpochRef = useRef(0);
  // 同上，但专用于"下一张入场"：与左移补位各自独立去重，
  // 避免同一 deleteEpoch 下补位与入场互相把对方的回执标记写掉而吞掉动画。
  const deleteEntryEpochRef = useRef(0);

  const imgRef = useRef<HTMLImageElement>(null);
  const [imgLoaded, setImgLoaded] = useState(() => originalReady === true);
  const imgLoadedRef = useRef(originalReady === true);

  // 通知父级"缩略图已就位"：幂等（父级用 Set 去重），触发时机=底层缩略图加载完成 / 主图是缩略图时的加载完成。
  const notifyThumbLoaded = useCallback(() => {
    if (thumbKey) onThumbLoaded?.(thumbKey);
  }, [thumbKey, onThumbLoaded]);

  const handleImgLoad = useCallback(() => {
    if (!imgLoadedRef.current) {
      imgLoadedRef.current = true;
      setImgLoaded(true);
    }
    // 主 <img> 当前内容若是缩略图（原图未就绪时 displaySrc===thumbSrc），加载完成即缩略图就位；
    // 已是原图时缩略图必然经 underlay/缓存路径通知过，此处通知幂等、安全。
    if (src === underlaySrc) notifyThumbLoaded();
  }, [src, underlaySrc, notifyThumbLoaded]);

  // 检测图片是否已缓存
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      imgLoadedRef.current = true;
      setImgLoaded(true);
      // 主 <img> 当前内容若是缩略图（原图未就绪时 displaySrc===thumbSrc），缓存命中即缩略图就位
      if (src === underlaySrc) notifyThumbLoaded();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // src 变化（如缩略图 → 分块完成的 blob URL）时重置加载态，避免旧图残留闪烁
  const prevSrcRef = useRef(src);
  useEffect(() => {
    if (prevSrcRef.current !== src) {
      prevSrcRef.current = src;
      imgLoadedRef.current = false;
      setImgLoaded(false);
      // src 换成已在缓存中的原图（关闭分块时是原生 URL、开启时是 blob）时，
      // load 事件可能在 React 重新绑定 onLoad 前就已同步触发而丢失，
      // 导致 imgLoaded 永远为 false、原图停在 opacity:0，视觉上“被缩略图盖住”。
      // 此处用 complete/naturalWidth 立即补偿判定缓存命中。
      const img = imgRef.current;
      if (img && img.complete && img.naturalWidth > 0) {
        imgLoadedRef.current = true;
        setImgLoaded(true);
        if (src === underlaySrc) notifyThumbLoaded();
      }
    }
  }, [src, underlaySrc, notifyThumbLoaded]);

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

  // 删除/索引重排导致组件以"应播放入场动画"的状态首次挂载时，起止值必须在 paint 前写入，
  // 否则首帧会以 entryX=0/scale=1（最终态）渲染一次，表现为"先到位再回退补位"的跳变闪烁；
  // 新补位的右侧图也因此看不见切换那套"缩放+淡入+飞入"。判定：isFirstRender 且 wasActiveProp
  // 非空（说明是重挂载而非首次打开 overlay，首次打开时 wasActiveProp 为 undefined 且不应播动画）。
  useLayoutEffect(() => {
    if (!isFirstRenderRef.current) return;
    if (wasActiveProp == null || !isActive) {
      return;
    }
    const targetX = viewModeOffsetX;
    if (deleteFillTarget) {
      // 删除重排后装到新槽位的右幸存图：对象已在删除窗口内完成左移补位，直接静置原位
      entryScale.set(1);
      entryOpacity.set(1);
      entryX.set(targetX);
      return;
    }
    if (wasActiveProp) {
      // 仍活跃的非删除补位重挂载卡：保持原位
      entryScale.set(1);
      entryOpacity.set(1);
      entryX.set(targetX);
      return;
    }
    // 新进场图：缩放+淡入+飞入，与切换"下一张"的入场完全一致
    entryScale.set(0.25);
    entryOpacity.set(0);
    const offset = entryXOffset ?? 60;
    const dir = slideDirectionRef?.current ?? 1;
    entryX.set(targetX + offset * dir);
  }, [wasActiveProp, isActive, deleteFillTarget, deleteTranslateX, viewModeOffsetX, entryXOffset, slideDirectionRef, entryScale, entryOpacity, entryX]);

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

    // 删除窗口内（重排前）已触发过左移补位或即将静置的右幸存图：直接静置
    if (deleteFillTarget) {
      wasActiveRef.current = isActive;
      // 优先采用父级跨重挂载稳定的静置时刻；无父级时间戳时退回本地挂载时刻
      deleteSettledAtRef.current = deleteFillSettledAt ?? performance.now();
      return;
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
      // 删除后 loop 复位的异步 slideChange 会让"刚经删除静置归位"的幸存卡 isActive 闪断再激活：
      // 若在此窗口内发生，属于复位抖动而非真实入场，直接静置跳过，杜绝"先缩小再进入"的二次动画。
      // 不能把 deleteSettledAtRef 重置为 -1：loopFix/slideToLoop 会连锁触发多次 slideChange，
      // 一次性抑制只能挡住第一次抖动，后续抖动会逃过抑制、重放入场动画（"到位后又闪一下"）。
      // 优先用父级跨重挂载稳定的静置时刻，本地 ref 仅作兜底。
      const settleTs = deleteFillSettledAt ?? deleteSettledAtRef.current;
      if (settleTs >= 0) {
        if (performance.now() - settleTs < DELETE_SETTLE_SUPPRESS_MS) {
          wasActiveRef.current = isActive;
          return;
        }
        deleteSettledAtRef.current = -1;
      }
      const currentEpoch = ++animEpochRef.current;
      // 入场动画：清理任何仍在运行的动画
      cleanupAllAnims();
      const targetX = viewModeOffsetX;
      // 正常切换入场：缩放 + 淡入 + 侧面飞入（删除补位已由删除窗口内的左移实现，不在此路径）
      entryScale.set(0.25);
      entryOpacity.set(0);
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
      // 删除后复位抖动会让"刚经删除静置归位"的幸存卡 isActive 短暂闪断为 false：
      // 若在此窗口内去激活，属于复位抖动而非真实离开，直接静置跳过，杜绝"平移到位后缩小移出"。
      // 与入场分支同理，保留时间戳以覆盖窗口内多次抖动。
      const settleTs = deleteFillSettledAt ?? deleteSettledAtRef.current;
      if (settleTs >= 0) {
        if (performance.now() - settleTs < DELETE_SETTLE_SUPPRESS_MS) {
          wasActiveRef.current = isActive;
          return;
        }
        deleteSettledAtRef.current = -1;
      }
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
  }, [isActive, viewModeOffsetX, entryXOffset, slideDirectionRef, entryScale, entryOpacity, entryX, cleanupAllAnims, deleteFillTarget, deleteFillSettledAt, deleteTranslateX]);

  // 删除窗口（重排前）：被删图右侧、仍活跃的幸存图左移一格补位（纯水平平移、无缩放无淡入）。
  // 完整沿用"切换下一张"时同位置（保持活跃的幸存图）随容器左移一格的动画，不自创缩放/淡入/飞入；
  // 与第一张飞出同一帧启动，观感与"切换下一张"的连续平移一致。
  useEffect(() => {
    if (!deleteShiftActive || !isActive) return;
    // isFirstRenderRef 为 true 说明是首次打开 overlay（非删除场景），不触发
    if (isFirstRenderRef.current) return;
    const shift = deleteTranslateX ?? 0;
    if (!(shift > 0)) return;
    if (deleteShiftEpochRef.current === deleteEpoch) return;
    deleteShiftEpochRef.current = deleteEpoch;
    const currentEpoch = ++animEpochRef.current;
    cleanupAllAnims();
    entryScale.set(1);
    entryOpacity.set(1);
    const targetX = viewModeOffsetX;
    const fromX = entryX.get();
    allAnimRef.current = [animate(entryX, fromX - shift, { duration: 0.4, ease: "easeOut" })];
    void currentEpoch;
  }, [deleteEpoch, deleteShiftActive, isActive, deleteTranslateX, viewModeOffsetX, entryX, entryScale, entryOpacity, cleanupAllAnims]);

  // 删除窗口（重排前）：从右侧进入新末位的下一张图做标准"切换入场"（缩放+淡入+飞入）。
  // 关键区别：横向"左移一格落位"这一段已不再由本卡自身承担——已交给源码级共享 groupShiftX
  // 驱动（被删图右侧整段一条动画源平滑平移，落位槽正等于它重排后的新槽位，多卡零失步）。
  // 这里只负责与纯"切换下一张"入场逐点同源的视觉部分：entryX 从 +0.6格(屏外右侧)→0，
  // scale 0.25→1、opacity 0→1。经 combinedX = entryX + groupShiftX 合成，观感与下一张完全一致。
  useEffect(() => {
    if (!deleteEntryTarget) return;
    // 该卡进入时仍非活跃（在活跃行右邻），因此不 gate isActive；只跳过首次打开 overlay。
    if (isFirstRenderRef.current) return;
    const shift = deleteTranslateX ?? 0;
    if (!(shift > 0)) return;
    if (deleteEntryEpochRef.current === deleteEpoch) return;
    deleteEntryEpochRef.current = deleteEpoch;
    const currentEpoch = ++animEpochRef.current;
    cleanupAllAnims();
    // 终点用 0（自身槽位）：左移一格的落位已由共享 groupShiftX(0→-shift)承担，本卡不再重复搬。
    const targetX = viewModeOffsetX;
    // 与"切换下一张"入场完全同源：切换时该卡由 Swiper wrapper 左移一格 + 自身 entryX 从
    // +0.6格滑到 0，视觉位移 1.6 格、且从屏外右侧飞入；删除场景共享 groupShiftX 扮演"这一段的
    // wrapper 平移"，本卡 entryX 同样从 +0.6格（屏外右侧）→ 0。两者合成后逐点一致。dir=1 从右、
    // dir=-1 从左。
    const offset = entryXOffset ?? 60;
    const dir = slideDirectionRef?.current ?? 1;
    entryScale.set(0.25);
    entryOpacity.set(0);
    entryX.set(offset * dir);
    allAnimRef.current = [
      animate(entryScale, 1, { duration: 0.4, ease: "easeOut" }),
      animate(entryOpacity, 1, { duration: 0.4, ease: "easeOut" }),
      animate(entryX, targetX, { duration: 0.4, ease: "easeOut" }),
    ];
    void currentEpoch;
  }, [deleteEpoch, deleteEntryTarget, deleteTranslateX, viewModeOffsetX, entryXOffset, slideDirectionRef, entryX, entryScale, entryOpacity, cleanupAllAnims]);

  // 当前 src 是否为"原图"（与底层缩略图不同）。是则等原图加载完成后再淡出缩略图，
  // 切换期间缩略图常驻底层，彻底消除黑屏闪烁。
  // 原图已就绪（originalReady，如删除重排后重挂载的幸存图）时：直接显示原图、不渲染底层缩略图，
  // 避免新实例 imgLoaded 从头计数而在平移到位的一瞬露出缩略图。
  const isOriginal = Boolean(underlaySrc) && src !== underlaySrc;
  // 底层缩略图"常驻"（只要有缩略图、且非"原图已就绪"就渲染），而非仅 isOriginal 时才渲染。
  // 否则 src 从缩略图切到原图那一瞬才首次新建底层 <img>，需重新加载/解码 → 中间露出空白帧
  // （"到位后缩略图不见，再渐入一张缩略图"）。常驻后：
  //   - src 还是缩略图阶段：主图(上层 z5) 即该缩略图、opacity1 盖住底层，无视觉差异，底层趁机已加载就绪；
  //   - src 切到原图、主图 opacity 转 0：底层缩略图早已就绪无缝兜底 → 原图 onLoad 后淡入，无空白帧。
  // 原图已就绪（originalReady，如重排后右幸存图）时不渲染底层，避免"重挂载后闪现缩略图"。
  const showUnderlay = Boolean(underlaySrc) && !originalReady;
  const spinnerVisible = showSpinner ?? (isOriginal && !imgLoaded && !originalReady);
  return (
    <motion.div
      style={{
        scale: entryScale,
        opacity: entryOpacity,
        x: combinedX,
        // 提升到合成器：删除/补位/入场动画的 x/scale/opacity 都在此层逐帧变化，
        // 无 will-change 时每帧都可能触发主线程图层化/重绘，多个图层不同步即表现为"组件抖动"。
        // 与"切换下一张"只动 wrapper 一个 transform 对齐，保证逐帧只走合成。
        willChange: "transform, opacity",
      }}
      className="relative flex h-full w-full items-center justify-center"
    >
      {/* 底层缩略图：原图加载期间的兜底，避免黑屏。原图已就绪时不渲染，防止重挂载闪缩略图 */}
      {showUnderlay && (
        <img
          src={underlaySrc}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={notifyThumbLoaded}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 h-full w-full select-none object-contain"
        />
      )}
      {/* 原图加载中：在缩略图上叠加统一的圆环加载指示。
          知道总大小(progressKnown)时按真实百分比填充；未知时同款圆环做旋转(indeterminate)。
          两种状态同一视觉，避免突兀切换 */}
      {spinnerVisible && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative h-16 w-16">
            <svg
              className={progressKnown ? "h-full w-full -rotate-90 drop-shadow" : "h-full w-full animate-spin drop-shadow"}
              viewBox="0 0 48 48"
              fill="none"
            >
              <circle className="text-white/20" cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" />
              <circle
                className="text-white"
                cx="24"
                cy="24"
                r="20"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={progressKnown ? CIRCUMFERENCE : CIRCUMFERENCE * 0.28}
                strokeDashoffset={progressKnown ? CIRCUMFERENCE * (1 - clampPct(downloadProgress) / 100) : 0}
              />
            </svg>
          </div>
        </div>
      )}
      <img
        ref={imgRef}
        data-carousel-main-img
        src={src}
        alt={alt}
        draggable={false}
        decoding="async"
        loading={loading}
        onLoad={handleImgLoad}
        onClick={(e) => e.stopPropagation()}
        style={{
          opacity: originalReady || !isOriginal || imgLoaded ? 1 : 0,
          transition: "opacity 0.2s ease-in",
        }}
        className="relative z-[5] h-full w-full select-none object-contain cursor-grab active:cursor-grabbing"
      />
    </motion.div>
  );
}
