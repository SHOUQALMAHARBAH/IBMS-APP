/*
 * The WASEET 360 primitive set. Every screen composes from these rather than hand-rolling a card
 * or a button, so the whole system stays consistent (frontend directive §6) and a token change
 * lands everywhere at once.
 *
 * THE SECOND GROUP BELOW IS THE DESIGN BATCH'S OWN, and it exists because the approved reference
 * screens are made of five shapes this product otherwise hand-rolled with inline styles every
 * time: the summary row, the filter strip, the inset section, the note, and the log. Reach for
 * one of these before writing a `style={{ ... }}` that duplicates it — the inline-style count is a
 * ratcheting budget now (`scripts/measurements/inline-styles.py`) and it may only fall.
 */
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { ActionStatus } from './ActionStatus';
export { Badge, type BadgeTone } from './Badge';
export { Card, PageHeader } from './Card';
export { EmptyState, ErrorState } from './EmptyState';
export { DateEcho, Field, Hint, Select, TextArea, TextInput } from './Field';
export { FigurePeriod } from './FigurePeriod';
export { ReportProvenance } from './ReportProvenance';
export { SelectedValueDescription } from './SelectedValueDescription';
export { Skeleton, SkeletonList } from './Skeleton';
export { Table, Td, Th, Tr } from './Table';

/* --- the design batch's composition layer ------------------------------------------------- */
export { AuthFrame } from './AuthFrame';
export { BrandLockup, BrandMark } from './BrandMark';
export { BrandPitch } from './BrandPitch';
export { BarList, Ring, SegmentedBar, type ChartSlot } from './Figures';
export { Icon, IconBadge, IconLabel, type IconName } from './Icon';
export { IconField } from './IconField';
export { DetailPanel, DetailSection, FilterBar, KeyValue, Note, TimelineLog } from './Panels';
export { Tile, Tiles } from './Tiles';
