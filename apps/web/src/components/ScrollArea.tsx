import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";

interface ScrollAreaProps {
  children: React.ReactNode;
  className?: string;
  onScroll?: (el: HTMLDivElement) => void;
  /**
   * When set, the scroll container is content-sized up to this height
   * (as a CSS length: `"420px"`, `"50vh"`, `"min(50vh, 420px)"`, …)
   * instead of filling its parent via `absolute inset-0`. Use this when
   * the ScrollArea sits inside a non-flex parent that can't give it a
   * height. Thumb styling and fade behavior are identical either way.
   */
  maxHeight?: string;
}

export interface ScrollAreaHandle {
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

export const ScrollArea = forwardRef<ScrollAreaHandle, ScrollAreaProps>(
  function ScrollArea({ children, className, onScroll: onScrollProp, maxHeight }, ref) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [thumb, setThumb] = useState({ height: 0, top: 0, visible: false });
    const [hovered, setHovered] = useState(false);
    const [scrolling, setScrolling] = useState(false);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useImperativeHandle(ref, () => ({
      scrollToBottom(behavior: ScrollBehavior = "smooth") {
        const el = scrollRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior });
      },
    }));

    const update = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      const ratio = el.clientHeight / el.scrollHeight;
      setThumb({
        visible: ratio < 1,
        height: Math.max(ratio * el.clientHeight, 32),
        top: (el.scrollTop / el.scrollHeight) * el.clientHeight,
      });
    }, []);

    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }, [update]);

    const onThumbMouseDown = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        const el = scrollRef.current;
        if (!el) return;
        const startY = e.clientY;
        const startScrollTop = el.scrollTop;
        const scrollRange = el.scrollHeight - el.clientHeight;
        const thumbRange = el.clientHeight - thumb.height;

        const onMove = (ev: MouseEvent) => {
          const delta = ev.clientY - startY;
          el.scrollTop = startScrollTop + (delta / thumbRange) * scrollRange;
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      },
      [thumb.height],
    );

    const onScroll = useCallback(() => {
      update();
      setScrolling(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setScrolling(false), 1000);
      if (scrollRef.current) onScrollProp?.(scrollRef.current);
    }, [update, onScrollProp]);

    // Two layout modes:
    //   - Parent-sized (default): outer is `absolute inset-0`-style via
    //     caller's flex-1 etc. Inner scroller fills it absolutely so
    //     it reports the correct clientHeight for thumb math.
    //   - Content-sized (maxHeight set): outer and inner are both in-flow
    //     capped at `maxHeight`. Works inside non-flex parents.
    const thumbNode = thumb.visible && (
      <div
        className="absolute right-1 rounded-full cursor-pointer transition-opacity duration-300"
        style={{
          top: thumb.top + 6,
          height: thumb.height - 12,
          width: 8,
          background: hovered ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.14)",
          borderRadius: 100,
          opacity: scrolling || hovered ? 1 : 0,
        }}
        onMouseDown={onThumbMouseDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
    );

    if (maxHeight !== undefined) {
      return (
        <div
          className={`relative ${className ?? ""}`}
          style={{ maxHeight }}
        >
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="overflow-y-auto"
            style={{ maxHeight, scrollbarWidth: "none" } as React.CSSProperties}
          >
            {children}
          </div>
          {thumbNode}
        </div>
      );
    }

    return (
      <div className={`relative overflow-hidden ${className ?? ""}`}>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="absolute inset-0 overflow-y-scroll"
          style={{ scrollbarWidth: "none" } as React.CSSProperties}
        >
          {children}
        </div>
        {thumbNode}
      </div>
    );
  },
);
