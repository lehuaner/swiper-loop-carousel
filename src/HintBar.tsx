"use client";

import { useRef, useEffect, useCallback } from "react";
import { motion, useMotionValue, animate } from "motion/react";

interface HintBarProps {
  isOpen: boolean;
  hintLabel: string;
  hintZoomDesktop: string;
  hintZoomMobile: string;
}

export default function HintBar({ isOpen, hintLabel, hintZoomDesktop, hintZoomMobile }: HintBarProps) {
  const hintX = useMotionValue(0);
  const hintContentRef = useRef<HTMLDivElement>(null);
  const hintContainerRef = useRef<HTMLDivElement>(null);
  const hintAnimRef = useRef<ReturnType<typeof animate> | null>(null);
  const hintDraggingRef = useRef(false);
  const hintDragStartRef = useRef({ startX: 0, baseX: 0 });

  const startHintAnimation = useCallback(() => {
    if (hintAnimRef.current) {
      hintAnimRef.current.stop();
      hintAnimRef.current = null;
    }
    const contentEl = hintContentRef.current;
    const containerEl = hintContainerRef.current;
    if (!contentEl || !containerEl) return;
    const textWidth = contentEl.scrollWidth;
    const containerWidth = containerEl.clientWidth;
    const overflow = textWidth - containerWidth;
    if (overflow <= 0) {
      hintX.set(0);
      return;
    }
    const currentX = hintX.get();
    const clampedX = Math.max(-overflow, Math.min(0, currentX));
    const duration = overflow / 30;
    const controls = animate(hintX, [clampedX, -overflow, 0], {
      duration: duration * 2,
      ease: "linear",
      repeat: Infinity,
      repeatType: "reverse",
      repeatDelay: 1,
    });
    hintAnimRef.current = controls;
  }, [hintX]);

  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => startHintAnimation());
    return () => {
      cancelAnimationFrame(raf);
      if (hintAnimRef.current) {
        hintAnimRef.current.stop();
        hintAnimRef.current = null;
      }
    };
  }, [isOpen, startHintAnimation]);

  const handleHintPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      hintDraggingRef.current = true;
      hintDragStartRef.current = { startX: e.clientX, baseX: hintX.get() };
      if (hintAnimRef.current) {
        hintAnimRef.current.stop();
        hintAnimRef.current = null;
      }
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [hintX]
  );

  const handleHintPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!hintDraggingRef.current) return;
      const contentEl = hintContentRef.current;
      const containerEl = hintContainerRef.current;
      if (!contentEl || !containerEl) return;
      const overflow = contentEl.scrollWidth - containerEl.clientWidth;
      if (overflow <= 0) return;
      const delta = e.clientX - hintDragStartRef.current.startX;
      const x = Math.max(-overflow, Math.min(0, hintDragStartRef.current.baseX + delta));
      hintX.set(x);
    },
    [hintX]
  );

  const handleHintPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!hintDraggingRef.current) return;
      hintDraggingRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // releasePointerCapture 可能在指针已被释放时抛出异常，安全忽略
      }
      startHintAnimation();
    },
    [startHintAnimation]
  );

  return (
    <div
      ref={hintContainerRef}
      className="pointer-events-auto relative w-max max-w-[73vw] cursor-grab overflow-hidden rounded-full bg-black/60 px-3 py-1 leading-none text-xs font-medium text-white active:cursor-grabbing sm:backdrop-blur-sm"
      style={{ touchAction: "none" }}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onPointerDown={handleHintPointerDown}
      onPointerMove={handleHintPointerMove}
      onPointerUp={handleHintPointerUp}
      onPointerCancel={handleHintPointerUp}
    >
      <motion.div ref={hintContentRef} className="whitespace-nowrap" style={{ x: hintX }}>
        <span>
          {hintLabel}
          <span className="hidden sm:inline"> · {hintZoomDesktop}</span>
          <span className="sm:hidden"> · {hintZoomMobile}</span>
        </span>
      </motion.div>
    </div>
  );
}
