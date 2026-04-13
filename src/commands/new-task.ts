import path from 'path';
import { toProcessName, writeFile, render } from '../utils.js';

const TEMPLATE = `import { defineComposable, EventEnvelope } from 'composable-backend';

export default defineComposable({
  process: '{{processName}}',
  handler: async (evt: EventEnvelope) => {
    const body = evt.getBody();
    // TODO: implement
    return body;
  },
  instances: 10,
});
`;

export function newTask(name: string, targetPath?: string): void {
  const dir = path.resolve('src', targetPath ?? '');
  const filePath = path.join(dir, `${name}.task.ts`);
  const processName = toProcessName(name);

  const content = render(TEMPLATE, { processName });
  writeFile(filePath, content);

  console.log(`Created ${path.relative(process.cwd(), filePath)}`);
  console.log(`  process: '${processName}'`);
}
