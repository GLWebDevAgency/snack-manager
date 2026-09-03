/**
 * Design system SM Dark — bibliothèque de composants du back-office.
 * Import : `import { Btn, Panel, useToast } from "@/components/ui";`
 */
export { Icon, ICON_NAMES, type IconName } from "./icons";
export { Btn } from "./Btn";
export { IconBtn } from "./IconBtn";
export { Chip } from "./Chip";
export { Pill } from "./Pill";
export { StatusBadge, statusLabel } from "./StatusBadge";
export { Field, Input, Label, Select, Textarea } from "./fields";
export { Toggle } from "./Toggle";
export { SlotToggle } from "./SlotToggle";
export { Card, Panel } from "./Card";
export { Kpi } from "./Kpi";
export { BarChart } from "./BarChart";
export { Stars } from "./Stars";
export { ToastProvider, useToast } from "./Toast";
export { Drawer } from "./Drawer";
export { Modal } from "./Modal";
export { Skeleton } from "./Skeleton";
export { EmptyState } from "./EmptyState";
/*
 * L'identité du restaurant — sa tuile de logo et son verrou. Elles vivent
 * ici, et non dans `components/order`, parce que les TROIS surfaces qui
 * montrent un logo s'en servent : la vitrine, la carte de fidélité et les
 * aperçus du back-office. Voir l'en-tête de `identite.tsx`.
 */
export { TuileDeLogo, Verrou } from "./identite";
export { verrouPour } from "./verrou";
