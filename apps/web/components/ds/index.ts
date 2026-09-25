// Design v4 component layer. Import from "@/components/ds".
export { Button } from "./Button";
export type { ButtonProps, ButtonVariant } from "./Button";
export { StatusPill } from "./StatusPill";
export type { StatusPillProps, StatusVariant, StatusPillSize } from "./StatusPill";
export { StatusIcon } from "./icons";
export type { StatusIconName } from "./icons";
export { Label } from "./Label";
export type { LabelProps } from "./Label";
export { CollarCode } from "./CollarCode";
export type { CollarCodeProps } from "./CollarCode";
export { CollarCodeInput } from "./CollarCodeInput";
export type { CollarCodeInputProps } from "./CollarCodeInput";
export {
  COLLAR_ALPHABET,
  COLLAR_LENGTH,
  collarGroups,
  sanitizeCollarCode,
  sayCollarCode,
} from "./collar";
export { Card } from "./Card";
export type { CardProps } from "./Card";
export { ListRow, ListGroup } from "./ListRow";
export type { ListRowProps, ListGroupProps } from "./ListRow";
export { DogAvatar, avatarPalette, AVATAR_PALETTES } from "./DogAvatar";
export type { DogAvatarProps, AvatarPalette, DogAvatarSize } from "./DogAvatar";
export { Badge } from "./Badge";
export type { BadgeProps } from "./Badge";
export { Logo, LogoMark } from "./Logo";
export type { LogoProps } from "./Logo";
export { TopNav, DEFAULT_NAV_LINKS } from "./TopNav";
export type { TopNavProps, NavLink } from "./TopNav";
export { TabBar, DEFAULT_TABS } from "./TabBar";
export type { TabBarProps, TabKey, TabItem } from "./TabBar";
export { PrivacyBand } from "./PrivacyBand";
export type { PrivacyBandProps } from "./PrivacyBand";
export { Footer, FOOTER_PRIMARY, FOOTER_SECONDARY, SOURCE_URL } from "./Footer";
export type { FooterProps, FooterLink } from "./Footer";
export { Aurora } from "./Aurora";
export type { AuroraProps, AuroraVariant } from "./Aurora";
export { StickyFooter } from "./StickyFooter";
export type { StickyFooterProps } from "./StickyFooter";
export { SectionFade } from "./SectionFade";
export type { SectionFadeProps } from "./SectionFade";
export { Progress } from "./Progress";
export type { ProgressProps } from "./Progress";
// Design v5 additions (the chrome: AppHeader for focused screens, the
// five-tab TabBar's icons, and the settings controls). Hooks stay out of
// this barrel: server components import it, and a hook module here breaks them.
// Client components import useScrolled from "./useScrolled" by path.
export { TabIcon } from "./TabBar";
export { AppHeader } from "./AppHeader";
export type { AppHeaderProps, AppHeaderBack } from "./AppHeader";
export { Switch } from "./Switch";
export type { SwitchProps } from "./Switch";
export { Segmented } from "./Segmented";
export type { SegmentedProps, SegmentedOption } from "./Segmented";
export { Sheet } from "./Sheet";
export type { SheetProps } from "./Sheet";
export { SettingsGroup, SettingsRow } from "./SettingsList";
export type { SettingsRowProps } from "./SettingsList";
