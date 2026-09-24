import type { SVGProps } from "react";
import { PATHS } from "./Icon.paths";

/**
 * Inline-SVG icon set (Phosphor, MIT: see Icon.paths.ts for the notice).
 *
 * Two weights, mirroring how iOS uses SF Symbols: `regular` for resting UI and
 * `fill` for the selected/active state (tab bar, toggled buttons). Icons are
 * decorative by default (aria-hidden) because Hetja always pairs an icon with a
 * visible verb; pass `title` only when the icon IS the label (an icon-only
 * button should rather carry aria-label on the button itself).
 *
 * Server component: zero client JS, and no layout shift since width/height
 * are set on the element.
 */

export type IconName = keyof typeof PATHS;
export type IconWeight = "regular" | "fill";

/** Every available icon name, in table order (styleguide grid, tests). */
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "children"> {
  name: IconName;
  weight?: IconWeight;
  /** Pixel size (square). Default 20, which matches 17px body text optically. */
  size?: number | string;
  /** Accessible name; when set the icon is exposed as role="img". */
  title?: string;
}

export function Icon({
  name,
  weight = "regular",
  size = 20,
  title,
  className,
  ...rest
}: IconProps): React.JSX.Element {
  const paths = PATHS[name][weight];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="currentColor"
      focusable="false"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      data-icon={name}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
