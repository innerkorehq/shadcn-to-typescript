/**
 * Component registry mapping components to their dependencies
 * This helps the script identify required packages for each component
 */

export interface ComponentDependencies {
  // Base NPM package name (e.g., @radix-ui/react-accordion)
  package: string;
  // Name of the imported primitive (e.g., AccordionPrimitive)
  primitive: string;
  // Sub-components that are commonly used (e.g., Root, Item, etc.)
  subComponents: string[];
  // Any additional dependencies this component might need
  additionalDeps?: string[];
}

export const componentRegistry: Record<string, ComponentDependencies> = {
  accordion: {
    package: '@radix-ui/react-accordion',
    primitive: 'AccordionPrimitive',
    subComponents: ['Root', 'Item', 'Trigger', 'Content'],
    additionalDeps: ['lucide-react']
  },
  'alert-dialog': {
    package: '@radix-ui/react-alert-dialog',
    primitive: 'AlertDialogPrimitive',
    subComponents: ['Root', 'Trigger', 'Content', 'Header', 'Footer', 'Title', 'Description', 'Cancel', 'Action'],
    additionalDeps: []
  },
  'aspect-ratio': {
    package: '@radix-ui/react-aspect-ratio',
    primitive: 'AspectRatioPrimitive',
    subComponents: [],
    additionalDeps: []
  },
  avatar: {
    package: '@radix-ui/react-avatar',
    primitive: 'AvatarPrimitive',
    subComponents: ['Root', 'Image', 'Fallback'],
    additionalDeps: []
  },
  badge: {
    package: '',
    primitive: '',
    subComponents: [],
    additionalDeps: ['class-variance-authority']
  },
  button: {
    package: '@radix-ui/react-slot',
    primitive: 'Slot',
    subComponents: [],
    additionalDeps: ['class-variance-authority']
  },
  calendar: {
    package: 'react-day-picker',
    primitive: 'DayPicker',
    subComponents: [],
    additionalDeps: ['date-fns']
  },
  card: {
    package: '',
    primitive: '',
    subComponents: ['Header', 'Title', 'Description', 'Content', 'Footer'],
    additionalDeps: []
  },
  checkbox: {
    package: '@radix-ui/react-checkbox',
    primitive: 'CheckboxPrimitive',
    subComponents: ['Root', 'Indicator'],
    additionalDeps: ['lucide-react']
  },
  collapsible: {
    package: '@radix-ui/react-collapsible',
    primitive: 'CollapsiblePrimitive',
    subComponents: ['Root', 'Trigger', 'Content'],
    additionalDeps: []
  },
  'command': {
    package: 'cmdk',
    primitive: 'Command',
    subComponents: ['Empty', 'Group', 'Input', 'Item', 'List', 'Loading', 'Dialog', 'Separator'],
    additionalDeps: ['lucide-react']
  },
  'context-menu': {
    package: '@radix-ui/react-context-menu',
    primitive: 'ContextMenuPrimitive',
    subComponents: ['Root', 'Trigger', 'Portal', 'Content', 'Item', 'CheckboxItem', 'RadioItem', 'Group', 'Label', 'Separator'],
    additionalDeps: ['lucide-react']
  },
  'date-picker': {
    package: 'react-day-picker',
    primitive: 'DayPicker',
    subComponents: [],
    additionalDeps: ['date-fns']
  },
  dialog: {
    package: '@radix-ui/react-dialog',
    primitive: 'DialogPrimitive',
    subComponents: ['Root', 'Trigger', 'Portal', 'Close', 'Content', 'Header', 'Footer', 'Title', 'Description'],
    additionalDeps: ['lucide-react']
  },
  drawer: {
    package: '@radix-ui/react-dialog',
    primitive: 'DialogPrimitive',
    subComponents: ['Root', 'Trigger', 'Portal', 'Close', 'Content', 'Header', 'Footer', 'Title', 'Description'],
    additionalDeps: ['vaul']
  },
  'dropdown-menu': {
    package: '@radix-ui/react-dropdown-menu',
    primitive: 'DropdownMenuPrimitive',
    subComponents: ['Root', 'Trigger', 'Group', 'Portal', 'Content', 'Item', 'CheckboxItem', 'RadioGroup', 'RadioItem', 'Label', 'Separator'],
    additionalDeps: ['lucide-react']
  },
  form: {
    package: '',
    primitive: '',
    subComponents: ['Item', 'Label', 'Control', 'Description', 'Message'],
    additionalDeps: ['react-hook-form', '@hookform/resolvers', 'zod']
  },
  'hover-card': {
    package: '@radix-ui/react-hover-card',
    primitive: 'HoverCardPrimitive',
    subComponents: ['Root', 'Trigger', 'Portal', 'Content'],
    additionalDeps: []
  },
  input: {
    package: '',
    primitive: '',
    subComponents: [],
    additionalDeps: []
  },
  label: {
    package: '@radix-ui/react-label',
    primitive: 'LabelPrimitive',
    subComponents: [],
    additionalDeps: []
  },
  menubar: {
    package: '@radix-ui/react-menubar',
    primitive: 'MenubarPrimitive',
    subComponents: ['Root', 'Menu', 'Trigger', 'Portal', 'Content', 'Item', 'CheckboxItem', 'RadioGroup', 'RadioItem', 'Label', 'Separator', 'Group'],
    additionalDeps: ['lucide-react']
  },
  'navigation-menu': {
    package: '@radix-ui/react-navigation-menu',
    primitive: 'NavigationMenuPrimitive',
    subComponents: ['Root', 'List', 'Item', 'Trigger', 'Content', 'Link'],
    additionalDeps: []
  },
  'not-found': {
    package: '',
    primitive: '',
    subComponents: [],
    additionalDeps: ['lucide-react']
  },
  popover: {
    package: '@radix-ui/react-popover',
    primitive: 'PopoverPrimitive',
    subComponents: ['Root', 'Trigger', 'Content'],
    additionalDeps: []
  },
  progress: {
    package: '@radix-ui/react-progress',
    primitive: 'ProgressPrimitive',
    subComponents: ['Root'],
    additionalDeps: []
  },
  'radio-group': {
    package: '@radix-ui/react-radio-group',
    primitive: 'RadioGroupPrimitive',
    subComponents: ['Root', 'Item', 'Indicator'],
    additionalDeps: []
  },
  'scroll-area': {
    package: '@radix-ui/react-scroll-area',
    primitive: 'ScrollAreaPrimitive',
    subComponents: ['Root', 'Viewport', 'Scrollbar', 'Thumb', 'Corner'],
    additionalDeps: []
  },
  select: {
    package: '@radix-ui/react-select',
    primitive: 'SelectPrimitive',
    subComponents: ['Root', 'Group', 'Value', 'Trigger', 'Content', 'Label', 'Item', 'Separator'],
    additionalDeps: ['lucide-react']
  },
  separator: {
    package: '@radix-ui/react-separator',
    primitive: 'SeparatorPrimitive',
    subComponents: [],
    additionalDeps: []
  },
  sheet: {
    package: '@radix-ui/react-dialog',
    primitive: 'DialogPrimitive',
    subComponents: ['Root', 'Trigger', 'Portal', 'Close', 'Content', 'Header', 'Footer', 'Title', 'Description'],
    additionalDeps: []
  },
  skeleton: {
    package: '',
    primitive: '',
    subComponents: [],
    additionalDeps: []
  },
  slider: {
    package: '@radix-ui/react-slider',
    primitive: 'SliderPrimitive',
    subComponents: ['Root', 'Track', 'Range', 'Thumb'],
    additionalDeps: []
  },
  switch: {
    package: '@radix-ui/react-switch',
    primitive: 'SwitchPrimitive',
    subComponents: ['Root', 'Thumb'],
    additionalDeps: []
  },
  tabs: {
    package: '@radix-ui/react-tabs',
    primitive: 'TabsPrimitive', 
    subComponents: ['Root', 'List', 'Trigger', 'Content'],
    additionalDeps: []
  },
  textarea: {
    package: '',
    primitive: '',
    subComponents: [],
    additionalDeps: []
  },
  toast: {
    package: '@radix-ui/react-toast',
    primitive: 'ToastPrimitive',
    subComponents: ['Root', 'Provider', 'Viewport', 'Title', 'Description', 'Action', 'Close'],
    additionalDeps: []
  },
  toggle: {
    package: '@radix-ui/react-toggle',
    primitive: 'TogglePrimitive',
    subComponents: ['Root'],
    additionalDeps: []
  },
  'toggle-group': {
    package: '@radix-ui/react-toggle-group',
    primitive: 'ToggleGroupPrimitive',
    subComponents: ['Root', 'Item'],
    additionalDeps: []
  },
  tooltip: {
    package: '@radix-ui/react-tooltip',
    primitive: 'TooltipPrimitive',
    subComponents: ['Root', 'Provider', 'Trigger', 'Content'],
    additionalDeps: []
  }
};

/**
 * Get component dependencies from registry
 */
export function getComponentDependencies(componentName: string): ComponentDependencies | null {
  // Normalize to kebab-case for lookup
  const normalizedName = componentName.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  
  return componentRegistry[normalizedName] || null;
}