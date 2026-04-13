import fs from 'fs';
import path from 'path';

/**
 * Convert a kebab-case name to a dot-notation process name.
 * e.g. "order-validate" → "v1.order.validate"
 */
export function toProcessName(name: string): string {
  return 'v1.' + name.replace(/-/g, '.');
}

/**
 * Write a file, creating intermediate directories as needed.
 * Refuses to overwrite an existing file.
 */
export function writeFile(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    throw new Error(`File already exists: ${filePath}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Simple template replacement: {{key}} → value
 */
export function render(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}
