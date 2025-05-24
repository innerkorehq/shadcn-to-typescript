/**
 * Dependency manager for handling component dependencies
 * Detects and installs required packages for shadcn components
 */

import execa from 'execa';
import ora from 'ora';
import chalk from 'chalk';
import { getComponentDependencies } from './component-registry';
import { promises as fs } from 'fs';
import path from 'path';
import findUp from 'find-up';
import Debug from 'debug';
import semver from 'semver';
import prompts from 'prompts';

const debug = Debug('shadcn:deps');

/**
 * Interface for dependency management
 */
export interface DependencyManager {
  detectDependencies(componentName: string): Promise<string[]>;
  installDependencies(dependencies: string[]): Promise<boolean>;
  checkInstalledDependencies(dependencies: string[]): Promise<{
    installed: string[];
    missing: string[];
  }>;
}

/**
 * Get package.json content
 */
async function getPackageJson(): Promise<any> {
  try {
    const pkgPath = await findUp('package.json');
    if (!pkgPath) return null;
    
    const content = await fs.readFile(pkgPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    debug('Error reading package.json:', error);
    return null;
  }
}

/**
 * Implementation of dependency manager for shadcn components
 */
export class ShadcnDependencyManager implements DependencyManager {
  
  /**
   * Detect dependencies for a component
   */
  async detectDependencies(componentName: string): Promise<string[]> {
    const spinner = ora(`Detecting dependencies for ${componentName}...`).start();
    
    try {
      // Check component registry first
      const registryDeps = getComponentDependencies(componentName);
      
      if (registryDeps) {
        const deps = [
          // Only add package if it exists (not empty string)
          ...(registryDeps.package ? [registryDeps.package] : []),
          ...(registryDeps.additionalDeps || [])
        ].filter(Boolean);
        
        spinner.succeed(`Found ${deps.length} dependencies for ${componentName}`);
        return deps;
      }
      
      spinner.info(`No pre-defined dependencies found for ${componentName}`);
      return [];
      
    } catch (error) {
      spinner.fail(`Error detecting dependencies: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Check which dependencies are already installed
   */
  async checkInstalledDependencies(dependencies: string[]): Promise<{
    installed: string[];
    missing: string[];
  }> {
    const pkg = await getPackageJson();
    
    if (!pkg) {
      return { installed: [], missing: dependencies };
    }
    
    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {})
    };
    
    const installed = dependencies.filter(dep => dep in allDeps);
    const missing = dependencies.filter(dep => !(dep in allDeps));
    
    return { installed, missing };
  }
  
  /**
   * Install missing dependencies
   */
  async installDependencies(dependencies: string[]): Promise<boolean> {
    if (!dependencies.length) return true;
    
    const { installed, missing } = await this.checkInstalledDependencies(dependencies);
    
    if (missing.length === 0) {
      console.log(chalk.green(`✓ All dependencies already installed: ${installed.join(', ')}`));
      return true;
    }
    
    const spinner = ora(`Installing dependencies: ${missing.join(', ')}...`).start();
    
    try {
      // Ask user for confirmation (auto-confirm in CI)
      if (!process.env.CI && process.stdin.isTTY) {
        spinner.stop();
        
        // Prompt limited to 5 seconds to avoid hanging
        const timeoutPrompt = async () => {
          return await Promise.race([
            prompts({
              type: 'confirm',
              name: 'install',
              message: `Install missing dependencies? (${missing.join(', ')})`,
              initial: true
            }),
            new Promise(resolve => setTimeout(() => resolve({ install: true }), 5000))
          ]);
        };
        
        const { install } = await timeoutPrompt();
        if (!install) {
          console.log(chalk.yellow(`⚠️ Dependencies not installed. You may need to manually install: ${missing.join(', ')}`));
          return false;
        }
        
        spinner.start(`Installing dependencies: ${missing.join(', ')}...`);
      }
      
      // Determine package manager
      const hasYarnLock = await findUp('yarn.lock');
      const packageManager = hasYarnLock ? 'yarn' : 'npm';
      
      if (packageManager === 'yarn') {
        await execa('yarn', ['add', ...missing], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } else {
        await execa('npm', ['install', '--save', ...missing], {
          stdio: ['ignore', 'pipe', 'pipe']
        });
      }
      
      spinner.succeed(`Successfully installed dependencies: ${missing.join(', ')}`);
      return true;
    } catch (error) {
      spinner.fail(`Failed to install dependencies: ${error instanceof Error ? error.message : String(error)}`);
      
      // Try installing one by one as fallback
      let anySuccess = false;
      
      for (const dep of missing) {
        try {
          const depSpinner = ora(`Installing ${dep} individually...`).start();
          
          if (await this.installSingleDependency(dep)) {
            depSpinner.succeed(`Installed ${dep}`);
            anySuccess = true;
          } else {
            depSpinner.fail(`Failed to install ${dep}`);
          }
        } catch (err) {
          console.error(chalk.red(`Error installing ${dep}: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
      
      return anySuccess;
    }
  }
  
  /**
   * Install a single dependency
   */
  private async installSingleDependency(dependency: string): Promise<boolean> {
    try {
      // Determine package manager
      const hasYarnLock = await findUp('yarn.lock');
      const packageManager = hasYarnLock ? 'yarn' : 'npm';
      
      if (packageManager === 'yarn') {
        await execa('yarn', ['add', dependency], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60000
        });
      } else {
        await execa('npm', ['install', '--save', dependency], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60000
        });
      }
      
      return true;
    } catch (error) {
      debug(`Failed to install ${dependency}:`, error);
      return false;
    }
  }
}