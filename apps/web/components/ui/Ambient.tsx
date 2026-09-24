"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Ambient.module.css";

/**
 * <Ambient>: the pink/peach aurora behind every page (Sidehoe `.ambient`).
 *
 * Two layers, cheapest first:
 *   1. Four CSS radial blobs drifting on the compositor. This is the whole
 *      effect wherever WebGL is missing, and what shows before the shader's
 *      first frame.
 *   2. A WebGL port of Sidehoe's simplex-noise aurora, drawn at ONE THIRD of
 *      the CSS resolution. It's a blur, so a third is visually identical and
 *      ~9× fewer fragments. The canvas is removed if WebGL is unavailable or
 *      the program fails to link.
 *
 * Cost controls: the rAF loop stops while the tab is hidden and never starts
 * under prefers-reduced-motion (one static frame is drawn instead). No depth,
 * stencil, alpha or antialias buffers are requested.
 *
 * Mount ONCE, globally (ChromeShell). `contained` is for previews (the
 * styleguide): absolute inside a positioned parent rather than fixed.
 */

export interface AmbientProps {
  /** "aurora" (default) = blobs + shader; "plain" = flat white, no JS work. */
  variant?: "aurora" | "plain";
  /** Fill the nearest positioned ancestor instead of the viewport. */
  contained?: boolean;
  className?: string;
}

const VERTEX = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }";

// Verbatim from Sidehoe (side.html, aurora()), which is itself a domain-warped
// 2D simplex noise (Ashima/Stefan Gustavson, MIT).
const FRAGMENT = `precision highp float;
uniform vec2 r; uniform float t; uniform vec2 m;
vec3 permute(vec3 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy)); vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 mm = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  mm = mm*mm; mm = mm*mm;
  vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5); vec3 a0 = x - ox;
  mm *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(mm, g);
}
void main(){
  vec2 uv = gl_FragCoord.xy / r;
  vec2 p = uv; p.x *= r.x / r.y; p += m * 0.08;
  float s = t * 0.06;
  vec2 w = p + 0.45 * vec2(snoise(p * 0.9 + vec2(s, -s)), snoise(p * 0.9 + vec2(-s, s) + 7.3));
  float n1 = snoise(w * 0.85 + vec2(s * 0.7, 3.0));
  float n2 = snoise(w * 0.6 - vec2(5.0, s));
  float n3 = snoise(w * 1.3 + vec2(11.0, s * 1.3));
  vec2 c = abs(uv - 0.5) * 2.0;
  float edge = smoothstep(0.35, 1.3, length(c * vec2(0.9, 1.0)));
  edge = max(edge, 0.10);
  vec3 col = vec3(1.0);
  col = mix(col, vec3(1.00, 0.52, 0.80), smoothstep(-0.35, 0.85, n1) * edge * 0.95);
  col = mix(col, vec3(1.00, 0.74, 0.60), smoothstep(0.00, 0.95, n2) * edge * 0.80);
  col = mix(col, vec3(0.90, 0.68, 1.00), smoothstep(0.15, 1.00, n3) * edge * 0.65);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Resolution divisor for the shader canvas. */
const DOWNSCALE = 3;

/**
 * Lite mode: phones and weak devices get the CSS blobs only, held still.
 * Hetja is used mostly on phones, often budget Android on 4G, outdoors in the
 * heat; a full-viewport shader running every frame there is battery and
 * thermal cost for decoration. Triggers: touch-first or narrow screens, Data
 * Saver, or low memory / few cores (Chromium exposes both).
 */
export function isLiteDevice(): boolean {
  if (typeof window === "undefined") return true;
  const mq = (q: string): boolean => window.matchMedia?.(q).matches ?? false;
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };
  return (
    mq("(pointer: coarse)") ||
    mq("(max-width: 899px)") ||
    nav.connection?.saveData === true ||
    (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4) ||
    (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4)
  );
}

export function Ambient({ variant = "aurora", contained = false, className }: AmbientProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [glState, setGlState] = useState<"pending" | "ready" | "none">("pending");

  useEffect(() => {
    if (variant !== "aurora") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // jsdom and ancient browsers: no WebGL constructor → CSS blobs only.
    // (Checked first so jsdom never logs "getContext not implemented".)
    if (typeof window.WebGLRenderingContext === "undefined" || isLiteDevice()) {
      setGlState("none");
      return;
    }
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl", {
        antialias: false,
        alpha: false,
        depth: false,
        stencil: false,
        powerPreference: "low-power",
        preserveDrawingBuffer: false,
      });
    } catch {
      gl = null;
    }
    if (!gl) {
      setGlState("none");
      return;
    }
    const ctx = gl;

    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = ctx.createShader(type);
      if (!sh) return null;
      ctx.shaderSource(sh, src);
      ctx.compileShader(sh);
      return sh;
    };
    const prog = ctx.createProgram();
    const vs = compile(ctx.VERTEX_SHADER, VERTEX);
    const fs = compile(ctx.FRAGMENT_SHADER, FRAGMENT);
    if (!prog || !vs || !fs) {
      setGlState("none");
      return;
    }
    ctx.attachShader(prog, vs);
    ctx.attachShader(prog, fs);
    ctx.linkProgram(prog);
    if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) {
      setGlState("none");
      return;
    }
    ctx.useProgram(prog);
    ctx.bindBuffer(ctx.ARRAY_BUFFER, ctx.createBuffer());
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), ctx.STATIC_DRAW);
    const loc = ctx.getAttribLocation(prog, "p");
    ctx.enableVertexAttribArray(loc);
    ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);
    const uR = ctx.getUniformLocation(prog, "r");
    const uT = ctx.getUniformLocation(prog, "t");
    const uM = ctx.getUniformLocation(prog, "m");

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const size = () => {
      canvas.width = Math.max(2, Math.round(canvas.clientWidth / DOWNSCALE));
      canvas.height = Math.max(2, Math.round(canvas.clientHeight / DOWNSCALE));
      ctx.viewport(0, 0, canvas.width, canvas.height);
    };

    // Pointer parallax, eased (Sidehoe: px += (mx - px) * 0.05).
    let mx = 0;
    let my = 0;
    let px = 0;
    let py = 0;
    const onPointer = (e: PointerEvent) => {
      mx = e.clientX / window.innerWidth - 0.5;
      my = e.clientY / window.innerHeight - 0.5;
    };

    let raf = 0;
    let first = true;
    const draw = (now: number) => {
      px += (mx - px) * 0.05;
      py += (my - py) * 0.05;
      ctx.uniform2f(uR, canvas.width, canvas.height);
      ctx.uniform1f(uT, now / 1000 + 40);
      ctx.uniform2f(uM, px, -py);
      ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
      if (first) {
        first = false;
        setGlState("ready"); // fade the canvas in over the blobs
      }
      raf = !reduced && !document.hidden ? requestAnimationFrame(draw) : 0;
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!reduced) {
        start();
      }
    };
    const onResize = () => {
      size();
      // A resize clears the canvas; repaint the static frame when not looping.
      if (reduced) start();
    };

    size();
    start();
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    if (!reduced) window.addEventListener("pointermove", onPointer, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointer);
      // Deliberately NOT WEBGL_lose_context: StrictMode re-runs this effect on
      // the same canvas, and a lost context can't be re-acquired. The context
      // is collected with its canvas; Ambient is mounted once per app anyway.
    };
  }, [variant]);

  const cls = [styles.ambient, contained ? styles.contained : "", className ?? ""].filter(Boolean).join(" ");

  return (
    <div className={cls} data-ambient={variant} aria-hidden="true">
      {variant === "aurora" ? (
        <>
          <i className={styles.blob} />
          <i className={styles.blob} />
          <i className={styles.blob} />
          <i className={styles.blob} />
          {glState !== "none" ? (
            <canvas ref={canvasRef} className={styles.canvas} data-ready={glState === "ready" ? "" : undefined} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
