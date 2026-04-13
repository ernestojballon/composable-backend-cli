import path from 'path';
import { toProcessName, writeFile, render } from '../utils.js';

const TEMPLATE = `flow:
  id: '{{flowId}}'
  description: '{{description}}'
  ttl: 10s

first.task: '{{firstTask}}'

tasks:
  - name: '{{firstTask}}'
    process: '{{processName}}'
    output:
      - 'result -> output.body'
    description: 'TODO: implement'
    execution: end
`;

export function newFlow(name: string, targetPath?: string): void {
  const dir = path.resolve('src', targetPath ?? '');
  const filePath = path.join(dir, `${name}.flow.yml`);
  const firstTask = name + '.first';
  const processName = toProcessName(name.replace(/^process-/, ''));

  const content = render(TEMPLATE, {
    flowId: name,
    description: `Flow: ${name}`,
    firstTask,
    processName,
  });
  writeFile(filePath, content);

  console.log(`Created ${path.relative(process.cwd(), filePath)}`);
  console.log(`  flow id: '${name}'`);
}
