import { exec, spawn } from 'child_process';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { Project, SyntaxKind, Node, TypeReferenceNode } from 'ts-morph';
import chalk from 'chalk';
import ora from 'ora';
import findUp from 'find-up';
import globPromise from 'glob-promise';
import { promisify } from 'util';
import logSymbols from 'log-symbols';
import prettier from 'prettier';
import kill from 'tree-kill';
import boxen from 'boxen';
import { paramCase, pascalCase } from 'change-case';
import fs_extra from 'fs-extra';
import execa from 'execa';
import { cosmiconfig } from 'cosmiconfig';
import Debug from 'debug';
import * as R from 'ramda';
import pluralize from 'pluralize';
import { v4 as uuid } from 'uuid';
import mem from 'mem';
import fastSafeStringify from 'fast-safe-stringify';
import * as pacote from 'pacote';
import { parse as parseImports } from 'es-module-lexer';

// Set up debug logging
const debug = Debug('shadcn:props');

// Maximum time to wait for operations (ms)
const OPERATION_TIMEOUT = 90000; // 90 seconds

const execPromise = promisify(exec);
const killPromise = promisify(kill);

// Used to track original component names for better error messages
const originalComponentNames = new Map<string, string>();

interface ComponentData {
  componentName: string;
  normalizedName: string;
  pascalName: string;
  subComponents: string[];
  dependencies: Set<string>;
  primitiveImports: Map<string, string>;
}

/**
 * Normalize component name to handle hyphenated names correctly
 */
function normalizeComponentName(input: string): ComponentData {
  // Extract name from URL if needed
  const componentName = input.startsWith('http') ? 
    input.split('/').pop()?.split(/[?#]/)[0] || input : 
    input;

  // Store original name for reference
  originalComponentNames.set(componentName, input);
  
  // Convert to kebab case for file searching
  const normalizedName = paramCase(componentName);
  
  // Convert to PascalCase for type names
  const pascalName = pascalCase(componentName);
  
  return { 
    componentName, 
    normalizedName, 
    pascalName,
    subComponents: [], // Will be populated during extraction
    dependencies: new Set<string>(), // Dependencies to install
    primitiveImports: new Map<string, string>() // Imports for primitives like AccordionPrimitive
  };
}

/**
 * Find the root directory of the project
 */
async function findProjectRoot(): Promise<string> {
  try {
    const packageJsonPath = await findUp('package.json');
    if (!packageJsonPath) {
      return process.cwd();
    }
    return path.dirname(packageJsonPath);
  } catch (error) {
    debug('Error finding project root:', error);
    return process.cwd();
  }
}

/**
 * Get package.json content
 */
async function getPackageJson(): Promise<any> {
  try {
    const projectRoot = await findProjectRoot();
    const packageJsonPath = path.join(projectRoot, 'package.json');
    
    if (existsSync(packageJsonPath)) {
      const content = await fs.readFile(packageJsonPath, 'utf8');
      return JSON.parse(content);
    }
    return null;
  } catch (error) {
    debug('Error reading package.json:', error);
    return null;
  }
}

/**
 * Get list of installed dependencies
 */
async function getInstalledDependencies(): Promise<string[]> {
  const packageJson = await getPackageJson();
  if (!packageJson) return [];
  
  const dependencies = packageJson.dependencies || {};
  const devDependencies = packageJson.devDependencies || {};
  
  return [...Object.keys(dependencies), ...Object.keys(devDependencies)];
}

/**
 * Execute a command with timeout and proper error handling
 */
function executeWithTimeout(command: string, args: string[], options: execa.Options = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const childProcess = execa(command, args, {
      ...options,
      timeout: OPERATION_TIMEOUT, // Add timeout to execa options
      stripFinalNewline: true
    });
    
    let output = '';
    
    childProcess.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      // Output installation progress
      if (text.trim() && !text.includes('npm WARN')) {
        process.stdout.write('.');
      }
    });
    
    childProcess.stderr?.on('data', (data) => {
      const text = data.toString();
      if (!text.includes('npm WARN') && !text.includes('deprecated')) {
        output += text;
      }
    });
    
    childProcess.then(() => {
      resolve(output);
    }).catch((error) => {
      // If it's a timeout error, provide clear feedback
      if (error.timedOut) {
        reject(new Error(`Command timed out after ${OPERATION_TIMEOUT / 1000} seconds: ${command} ${args.join(' ')}`));
      } else {
        reject(new Error(`Command failed: ${error.message}\nOutput: ${output}`));
      }
    });
  });
}

/**
 * Check if a shadcn component is already installed
 */
const isComponentInstalled = mem(async function(componentData: ComponentData): Promise<boolean> {
  try {
    const projectRoot = await findProjectRoot();
    const { normalizedName } = componentData;
    
    const potentialPaths = [
      path.join(projectRoot, 'components', 'ui', `${normalizedName}.tsx`),
      path.join(projectRoot, 'src', 'components', 'ui', `${normalizedName}.tsx`),
      path.join(projectRoot, 'components', 'ui', normalizedName, 'index.tsx'),
      path.join(projectRoot, 'src', 'components', 'ui', normalizedName, 'index.tsx')
    ];
    
    return potentialPaths.some(p => existsSync(p));
  } catch (error) {
    debug('Error checking if component is installed:', error);
    return false;
  }
}, { maxAge: 5000 });

/**
 * Install npm dependencies
 */
async function installDependencies(dependencies: string[]): Promise<void> {
  if (dependencies.length === 0) return;
  
  const spinner = ora(`Installing dependencies: ${dependencies.join(", ")}...`).start();
  
  try {
    await executeWithTimeout('npm', ['install', '--save', ...dependencies], {
      env: { ...process.env, FORCE_COLOR: 'true' }
    });
    spinner.succeed(`Successfully installed dependencies: ${dependencies.join(", ")}`);
  } catch (error) {
    spinner.warn(`Issues installing some dependencies: ${error instanceof Error ? error.message : String(error)}`);
    
    // Try installing one by one if batch installation fails
    for (const dep of dependencies) {
      try {
        spinner.text = `Installing ${dep}...`;
        await executeWithTimeout('npm', ['install', '--save', dep], {
          env: { ...process.env, FORCE_COLOR: 'true' }
        });
        spinner.succeed(`Installed ${dep}`);
      } catch (err) {
        spinner.fail(`Failed to install ${dep}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

/**
 * Install shadcn component using CLI with proper error handling
 */
async function installShadcnComponent(componentData: ComponentData): Promise<boolean> {
  const { componentName, normalizedName, pascalName } = componentData;
  const spinner = ora(`Installing ${componentName} component...`).start();

  // Check if already installed
  if (await isComponentInstalled(componentData)) {
    spinner.succeed(`Component ${componentName} appears to already be installed`);
    return true;
  }
  
  try {
    // Attempt to install with the modern CLI
    return await new Promise<boolean>((resolve) => {
      const childProcess = spawn('npx', ['--yes', 'shadcn@latest', 'add', normalizedName, '--yes'], {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      childProcess.stdin?.write('y\n');
      
      // Capture output to detect dependencies
      let output = '';
      childProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;
        
        // Auto-respond to any CLI prompts
        if (text.includes('?') || text.includes('Would you like')) {
          childProcess.stdin?.write('y\n');
        }
        
        // Parse for used dependencies
        if (text.includes('import') || text.includes('from')) {
          detectDependenciesFromText(text, componentData);
        }
      });
      
      // Set timeout to avoid hanging
      const timeoutId = setTimeout(() => {
        try {
          kill(childProcess.pid as number);
          spinner.warn(`Installation timed out after ${OPERATION_TIMEOUT/1000} seconds, will use fallback`);
          resolve(false);
        } catch (error) {
          spinner.warn(`Failed to kill timed out process`);
          resolve(false);
        }
      }, OPERATION_TIMEOUT);
      
      childProcess.on('close', (code) => {
        clearTimeout(timeoutId);
        
        if (code === 0) {
          spinner.succeed(`Successfully installed ${componentName}`);
          resolve(true);
        } else {
          spinner.warn(`Primary installation method failed with code ${code}, trying fallback...`);
          
          // Try alternative installation as fallback
          execa('npx', ['--yes', 'shadcn-ui@latest', 'add', normalizedName, '--yes'], {
            timeout: 30000,
          }).then((result) => {
            // Parse output for dependency detection
            if (result.stdout) {
              detectDependenciesFromText(result.stdout, componentData);
            }
            spinner.succeed(`Successfully installed ${componentName} using fallback method`);
            resolve(true);
          }).catch(() => {
            spinner.warn(`All installation methods failed for ${componentName}`);
            resolve(false);
          });
        }
      });
      
      childProcess.on('error', () => {
        clearTimeout(timeoutId);
        spinner.warn(`Installation error occurred, trying fallback...`);
        
        execa('npx', ['--yes', 'shadcn-ui@latest', 'add', normalizedName, '--yes'], {
          timeout: 30000,
        }).then((result) => {
          // Parse output for dependency detection
          if (result.stdout) {
            detectDependenciesFromText(result.stdout, componentData);
          }
          spinner.succeed(`Successfully installed ${componentName} using fallback method`);
          resolve(true);
        }).catch(() => {
          spinner.warn(`All installation methods failed for ${componentName}`);
          resolve(false);
        });
      });
    });
  } catch (error) {
    spinner.fail(`Failed to install component: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Detect dependencies from text output
 */
function detectDependenciesFromText(text: string, componentData: ComponentData): void {
  // Common Radix UI components patterns
  const radixPatterns = [
    { regex: /@radix-ui\/react-accordion/gi, dependency: '@radix-ui/react-accordion', primitive: 'AccordionPrimitive' },
    { regex: /@radix-ui\/react-alert-dialog/gi, dependency: '@radix-ui/react-alert-dialog', primitive: 'AlertDialogPrimitive' },
    { regex: /@radix-ui\/react-aspect-ratio/gi, dependency: '@radix-ui/react-aspect-ratio', primitive: 'AspectRatioPrimitive' },
    { regex: /@radix-ui\/react-avatar/gi, dependency: '@radix-ui/react-avatar', primitive: 'AvatarPrimitive' },
    { regex: /@radix-ui\/react-checkbox/gi, dependency: '@radix-ui/react-checkbox', primitive: 'CheckboxPrimitive' },
    { regex: /@radix-ui\/react-collapsible/gi, dependency: '@radix-ui/react-collapsible', primitive: 'CollapsiblePrimitive' },
    { regex: /@radix-ui\/react-context-menu/gi, dependency: '@radix-ui/react-context-menu', primitive: 'ContextMenuPrimitive' },
    { regex: /@radix-ui\/react-dialog/gi, dependency: '@radix-ui/react-dialog', primitive: 'DialogPrimitive' },
    { regex: /@radix-ui\/react-dropdown-menu/gi, dependency: '@radix-ui/react-dropdown-menu', primitive: 'DropdownMenuPrimitive' },
    { regex: /@radix-ui\/react-hover-card/gi, dependency: '@radix-ui/react-hover-card', primitive: 'HoverCardPrimitive' },
    { regex: /@radix-ui\/react-label/gi, dependency: '@radix-ui/react-label', primitive: 'LabelPrimitive' },
    { regex: /@radix-ui\/react-menubar/gi, dependency: '@radix-ui/react-menubar', primitive: 'MenubarPrimitive' },
    { regex: /@radix-ui\/react-navigation-menu/gi, dependency: '@radix-ui/react-navigation-menu', primitive: 'NavigationMenuPrimitive' },
    { regex: /@radix-ui\/react-popover/gi, dependency: '@radix-ui/react-popover', primitive: 'PopoverPrimitive' },
    { regex: /@radix-ui\/react-progress/gi, dependency: '@radix-ui/react-progress', primitive: 'ProgressPrimitive' },
    { regex: /@radix-ui\/react-radio-group/gi, dependency: '@radix-ui/react-radio-group', primitive: 'RadioGroupPrimitive' },
    { regex: /@radix-ui\/react-scroll-area/gi, dependency: '@radix-ui/react-scroll-area', primitive: 'ScrollAreaPrimitive' },
    { regex: /@radix-ui\/react-select/gi, dependency: '@radix-ui/react-select', primitive: 'SelectPrimitive' },
    { regex: /@radix-ui\/react-separator/gi, dependency: '@radix-ui/react-separator', primitive: 'SeparatorPrimitive' },
    { regex: /@radix-ui\/react-slider/gi, dependency: '@radix-ui/react-slider', primitive: 'SliderPrimitive' },
    { regex: /@radix-ui\/react-slot/gi, dependency: '@radix-ui/react-slot', primitive: 'Slot' },
    { regex: /@radix-ui\/react-switch/gi, dependency: '@radix-ui/react-switch', primitive: 'SwitchPrimitive' },
    { regex: /@radix-ui\/react-tabs/gi, dependency: '@radix-ui/react-tabs', primitive: 'TabsPrimitive' },
    { regex: /@radix-ui\/react-toast/gi, dependency: '@radix-ui/react-toast', primitive: 'ToastPrimitive' },
    { regex: /@radix-ui\/react-toggle/gi, dependency: '@radix-ui/react-toggle', primitive: 'TogglePrimitive' },
    { regex: /@radix-ui\/react-toggle-group/gi, dependency: '@radix-ui/react-toggle-group', primitive: 'ToggleGroupPrimitive' },
    { regex: /@radix-ui\/react-tooltip/gi, dependency: '@radix-ui/react-tooltip', primitive: 'TooltipPrimitive' },
  ];
  
  // Other common library patterns
  const otherPatterns = [
    { regex: /date-fns/gi, dependency: 'date-fns' },
    { regex: /react-day-picker/gi, dependency: 'react-day-picker' },
    { regex: /cmdk/gi, dependency: 'cmdk' },
    { regex: /next-themes/gi, dependency: 'next-themes' },
    { regex: /sonner/gi, dependency: 'sonner' },
    { regex: /tailwind-merge/gi, dependency: 'tailwind-merge' },
    { regex: /class-variance-authority/gi, dependency: 'class-variance-authority' },
  ];
  
  // Check for Radix UI dependencies
  radixPatterns.forEach(({ regex, dependency, primitive }) => {
    if (regex.test(text)) {
      componentData.dependencies.add(dependency);
      componentData.primitiveImports.set(primitive, dependency);
    }
  });
  
  // Check for other dependencies
  otherPatterns.forEach(({ regex, dependency }) => {
    if (regex.test(text)) {
      componentData.dependencies.add(dependency);
    }
  });
  
  // Try to parse any import statements directly
  try {
    const importLines = text
      .split('\n')
      .filter(line => line.includes('import') && line.includes('from'))
      .join('\n');
    
    if (importLines) {
      const [imports] = parseImports(importLines);
      imports.forEach(imp => {
        if (imp.n && imp.n.startsWith('@') && !imp.n.startsWith('@/')) {
          componentData.dependencies.add(imp.n);
          
          // Try to extract primitive name
          const primitiveName = extractPrimitiveName(imp.n);
          if (primitiveName) {
            componentData.primitiveImports.set(primitiveName, imp.n);
          }
        }
      });
    }
  } catch (error) {
    debug('Error parsing imports:', error);
  }
}

/**
 * Extract primitive name from package name
 */
function extractPrimitiveName(packageName: string): string | null {
  // E.g., @radix-ui/react-accordion -> AccordionPrimitive
  const match = packageName.match(/@radix-ui\/react-([a-z-]+)$/i);
  if (match && match[1]) {
    const baseName = match[1]
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
    return `${baseName}Primitive`;
  }
  return null;
}

/**
 * Create a fallback component file for extraction
 */
async function createFallbackComponent(componentData: ComponentData): Promise<string> {
  const { normalizedName, pascalName } = componentData;
  const stubDir = path.join(process.cwd(), '.temp-component');
  
  try {
    await fs_extra.ensureDir(stubDir);
  } catch (error) {
    debug('Failed to create temp directory:', error);
  }
  
  const stubFile = path.join(stubDir, `${normalizedName}.tsx`);
  
  try {
    await fs.writeFile(stubFile, `
import * as React from "react";

export interface ${pascalName}Props {
  /** Content of the ${pascalName} */
  children?: React.ReactNode;
  /** Optional CSS classes */
  className?: string;
  /** Whether the component is disabled */
  disabled?: boolean;
  /** Component variant */
  variant?: "default" | "destructive" | "outline" | "secondary";
}

export function ${pascalName}({ 
  children,
  className,
  disabled,
  variant = "default"
}: ${pascalName}Props) {
  return <div className={className}>{children}</div>;
}
`);
    return stubFile;
  } catch (error) {
    debug('Failed to create fallback file:', error);
    // Create in current directory as last resort
    const lastResortFile = path.join(process.cwd(), `${normalizedName}-default.tsx`);
    try {
      await fs.writeFile(lastResortFile, `
import * as React from "react";
export interface ${pascalName}Props {
  children?: React.ReactNode;
  className?: string;
}
`);
      return lastResortFile;
    } catch (err) {
      throw new Error(`Failed to create fallback file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Find all component files with comprehensive error handling
 */
async function findComponentFiles(componentData: ComponentData): Promise<string[]> {
  const { componentName, normalizedName, pascalName } = componentData;
  const spinner = ora(`Finding component files for ${componentName}...`).start();
  
  try {
    // Check temp directory first (for fallback files)
    const tempDir = path.join(process.cwd(), '.temp-component');
    if (existsSync(tempDir)) {
      const tempFiles = await globPromise(`${tempDir}/**/*.tsx`);
      if (tempFiles.length > 0) {
        spinner.succeed(`Found ${tempFiles.length} component files in temp directory`);
        return tempFiles;
      }
    }
    
    const projectRoot = await findProjectRoot();
    
    // Define possible file patterns - match both original name and pascal case
    const potentialPatterns = [
      `components/ui/${normalizedName}.tsx`,
      `components/ui/${normalizedName}/**/*.tsx`,
      `src/components/ui/${normalizedName}.tsx`,
      `src/components/ui/${normalizedName}/**/*.tsx`,
      `**/components/**/${normalizedName}.tsx`,
      `**/components/**/${normalizedName}/**/*.tsx`,
      // Also try pascal case variants
      `components/ui/${pascalName}.tsx`,
      `components/ui/${pascalName}/**/*.tsx`,
      `src/components/ui/${pascalName}.tsx`,
      `src/components/ui/${pascalName}/**/*.tsx`,
      `**/components/**/${pascalName}.tsx`,
      `**/components/**/${pascalName}/**/*.tsx`,
      // Try a more generic search as fallback
      `**/components/**/*${normalizedName}*.tsx`,
      `**/components/**/*${pascalName}*.tsx`,
    ];
    
    const allMatches: string[] = [];
    
    // Add parallel glob execution for faster results
    const results = await Promise.all(potentialPatterns.map(pattern => 
      globPromise(pattern, {
        cwd: projectRoot, 
        absolute: true,
        nocase: true // Case insensitive matching
      }).catch(_ => []) // Handle errors per pattern
    ));
    
    results.forEach(matches => allMatches.push(...matches));
    
    // Remove duplicates
    const uniqueMatches = Array.from(new Set(allMatches));
    
    if (uniqueMatches.length > 0) {
      spinner.succeed(`Found ${uniqueMatches.length} component files`);
      await extractDependenciesFromFiles(uniqueMatches, componentData, spinner);
      return uniqueMatches;
    }
    
    // Try finding recent files as a last resort
    try {
      let recentFiles: string[] = [];
      
      if (process.platform === 'win32') {
        // Windows - use PowerShell
        try {
          const { stdout } = await execa('powershell', [
            '-Command', 
            `Get-ChildItem -Path . -Recurse -Include *.tsx,*.jsx -File | Where-Object {$_.LastWriteTime -gt (Get-Date).AddMinutes(-10)} | Select-Object -ExpandProperty FullName`
          ], { timeout: 10000 });
          recentFiles = stdout.split('\n').filter(Boolean);
        } catch (error) {
          debug('PowerShell command failed:', error);
        }
      } else {
        // Unix-like systems - use find and sort
        try {
          const { stdout } = await execa('sh', [
            '-c',
            'find . -type f -name "*.tsx" -o -name "*.jsx" -mmin -10 | head -n 5'
          ], { timeout: 10000 });
          recentFiles = stdout.split('\n').filter(Boolean);
        } catch (error) {
          debug('Find command failed:', error);
        }
      }
      
      if (recentFiles.length > 0) {
        spinner.succeed(`Found ${recentFiles.length} recently modified files`);
        await extractDependenciesFromFiles(recentFiles, componentData, spinner);
        return recentFiles;
      }
    } catch (error) {
      debug('Error finding recent files:', error);
    }
    
    // Create a default file if nothing found
    const defaultPath = await createFallbackComponent(componentData);
    spinner.warn(`Created default component file: ${defaultPath}`);
    return [defaultPath];
  } catch (error) {
    spinner.fail(`Error finding component files: ${error instanceof Error ? error.message : String(error)}`);
    
    // Create fallback component as last resort
    try {
      const defaultPath = await createFallbackComponent(componentData);
      return [defaultPath];
    } catch (fallbackError) {
      spinner.fail(`Failed to create fallback component: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
      throw new Error(`Could not find or create component files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Extract dependencies from component files
 */
async function extractDependenciesFromFiles(files: string[], componentData: ComponentData, spinner: ora.Ora): Promise<void> {
  spinner.text = "Analyzing component dependencies...";
  
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf8');
      detectDependenciesFromText(content, componentData);
      
      // Extract primitive imports by analyzing file content
      extractPrimitiveImportsFromContent(content, componentData);
    } catch (error) {
      debug(`Error analyzing ${file}:`, error);
    }
  }
  
  // Add typical dependencies for specific component types
  addTypicalDependencies(componentData);
}

/**
 * Analyze file content to find primitive imports
 */
function extractPrimitiveImportsFromContent(content: string, componentData: ComponentData): void {
  const { pascalName } = componentData;
  
  // Look for primitive imports and usages
  const primitiveRegex = new RegExp(`import\\s+\\*\\s+as\\s+([A-Za-z0-9]+Primitive)\\s+from\\s+['"]([^'"]+)['"]`, 'g');
  let match;
  
  while ((match = primitiveRegex.exec(content)) !== null) {
    const primitiveName = match[1];
    const importPath = match[2];
    componentData.primitiveImports.set(primitiveName, importPath);
    
    // Add dependency if it's an npm package
    if (importPath.startsWith('@') || !importPath.startsWith('.')) {
      componentData.dependencies.add(importPath);
    }
  }
  
  // Look for references to primitives in the code
  const primitiveUsageRegex = new RegExp(`${pascalName}Primitive\\.([A-Za-z0-9]+)`, 'g');
  const rootPrimitiveRegex = new RegExp(`([A-Za-z0-9]+Primitive)\\.([A-Za-z0-9]+)`, 'g');
  
  // Check for component-specific primitive patterns
  while ((match = primitiveUsageRegex.exec(content)) !== null) {
    if (componentData.subComponents.indexOf(match[1]) === -1) {
      componentData.subComponents.push(match[1]);
    }
  }
  
  // Check for any primitive patterns
  while ((match = rootPrimitiveRegex.exec(content)) !== null) {
    const primitiveName = match[1];
    const subComponent = match[2];
    
    if (!componentData.primitiveImports.has(primitiveName)) {
      // Guess the import path based on common patterns
      const likelyPackage = guessRadixPackageFromPrimitive(primitiveName);
      if (likelyPackage) {
        componentData.primitiveImports.set(primitiveName, likelyPackage);
        componentData.dependencies.add(likelyPackage);
      }
    }
    
    if (componentData.subComponents.indexOf(subComponent) === -1) {
      componentData.subComponents.push(subComponent);
    }
  }
}

/**
 * Guess Radix package name from primitive name
 */
function guessRadixPackageFromPrimitive(primitiveName: string): string | null {
  // AccordionPrimitive -> @radix-ui/react-accordion
  const baseNameMatch = primitiveName.match(/^([A-Za-z]+)Primitive$/);
  if (baseNameMatch && baseNameMatch[1]) {
    const baseName = baseNameMatch[1].toLowerCase();
    return `@radix-ui/react-${baseName}`;
  }
  return null;
}

/**
 * Add typical dependencies for specific component types
 */
function addTypicalDependencies(componentData: ComponentData): void {
  const { normalizedName, pascalName } = componentData;
  const lowerName = normalizedName.toLowerCase();
  
  // Add specific dependencies based on component type
  if (lowerName === 'accordion') {
    componentData.dependencies.add('@radix-ui/react-accordion');
    componentData.primitiveImports.set('AccordionPrimitive', '@radix-ui/react-accordion');
  } 
  else if (lowerName === 'alert-dialog') {
    componentData.dependencies.add('@radix-ui/react-alert-dialog');
    componentData.primitiveImports.set('AlertDialogPrimitive', '@radix-ui/react-alert-dialog');
  }
  else if (lowerName === 'checkbox') {
    componentData.dependencies.add('@radix-ui/react-checkbox');
    componentData.primitiveImports.set('CheckboxPrimitive', '@radix-ui/react-checkbox');
  }
  else if (lowerName === 'dialog' || lowerName === 'drawer') {
    componentData.dependencies.add('@radix-ui/react-dialog');
    componentData.primitiveImports.set('DialogPrimitive', '@radix-ui/react-dialog');
  }
  else if (lowerName === 'dropdown-menu') {
    componentData.dependencies.add('@radix-ui/react-dropdown-menu');
    componentData.primitiveImports.set('DropdownMenuPrimitive', '@radix-ui/react-dropdown-menu');
  }
  else if (lowerName === 'tabs') {
    componentData.dependencies.add('@radix-ui/react-tabs');
    componentData.primitiveImports.set('TabsPrimitive', '@radix-ui/react-tabs');
  }
  
  // Add common sub-components for known components
  if (lowerName === 'accordion' && componentData.subComponents.length === 0) {
    componentData.subComponents = ['Root', 'Item', 'Trigger', 'Content'];
  }
  else if (lowerName === 'dialog' && componentData.subComponents.length === 0) {
    componentData.subComponents = ['Root', 'Trigger', 'Content', 'Header', 'Footer', 'Title', 'Description'];
  }
}

/**
 * Check if a type name appears to be props-related
 */
function isPropsType(name: string, componentData: ComponentData): boolean {
  const { componentName, normalizedName, pascalName } = componentData;
  
  // Also check for prop names using both original and normalized versions
  const lowerName = name.toLowerCase();
  const lowerComponentName = componentName.toLowerCase();
  const lowerNormalizedName = normalizedName.toLowerCase();
  const lowerPascalName = pascalName.toLowerCase();
  
  return (
    name.includes('Props') ||
    lowerName === 'props' ||
    (lowerName.includes('props') && 
      (lowerName.includes(lowerComponentName) || 
       lowerName.includes(lowerNormalizedName) || 
       lowerName.includes(lowerPascalName)))
  );
}

/**
 * Extract sub-component name from a type reference
 */
function extractSubComponentName(text: string): string | null {
  // Match patterns like "AccordionPrimitive.Root" or "DialogPrimitive.Content"
  const match = text.match(/\.([A-Za-z]+)(?:>|,|\s|$)/);
  if (match && match[1]) {
    return match[1]; // Return the captured group (e.g., "Root", "Content")
  }
  return null;
}

/**
 * Detect duplicate prop type names and create unique names
 * for different subcomponents
 */
function deduplicateAndNameProps(foundProps: {text: string, subComponent: string | null}[], 
                                componentData: ComponentData): string[] {
  const { pascalName } = componentData;
  const baseTypeName = `${pascalName}Props`;
  const result: string[] = [];
  
  // No need to deduplicate if there's only one prop
  if (foundProps.length <= 1) {
    return foundProps.map(p => p.text);
  }
  
  // Count occurrences of each sub-component
  const subComponentCounts: Record<string, number> = {};
  foundProps.forEach(prop => {
    const subComponent = prop.subComponent || 'Main';
    subComponentCounts[subComponent] = (subComponentCounts[subComponent] || 0) + 1;
  });
  
  // If we have duplicate sub-components, add them to our component data
  Object.keys(subComponentCounts)
    .filter(key => key !== 'Main')
    .forEach(subComp => {
      if (!componentData.subComponents.includes(subComp)) {
        componentData.subComponents.push(subComp);
      }
    });
  
  // Group props by their sub-component type
  const propsBySubComponent: Record<string, string[]> = {};
  foundProps.forEach(prop => {
    const subComponent = prop.subComponent || 'Main';
    if (!propsBySubComponent[subComponent]) {
      propsBySubComponent[subComponent] = [];
    }
    propsBySubComponent[subComponent].push(prop.text);
  });
  
  // For each sub-component, rename the prop types appropriately
  Object.entries(propsBySubComponent).forEach(([subComponent, props]) => {
    // If it's the main component or only one prop per sub-component, use the base name
    if (subComponent === 'Main' || Object.keys(propsBySubComponent).length === 1) {
      props.forEach(prop => {
        result.push(prop);
      });
    } else {
      // Otherwise rename to include the sub-component name
      props.forEach(prop => {
        const renamed = prop.replace(
          new RegExp(`(type|interface)\\s+${pascalName}Props`), 
          `$1 ${pascalName}${subComponent}Props`
        );
        result.push(renamed);
      });
    }
  });
  
  return result;
}

/**
 * Extract props from a TypeScript file using ts-morph
 */
async function extractPropsFromFile(file: string, componentData: ComponentData): Promise<string[]> {
  const { componentName, pascalName } = componentData;
  const spinner = ora(`Extracting props from ${path.basename(file)}...`).start();
  
  try {
    // Use ts-morph for TypeScript AST analysis
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        jsx: 4, // React-JSX
      }
    });
    
    const sourceFile = project.addSourceFileAtPath(file);
    
    // Track found props with their sub-component information
    const foundProps: {text: string, subComponent: string | null}[] = [];
    
    // Check interfaces
    sourceFile.getInterfaces().forEach(iface => {
      const name = iface.getName();
      if (isPropsType(name, componentData)) {
        const text = iface.getText();
        // Fix hyphenated names in the extracted code
        const fixedText = text.replace(
          new RegExp(`${componentName}Props`, 'g'), 
          `${pascalName}Props`
        );
        foundProps.push({ text: fixedText, subComponent: null });
      }
    });
    
    // Check type aliases
    sourceFile.getTypeAliases().forEach(type => {
      const name = type.getName();
      if (isPropsType(name, componentData)) {
        const text = type.getText();
        // Fix hyphenated names in the extracted code
        const fixedText = text.replace(
          new RegExp(`${componentName}Props`, 'g'), 
          `${pascalName}Props`
        );
        foundProps.push({ text: fixedText, subComponent: null });
      }
    });
    
    // Check for exported declarations with "Props" in the name
    const exportedDeclarations = sourceFile.getExportedDeclarations();
    exportedDeclarations.forEach((declarations, name) => {
      if (isPropsType(name, componentData)) {
        declarations.forEach(declaration => {
          const text = declaration.getText();
          // Fix hyphenated names in the extracted code
          const fixedText = text.replace(
            new RegExp(`${componentName}Props`, 'g'), 
            `${pascalName}Props`
          );
          foundProps.push({ text: fixedText, subComponent: null });
        });
      }
    });
    
    // Look for type references containing "ComponentProps"
    sourceFile.forEachDescendantAsArray().forEach(node => {
      if (node.getKind() === SyntaxKind.TypeReference) {
        const text = node.getText();
        if (
          text.includes('ComponentProps<') ||
          text.includes('ComponentPropsWithRef<') ||
          text.includes('ComponentPropsWithoutRef<')
        ) {
          // Extract sub-component information
          const subComponent = extractSubComponentName(text);
          
          // Use PascalCase for the type name
          const propType = `// From React type reference
type ${pascalName}${subComponent ? subComponent : ''}Props = ${text};`;
          
          foundProps.push({ text: propType, subComponent });
        }
      }
    });
    
    // Check HTML attribute types
    sourceFile.forEachDescendantAsArray().forEach(node => {
      if (node.getKind() === SyntaxKind.TypeReference) {
        const text = node.getText();
        if (
          text.includes('HTMLAttributes<') ||
          text.includes('HTMLProps<')
        ) {
          // Use PascalCase for the type name
          const propType = `// From HTML attributes
type ${pascalName}Props = ${text};`;
          
          foundProps.push({ text: propType, subComponent: null });
        }
      }
    });
    
    if (foundProps.length === 0) {
      // If no props found with AST analysis, try regex as fallback
      const code = await fs.readFile(file, 'utf8');
      
      // Interface Props pattern
      const interfaceRegex = new RegExp(`(export\\s+)?interface\\s+([A-Za-z0-9_]*Props[A-Za-z0-9_]*)\\s*(?:extends\\s+[^{]+)?\\s*\\{[^}]*\\}`, 'g');
      let match;
      while ((match = interfaceRegex.exec(code)) !== null) {
        const name = match[2];
        if (isPropsType(name, componentData)) {
          foundProps.push({ text: match[0], subComponent: null });
        }
      }
      
      // Type Props pattern
      const typeRegex = new RegExp(`(export\\s+)?type\\s+([A-Za-z0-9_]*Props[A-Za-z0-9_]*)\\s*=\\s*([^;]+);`, 'g');
      while ((match = typeRegex.exec(code)) !== null) {
        const name = match[2];
        if (isPropsType(name, componentData)) {
          foundProps.push({ text: match[0], subComponent: null });
        }
      }
      
      // React.ComponentProps pattern
      const componentPropsRegex = /ComponentProps<([^>]+)>/g;
      while ((match = componentPropsRegex.exec(code)) !== null) {
        const subComponent = extractSubComponentName(match[1]);
        foundProps.push({
          text: `// From React type reference
type ${pascalName}${subComponent ? subComponent : ''}Props = ${match[0]};`,
          subComponent
        });
      }
      
      // Also extract imports to detect dependencies
      detectDependenciesFromText(code, componentData);
    }
    
    // Deduplicate and rename props for sub-components
    const processedProps = deduplicateAndNameProps(foundProps, componentData);
    
    if (processedProps.length > 0) {
      spinner.succeed(`Found ${processedProps.length} prop types in ${path.basename(file)}`);
    } else {
      spinner.warn(`No prop types found in ${path.basename(file)}`);
    }
    
    return processedProps;
  } catch (error) {
    spinner.fail(`Error extracting props from ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Create component-specific default props interface
 */
function createDefaultPropsInterface(componentData: ComponentData): string[] {
  const { componentName, pascalName, subComponents } = componentData;
  const lowerName = componentName.toLowerCase();
  
  // If we have sub-components, create specialized interfaces for each
  if (subComponents.length > 0) {
    const results: string[] = [];
    
    // Create base (root) props
    results.push(createSingleComponentProps(componentData, null));
    
    // Create props for each sub-component
    subComponents.forEach(subComponent => {
      const subComponentProps = createSingleComponentProps(componentData, subComponent);
      results.push(subComponentProps);
    });
    
    return results;
  }
  
  // Otherwise just create a single interface
  return [createSingleComponentProps(componentData, null)];
}

/**
 * Create props for a specific component or sub-component
 */
function createSingleComponentProps(componentData: ComponentData, subComponent: string | null): string {
  const { componentName, pascalName } = componentData;
  const lowerName = componentName.toLowerCase();
  
  let typeName = `${pascalName}Props`;
  let description = `Default props interface for ${pascalName}`;
  
  if (subComponent) {
    typeName = `${pascalName}${subComponent}Props`;
    description = `Props for ${pascalName} ${subComponent} sub-component`;
  }
  
  // Component-specific props based on name and subcomponent
  let specificProps = '';
  
  // Props based on component type
  if (lowerName.includes('button')) {
    specificProps = `
  /** Button variant */
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  
  /** Button size */
  size?: "default" | "sm" | "lg" | "icon";
  
  /** Whether the button is disabled */
  disabled?: boolean;
  
  /** Click handler */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;`;
  } 
  else if (lowerName.includes('accordion')) {
    if (!subComponent || subComponent === 'Root') {
      specificProps = `
  /** Whether accordion can have multiple items open */
  type?: "single" | "multiple";
  
  /** Default active value */
  defaultValue?: string | string[];
  
  /** Callback when value changes */
  onValueChange?: (value: string | string[]) => void;
  
  /** Whether accordion items are collapsible */
  collapsible?: boolean;`;
    } 
    else if (subComponent === 'Item') {
      specificProps = `
  /** Value of this accordion item */
  value: string;
  
  /** Whether this item is disabled */
  disabled?: boolean;`;
    }
    else if (subComponent === 'Trigger') {
      specificProps = `
  /** Whether trigger is disabled */
  disabled?: boolean;
  
  /** Accessibility label */
  asChild?: boolean;`;
    }
    else if (subComponent === 'Content') {
      specificProps = `
  /** Whether to force mounting when closed (for SEO/accessibility) */
  forceMount?: boolean;`;
    }
  }
  else if (lowerName.includes('dialog') || lowerName.includes('modal') || lowerName.includes('drawer')) {
    if (!subComponent || subComponent === 'Root') {
      specificProps = `
  /** Whether the dialog is open */
  open?: boolean;
  
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;`;
    }
    else if (subComponent === 'Content') {
      specificProps = `
  /** Whether to force mounting when closed */
  forceMount?: boolean;
  
  /** Side from which dialog appears */
  side?: "left" | "right" | "top" | "bottom";`;
    }
  }
  else if (lowerName.includes('form')) {
    specificProps = `
  /** Form submission handler */
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  
  /** Form validation schema */
  defaultValues?: Record<string, any>;`;
  }
  else if (lowerName.includes('select') || lowerName.includes('dropdown')) {
    specificProps = `
  /** Currently selected value */
  value?: string | number;
  
  /** Callback when selection changes */
  onValueChange?: (value: string | number) => void;
  
  /** Placeholder text */
  placeholder?: string;`;
  }
  else if (lowerName.includes('input')) {
    specificProps = `
  /** Input type */
  type?: string;
  
  /** Current input value */
  value?: string;
  
  /** Callback when value changes */
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  
  /** Placeholder text */
  placeholder?: string;`;
  }
  else if (lowerName.includes('card')) {
    specificProps = `
  /** Whether to show a border */
  bordered?: boolean;
  
  /** Card appearance variant */
  variant?: "default" | "secondary" | "outline";`;
  }
  else if (lowerName.includes('not-found')) {
    specificProps = `
  /** Title to display */
  title?: string;
  
  /** Description message */
  description?: string;
  
  /** URL to redirect to when user clicks "Home" */
  homeUrl?: string;
  
  /** Custom action button text */
  buttonText?: string;
  
  /** Handler for action button */
  onAction?: () => void;`;
  }
  
  return `// ${description}
export interface ${typeName} {
  /** The content to render inside the component */
  children?: React.ReactNode;
  
  /** Additional CSS classes to apply to the component */
  className?: string;${specificProps}
  
  /** Additional HTML attributes */
  [key: string]: any;
}`;
}

/**
 * Generate import statements for component props including primitive imports
 */
function generateImports(componentData: ComponentData): string {
  // Base import for React
  let imports = `import * as React from 'react';\n`;
  
  // Add imports for primitives
  if (componentData.primitiveImports.size > 0) {
    imports += '\n// Import primitive components used in types\n';
    
    componentData.primitiveImports.forEach((packageName, primitiveName) => {
      imports += `import * as ${primitiveName} from "${packageName}";\n`;
    });
    
    imports += '\n';
  }
  
  return imports;
}

/**
 * Format TypeScript code using prettier with error handling
 */
async function formatCode(code: string, pascalName: string): Promise<string> {
  try {
    // Try to load prettier config from project
    const explorer = cosmiconfig('prettier');
    const result = await explorer.search();
    const options = result?.config || {};

    // Format with prettier
    return prettier.format(code, {
      ...options,
      parser: 'typescript',
      semi: true,
      singleQuote: true,
      printWidth: 100,
      tabWidth: 2,
    });
  } catch (error) {
    debug('Error formatting code:', error);

    // Basic fix for invalid identifiers with hyphens
    // Replace problematic identifiers like "not-foundProps" with PascalCase
    let fixedCode = code;
    try {
      const regex = new RegExp(`([a-zA-Z0-9_-]+)-([a-zA-Z0-9_-]+)Props`, 'g');
      fixedCode = code.replace(regex, `${pascalName}Props`);
    } catch (fixError) {
      debug('Error fixing hyphenated prop names:', fixError);
    }
    
    return fixedCode;
  }
}

/**
 * Generate type exports for sub-component types
 */
function generateTypeExports(componentData: ComponentData): string {
  const { pascalName, subComponents } = componentData;
  
  // If no subcomponents, don't generate exports
  if (subComponents.length === 0) {
    return '';
  }
  
  let exports = `\n// Export all component types
export type {\n`;
  
  // Add main component props
  exports += `  ${pascalName}Props,\n`;
  
  // Add sub-component props
  subComponents.forEach(sub => {
    exports += `  ${pascalName}${sub}Props,\n`;
  });
  
  exports = exports.slice(0, -2) + '\n};';
  
  return exports;
}

/**
 * Process all component files and extract props
 */
async function extractComponentProps(componentData: ComponentData): Promise<string> {
  const { pascalName, dependencies } = componentData;
  
  try {
    const files = await findComponentFiles(componentData);
    const allProps: string[] = [];
    
    // Install dependencies before continuing
    if (dependencies.size > 0) {
      const installedDeps = await getInstalledDependencies();
      const missingDeps = [...dependencies].filter(dep => !installedDeps.includes(dep));
      
      if (missingDeps.length > 0) {
        await installDependencies(missingDeps);
      }
    }
    
    // Process each file
    for (const file of files) {
      try {
        const fileProps = await extractPropsFromFile(file, componentData);
        allProps.push(...fileProps);
      } catch (error) {
        debug(`Could not process ${file}:`, error);
        console.error(chalk.yellow(`Warning: Could not process ${file}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
    
    if (allProps.length === 0) {
      // If no props were found, create default interfaces
      const defaultProps = createDefaultPropsInterface(componentData);
      allProps.push(...defaultProps);
    }
    
    // Deduplicate props by converting to string and back
    const uniqueProps = R.uniqBy(
      R.identity, 
      allProps
    );
    
    // Generate imports and type exports
    const imports = generateImports(componentData);
    const typeExports = generateTypeExports(componentData);
    
    const rawCode = imports + uniqueProps.join('\n\n') + typeExports;
    
    // Format the code with proper type naming
    return formatCode(rawCode, pascalName);
  } catch (error) {
    debug('Error in extractComponentProps:', error);
    console.error(chalk.red(`Error extracting props: ${error instanceof Error ? error.message : String(error)}`));
    
    // Even on error, return a default props interface
    const defaultProps = createDefaultPropsInterface(componentData);
    const defaultInterface = `import * as React from 'react';\n\n${defaultProps.join('\n\n')}`;
    return formatCode(defaultInterface, pascalName);
  }
}

/**
 * Save props to TypeScript file
 */
async function savePropTypes(propsText: string, componentData: ComponentData): Promise<string> {
  const { pascalName } = componentData;
  const fileName = `${pascalName}Props.ts`;
  
  try {
    await fs.writeFile(fileName, propsText, 'utf-8');
    console.log(chalk.green(`${logSymbols.success} Props saved to ${chalk.bold(fileName)}`));
    return fileName;
  } catch (error) {
    debug('Error saving to file:', error);
    console.error(chalk.red(`Error saving to file: ${error instanceof Error ? error.message : String(error)}`));
    
    // Try to save with a different name as fallback
    try {
      const tempFileName = `props-${pascalName}-${Date.now()}.ts`;
      await fs.writeFile(tempFileName, propsText, 'utf-8');
      console.log(chalk.yellow(`${logSymbols.warning} Props saved to fallback file ${chalk.bold(tempFileName)}`));
      return tempFileName;
    } catch (fallbackError) {
      // If all attempts fail, output to console
      console.error(chalk.red(`${logSymbols.error} Failed to save file to disk. Showing content instead:`));
      console.log(chalk.gray('-----------------------------------'));
      console.log(propsText);
      console.log(chalk.gray('-----------------------------------'));
      
      throw new Error(`Failed to save props to file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Clean up temporary files
 */
async function cleanupTempFiles(): Promise<void> {
  try {
    const tempDir = path.join(process.cwd(), '.temp-component');
    if (existsSync(tempDir)) {
      await fs_extra.remove(tempDir);
    }
    
    // Also remove any default files we created
    const defaultFiles = await globPromise(`${process.cwd()}/*-default.tsx`);
    for (const file of defaultFiles) {
      await fs.unlink(file);
    }
  } catch (error) {
    debug('Could not clean up temporary files:', error);
    console.error(chalk.yellow(`Note: Could not clean up temporary files: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/**
 * Main workflow function with comprehensive error handling
 */
async function main(componentNameOrUrl: string): Promise<void> {
  console.log(boxen(chalk.blue.bold('Shadcn Component Props Extractor'), { 
    padding: 1, 
    margin: 1,
    borderStyle: 'round' 
  }));
  console.log(chalk.gray(`Running on ${new Date().toISOString()}\n`));
  
  // Set global timeout
  let timeoutId: NodeJS.Timeout | null = setTimeout(() => {
    console.error(chalk.red(`\n${logSymbols.error} Process timed out after ${OPERATION_TIMEOUT/1000} seconds`));
    console.log(chalk.yellow('Try running the steps manually:'));
    console.log(`1. npx shadcn@latest add <component-name> --yes`);
    console.log(`2. Look for the component files and check their prop types`);
    process.exit(1);
  }, OPERATION_TIMEOUT);
  
  try {
    if (!componentNameOrUrl) {
      throw new Error('No component name or URL provided');
    }
    
    // Normalize component name
    const componentData = normalizeComponentName(componentNameOrUrl);
    
    // Install component (this step may be skipped if component exists)
    await installShadcnComponent(componentData);
    
    // Extract props
    const propsText = await extractComponentProps(componentData);
    
    // Save to file
    const fileName = await savePropTypes(propsText, componentData);
    
    // Clear timeout since we're done
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    // Clean up
    await cleanupTempFiles();
    
    // Display success and preview
    console.log('\n' + boxen(chalk.green.bold(' SUCCESS '), { 
      padding: 0, 
      margin: 0,
      borderStyle: 'round' 
    }) + ' Process completed successfully!\n');
    
    console.log(chalk.yellow('File preview:'));
    
    // Show file preview
    let fileContent: string;
    try {
      fileContent = await fs.readFile(fileName, 'utf-8');
    } catch (readError) {
      debug('Error reading saved file:', readError);
      fileContent = propsText;
    }
    
    const previewLines = fileContent.split('\n').slice(0, 15);
    console.log(chalk.cyan('-----------------------------------'));
    console.log(previewLines.join('\n'));
    if (fileContent.split('\n').length > 15) {
      console.log(chalk.gray('... (more lines in the file)'));
    }
    console.log(chalk.cyan('-----------------------------------'));
    
    // Provide import example
    const { componentName, normalizedName, pascalName, subComponents } = componentData;
    
    console.log(chalk.green('\nHow to use:'));
    console.log(chalk.white(`import { ${pascalName} } from "@/components/ui/${normalizedName}";`));
    
    if (subComponents.length > 0) {
      console.log(chalk.white(`import { 
  ${pascalName}Props, 
  ${subComponents.map(sub => `${pascalName}${sub}Props`).join(',\n  ')}
} from "./${path.basename(fileName)}";`));
    } else {
      console.log(chalk.white(`import type { ${pascalName}Props } from "./${path.basename(fileName)}";`));
    }
    
  } catch (error) {
    debug('Error in main function:', error);
    // Clear timeout if we're handling an error
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    console.error(chalk.red(`\n${logSymbols.error} Error: ${error instanceof Error ? error.message : String(error)}`));
    console.log(chalk.yellow('\nTroubleshooting tips:'));
    console.log('1. Check if the component name is correct');
    console.log('2. Make sure shadcn is properly installed in your project');
    console.log('3. Try running `npx shadcn@latest add <component-name> --yes` manually');
    
    // Try to clean up even on error
    try {
      await cleanupTempFiles();
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    process.exit(1);
  }
}

// Run if called directly from CLI
if (require.main === module) {
  if (process.argv.length < 3) {
    console.error(chalk.red(`${logSymbols.error} Please provide a shadcn component URL or name`));
    console.log(`Usage: ${chalk.cyan('npm start <component-name-or-url>')}`);
    console.log(`Example: ${chalk.cyan('npm start accordion')}`);
    console.log(`Example: ${chalk.cyan('npm start https://ui.shadcn.com/docs/components/accordion')}`);
    process.exit(1);
  }

  main(process.argv[2]).catch(error => {
    debug('Unhandled error:', error);
    console.error(chalk.red(`${logSymbols.error} Unhandled error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  });
}

export { 
  normalizeComponentName,
  installShadcnComponent,
  findComponentFiles,
  extractPropsFromFile,
  extractComponentProps,
  savePropTypes,
  main
};