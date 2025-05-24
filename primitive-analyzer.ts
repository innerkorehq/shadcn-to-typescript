/**
 * Analyzes component files to determine primitive imports and exports
 * This helps the script generate proper type imports and exports
 */

import { readFile } from 'fs/promises';
import * as path from 'path';
import * as ts from 'typescript';
import { parse as parseImports } from 'es-module-lexer';
import Debug from 'debug';
import chalk from 'chalk';
import { getComponentDependencies } from './component-registry';

const debug = Debug('shadcn:primitive');

export interface PrimitiveData {
  /**
   * Name of the primitive (e.g., AccordionPrimitive)
   */
  name: string;
  
  /**
   * Package to import from (e.g., @radix-ui/react-accordion)
   */
  package: string;
  
  /**
   * Sub-components that are used (e.g., Root, Item, etc.)
   */
  subComponents: string[];
}

/**
 * Analyze a component file to extract primitive imports and usages
 */
export async function analyzePrimitives(filePath: string, componentName: string): Promise<PrimitiveData | null> {
  try {
    // First try to get from registry
    const registryData = getComponentDependencies(componentName);
    
    if (registryData && registryData.package && registryData.primitive) {
      return {
        name: registryData.primitive,
        package: registryData.package,
        subComponents: registryData.subComponents || []
      };
    }
    
    // If not in registry, try to analyze the file
    const fileContent = await readFile(filePath, 'utf8');
    
    // Parse imports first
    const primitiveImports = await extractPrimitiveImports(fileContent);
    if (primitiveImports) {
      return primitiveImports;
    }
    
    // If no imports found, try to analyze code with TypeScript
    return analyzeWithTypeScript(fileContent, componentName);
  } catch (error) {
    debug(`Error analyzing primitives in ${filePath}:`, error);
    console.error(chalk.yellow(`Warning: Could not analyze primitives: ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }
}

/**
 * Extract primitive imports from file content using es-module-lexer
 */
async function extractPrimitiveImports(content: string): Promise<PrimitiveData | null> {
  try {
    const [imports] = parseImports(content);
    
    for (const imp of imports) {
      const importStatement = content.substring(imp.ss, imp.se);
      
      // Check if this is a primitive import
      if (imp.n && 
          (imp.n.includes('@radix-ui/react-') || 
           imp.n === 'cmdk' || 
           imp.n === 'react-day-picker')) {
        
        // Extract primitive name from import statement
        const primitiveMatch = importStatement.match(/import\s+\*\s+as\s+([A-Za-z0-9_]+Primitive)\s+from/);
        if (primitiveMatch && primitiveMatch[1]) {
          const primitiveName = primitiveMatch[1];
          
          // Extract sub-components by analyzing the file content
          const subComponentRegex = new RegExp(`${primitiveName}\\.([A-Za-z0-9_]+)`, 'g');
          const subComponents = new Set<string>();
          let match;
          
          while ((match = subComponentRegex.exec(content)) !== null) {
            if (match[1] && !['displayName', 'propTypes', 'defaultProps'].includes(match[1])) {
              subComponents.add(match[1]);
            }
          }
          
          return {
            name: primitiveName,
            package: imp.n,
            subComponents: Array.from(subComponents)
          };
        }
      }
    }
    
    return null;
  } catch (error) {
    debug('Error extracting primitive imports:', error);
    return null;
  }
}

/**
 * Analyze component with TypeScript for deeper inspection
 */
function analyzeWithTypeScript(content: string, componentName: string): PrimitiveData | null {
  try {
    const sourceFile = ts.createSourceFile(
      `${componentName}.tsx`,
      content,
      ts.ScriptTarget.Latest,
      true
    );
    
    let primitiveData: PrimitiveData | null = null;
    
    // Visit the TypeScript AST to find imports and usages
    ts.forEachChild(sourceFile, node => {
      // Check import declarations
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier;
        
        if (ts.isStringLiteral(moduleSpecifier)) {
          const packageName = moduleSpecifier.text;
          
          if (packageName.includes('@radix-ui/react-') || 
              packageName === 'cmdk' || 
              packageName === 'react-day-picker') {
            
            // Check if this is a namespace import
            if (node.importClause?.namedBindings && 
                ts.isNamespaceImport(node.importClause.namedBindings)) {
              const primitiveName = node.importClause.namedBindings.name.text;
              
              if (primitiveName.includes('Primitive')) {
                primitiveData = {
                  name: primitiveName,
                  package: packageName,
                  subComponents: []
                };
              }
            }
          }
        }
      }
      
      // Look for primitive usages to find sub-components
      if (primitiveData && ts.isPropertyAccessExpression(node)) {
        const expression = node.expression;
        if (ts.isIdentifier(expression) && expression.text === primitiveData.name) {
          const propertyName = node.name.text;
          if (!primitiveData.subComponents.includes(propertyName) &&
              !['displayName', 'propTypes', 'defaultProps'].includes(propertyName)) {
            primitiveData.subComponents.push(propertyName);
          }
        }
      }
    });
    
    return primitiveData;
  } catch (error) {
    debug('Error analyzing with TypeScript:', error);
    return null;
  }
}