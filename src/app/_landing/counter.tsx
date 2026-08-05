"use client";

import { useEffect, useRef, useState } from "react";

type CounterProps = {
  to: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  /** If true, starts immediately on mount instead of waiting for scroll-in. */
  immediate?: boolean;
};

// Count-up number that animates from 0 → `to` the first time it scrolls into view
// (easeOutCubic). Pure browser APIs — no libraries. Respects prefers-reduced-motion
// by snapping straight to the final value.
export function Counter({ to, duration = 1200, prefix = "", suffix = "", className, immediate = false }: CounterProps) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const run = () => {
      if (started.current) return;
      started.current = true;
      if (reduce) {
        setVal(to);
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        setVal(Math.round(eased * to));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    if (immediate) {
      run();
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) run();
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to, duration, immediate]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {val.toLocaleString()}
      {suffix}
    </span>
  );
}
