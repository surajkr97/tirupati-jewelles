/**
 * Design system barrel.
 * Created by Phase 2 (specs/02-design-system.md §2.2).
 *
 * Later phases import from '@/components/ui' so a component can be relocated without a
 * repo-wide find-and-replace.
 */
export { Badge, type BadgeProps } from '@/components/ui/badge';
export { Button, type ButtonProps } from '@/components/ui/button';
// From the class module, not the component — it must stay callable from a server component.
export { buttonClasses, type ButtonVariants } from '@/components/ui/button-classes';
export { Card, type CardProps } from '@/components/ui/card';
export { Chip, type ChipProps } from '@/components/ui/chip';
export { EmptyState, type EmptyStateProps } from '@/components/ui/empty-state';
export { ImageFrame, type ImageFrameProps } from '@/components/ui/image-frame';
export { Input, type InputProps } from '@/components/ui/input';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from '@/components/ui/segmented-control';
export { Select, type SelectProps } from '@/components/ui/select';
export { Sheet, type SheetProps } from '@/components/ui/sheet';
export { Skeleton } from '@/components/ui/skeleton';
export { Spinner } from '@/components/ui/spinner';
export { Toaster, toast } from '@/components/ui/toast';
