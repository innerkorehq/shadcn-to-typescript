#!/usr/bin/env node
/**
 * Command-line interface for the shadcn props extractor
 */

import { program } from 'commander';
import chalk from 'chalk';
import { main } from './get-shadcn-props';
import boxen from 'boxen';
import ora from 'ora';
import { ComponentDependencies, getComponentDependencies } from './component-registry';

// Configure the CLI
program
  .name('shadcn-props')
  .version('1.0.0')
  .description('Extract TypeScript prop types from shadcn components')
  .argument('<component>', 'Component name or URL (e.g., "accordion" or a URL)')
  .option('-d, --deps-only', 'Only detect dependencies, do not install')
  .option('-n, --no-cleanup', 'Do not clean up temporary files')
  .option('-v, --verbose', 'Show verbose output')
  .option('-r, --registry', 'Show component registry information')
  .option('-c, --component-id <id>', 'Component ID to update in the database')
  .action(async (componentNameOrUrl: string, options) => {
    if (options.verbose) {
      process.env.DEBUG = 'shadcn:*';
    }
    
    if (options.registry) {
      showComponentInfo(componentNameOrUrl);
      return;
    }
    
    try {
      await main(componentNameOrUrl, {
        depsOnly: options.depsOnly,
        cleanup: options.cleanup !== false,
        componentId: options.componentId
      });
    } catch (error) {
      console.error(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`));
      process.exit(1);
    }
  });

/**
 * Display detailed component information from registry
 */
function showComponentInfo(componentName: string): void {
  const info: ComponentDependencies | null = getComponentDependencies(componentName);
  
  if (!info) {
    console.log(chalk.yellow(`No registry information found for component: ${componentName}`));
    return;
  }
  
  console.log(boxen(chalk.blue.bold(`Component: ${componentName}`), {
    padding: 1,
    margin: 0,
    borderStyle: 'round'
  }));
  
  console.log(chalk.cyan('Dependencies:'));
  if (info.package) {
    console.log(`- ${info.package} (primary)`);
  }
  
  if (info.additionalDeps && info.additionalDeps.length) {
    info.additionalDeps.forEach(dep => {
      console.log(`- ${dep}`);
    });
  }
  
  if (!info.package && (!info.additionalDeps || !info.additionalDeps.length)) {
    console.log(chalk.gray('No external dependencies needed'));
  }
  
  if (info.primitive) {
    console.log(`\n${chalk.cyan('Primitive:')} ${info.primitive}`);
  }
  
  if (info.subComponents && info.subComponents.length) {
    console.log(`\n${chalk.cyan('Sub-components:')}`);
    info.subComponents.forEach(sub => {
      console.log(`- ${sub}`);
    });
  }
}

// Parse command line arguments
program.parse();