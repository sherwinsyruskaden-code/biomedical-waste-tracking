import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

/**
 * A number that counts up to its value (and between values when live data changes).
 * With "reduce motion" on, it simply shows the value. Screen readers always get the final number.
 */
export function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const reduce = useReducedMotion();
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef(reduce ? value : 0);
  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    if (reduce || shown.current === value) {
      node.textContent = fmt(value);
      shown.current = value;
      return;
    }
    const controls = animate(shown.current, value, {
      duration: 0.7,
      ease: [0.22, 0.8, 0.3, 1],
      onUpdate: (v) => {
        shown.current = v;
        node.textContent = fmt(v);
      },
      onComplete: () => {
        shown.current = value;
        node.textContent = fmt(value);
      },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce, decimals]);
  return (
    <span aria-label={fmt(value)} data-value={value}>
      <span ref={el} aria-hidden>{fmt(reduce ? value : shown.current)}</span>
    </span>
  );
}
