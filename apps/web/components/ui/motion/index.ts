/**
 * Motion kit barrel (Apple product-page motion, no dependencies).
 * See ./README.md for when to use each effect and where not to.
 */
export { prefersReducedMotion, hasFinePointer, supportsScrollTimeline, useReducedMotion } from "./env";
export {
  ScrollScrub,
  computeProgress,
  observeScrollProgress,
  useScrollProgress,
  useScrollProgressVar,
  type ScrollProgressMode,
  type ScrollProgressOptions,
  type ScrollScrubProps,
} from "./ScrollScrub";
export { ScrollReveal, Stagger, type RevealEffect, type ScrollRevealProps, type StaggerProps } from "./ScrollReveal";
export { HighlightText, type HighlightTextProps } from "./HighlightText";
export { StickyZoom, type StickyZoomProps } from "./StickyZoom";
export { GlowBorder, type GlowBorderProps } from "./GlowBorder";
export { GradientText, type GradientTextProps } from "./GradientText";
export { Gallery, type GalleryItem, type GalleryProps } from "./Gallery";
export { Parallax, ParallaxLayer, type ParallaxLayerProps, type ParallaxProps } from "./Parallax";
export { Magnetic, Tilt, type MagneticProps, type TiltProps } from "./Tilt";
export { RouteFade, TransitionLink, useTransitionRouter, type TransitionLinkProps } from "./PageTransition";
export { LiquidGlass, type LiquidGlassProps } from "./LiquidGlass";
export { PawBurst, type PawBurstProps } from "./PawBurst";
