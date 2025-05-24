# Shadcn Component Props Extractor

A robust tool for extracting TypeScript prop types from shadcn UI components, with dependency detection and proper primitive handling.

## Key Features

- ✅ **Automatic Dependency Detection** - Installs required dependencies like @radix-ui packages
- ✅ **Proper Primitive Importing** - Adds imports for primitives like AccordionPrimitive 
- ✅ **Sub-component Detection** - Properly extracts props for component parts
- ✅ **Hyphenated Name Handling** - Properly handles names like not-found
- ✅ **Comprehensive Error Recovery** - Multiple fallback mechanisms at every step

## Quick Start

```bash
# Install dependencies
npm install

# Extract props from component
npm start accordion
```

## Installation

```bash
# Clone this repository (optional)
git clone https://github.com/shadcn-community/props-extractor.git
cd props-extractor

# Install dependencies
npm install

# Extract props from a component by name
npm start accordion

# Extract props from a component by URL
npm start https://ui.shadcn.com/docs/components/accordion
```

## How It Works

1. **Component Installation**:
   - Uses shadcn CLI to install the component
   - Analyzes the installed files to detect dependencies
   - Automatically installs required dependencies like @radix-ui packages

2. **Dependency Detection**:
   - Scans imported packages in component files
   - Identifies Radix UI primitives and other dependencies
   - Automatically installs missing dependencies

3. **Primitive Type Handling**:
   - Generates proper imports for primitive types like AccordionPrimitive
   - Ensures TypeScript can properly resolve types for ComponentProps references

4. **Prop Type Extraction**:
   - Uses TypeScript AST analysis to extract type definitions
   - Handles component-specific subcomponents (like Accordion.Item)
   - Creates properly namespaced type interfaces for multi-part components

5. **Output Generation**:
   - Formats extracted types with proper imports
   - Creates comprehensive type definitions with JSDoc comments
   - Properly handles exports for all component parts

## Example Output

For a component like Accordion:

```typescript
import * as React from 'react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';

// From React type reference
type AccordionRootProps = React.ComponentProps<typeof AccordionPrimitive.Root>;

// From React type reference
type AccordionItemProps = React.ComponentProps<typeof AccordionPrimitive.Item>;

// From React type reference
type AccordionTriggerProps = React.ComponentProps<typeof AccordionPrimitive.Trigger>;

// From React type reference
type AccordionContentProps = React.ComponentProps<typeof AccordionPrimitive.Content>;

// Export all component types
export type {
  AccordionRootProps,
  AccordionItemProps,
  AccordionTriggerProps,
  AccordionContentProps
};
```

## Troubleshooting

If you encounter issues:

1. **Missing Dependencies**:
   - The script should automatically install required dependencies
   - If it fails, try installing manually: `npm install @radix-ui/react-accordion`

2. **Type Resolution Issues**:
   - Make sure the component is properly installed in your project
   - Try running `npx shadcn@latest add <component-name>` manually first

3. **Duplicate Types**:
   - The script now handles sub-components correctly by renaming them
   - Import the specific type you need from the generated file

## Requirements

- Node.js >= 14
- npm or yarn
- TypeScript project with shadcn components