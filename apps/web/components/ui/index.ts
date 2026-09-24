/**
 * Core UI kit barrel (Apple/Sidehoe direction). The iOS-control kit lives in
 * ./ios.ts. Each module marks itself "use client" only where it needs the
 * browser, so importing server-safe pieces (Icon, Marquee, StatusPill) from
 * here does not pull client JS into a server component's bundle by itself.
 */
export { Icon, ICON_NAMES, type IconName, type IconProps, type IconWeight } from "./Icon";
export { Dogmoji, Sticker, type DogmojiProps, type StickerProps } from "./Dogmoji";
export { Ambient, type AmbientProps } from "./Ambient";
export { PhoneFrame, PHONE_H, PHONE_W, type LiveActivity, type PhoneFrameProps } from "./PhoneFrame";
export { Facepile, OrbitRing, type FacepileProps, type OrbitRingProps } from "./OrbitRing";
export { Reveal, type RevealProps } from "./Reveal";
export { NumberTicker, type NumberTickerProps } from "./NumberTicker";
export { Marquee, type MarqueeProps } from "./Marquee";
export {
  Bubble,
  ChatPlayer,
  Receipt,
  Stamp,
  TypingDots,
  type BubbleProps,
  type ChatMessage,
  type ChatPlayerProps,
} from "./Chat";
export { StatusPill, type StatusPillProps, type StatusTone } from "./StatusPill";
