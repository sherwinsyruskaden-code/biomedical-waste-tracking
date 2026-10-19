import { useReducedMotion } from "motion/react";

/**
 * Decorative wireframe globe built from CSS 3D transforms (no WebGL, no extra dependency, no assets).
 * It is purely ornamental: aria-hidden, ignores the pointer, and only spins when the visitor allows motion.
 * Without 3D transform support it simply renders flat rings, so there is nothing to fall back from.
 */
const R = 150; // sphere radius in px
const meridians = [0, 30, 60, 90, 120, 150];
const parallels = [-60, -30, 0, 30, 60].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  return { y: Math.sin(rad) * R, size: Math.cos(rad) * R * 2 };
});

const dots = [
  { left: "8%", top: "22%", size: 6, delay: "0s" },
  { left: "86%", top: "14%", size: 8, delay: "-2s" },
  { left: "92%", top: "62%", size: 5, delay: "-4s" },
  { left: "14%", top: "78%", size: 7, delay: "-6s" },
  { left: "58%", top: "92%", size: 5, delay: "-3s" },
];

export function GlobeVisual({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={className} aria-hidden data-testid="globe-visual" style={{ pointerEvents: "none" }}>
      <div className="relative mx-auto" style={{ width: R * 2, height: R * 2, perspective: 900 }}>
        <div
          className="absolute inset-[-24px] rounded-full"
          style={{ background: "radial-gradient(closest-side, rgb(16 185 129 / 0.22), rgb(198 244 50 / 0.08) 60%, transparent 75%)" }}
        />
        <div className={reduce ? "" : "fx-globe-spin"} style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d", transform: "rotateX(-18deg) rotateY(24deg)" }}>
          {meridians.map((deg) => (
            <span
              key={deg}
              className="absolute inset-0 rounded-full border border-emerald-600/55"
              style={{ transform: `rotateY(${deg}deg)` }}
            />
          ))}
          {parallels.map((p) => (
            <span
              key={p.y}
              className="absolute rounded-full border border-emerald-600/45"
              style={{ width: p.size, height: p.size, left: R - p.size / 2, top: R - p.size / 2, transform: `rotateX(90deg) translateZ(${p.y}px)` }}
            />
          ))}
          <span className="absolute inset-0 rounded-full border-2 border-emerald-600/60" style={{ transform: "rotateX(90deg) rotateY(0deg) scale(1.28)" }} />
        </div>
        {dots.map((d) => (
          <span
            key={d.left + d.top}
            className={`absolute rounded-full bg-lime ${reduce ? "" : "fx-drift"}`}
            style={{ left: d.left, top: d.top, width: d.size, height: d.size, animationDelay: d.delay, boxShadow: "0 0 12px 2px rgb(198 244 50 / 0.55)" }}
          />
        ))}
      </div>
    </div>
  );
}
