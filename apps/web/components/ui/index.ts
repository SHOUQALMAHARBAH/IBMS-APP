/*
 * The IBMS primitive set. Every screen composes from these rather than
 * hand-rolling a card or a button, so the whole system stays consistent
 * (frontend directive §6) and a token change lands everywhere at once.
 */
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { Badge, type BadgeTone } from './Badge';
export { Card, PageHeader } from './Card';
export { EmptyState, ErrorState } from './EmptyState';
export { Field, Select, TextArea, TextInput } from './Field';
export { Skeleton, SkeletonList } from './Skeleton';
export { Table, Td, Th, Tr } from './Table';
