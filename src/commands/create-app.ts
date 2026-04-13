import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import * as clack from '@clack/prompts';
import { writeFile, render } from '../utils.js';

const PACKAGE_JSON = `{
  "name": "{{name}}",
  "version": "0.1.0",
  "description": "{{description}}",
  "type": "module",
  "main": "dist/main.js",
  "license": "Apache-2.0",
  "engines": {
    "node": ">=20.18.1"
  },
  "scripts": {
    "clean": "rm -rf dist",
    "copy-resources": "node copy-resources.js",
    "build": "npm run clean && tsc && npm run copy-resources",
    "start": "node dist/main.js",
    "dev": "tsx watch --include 'src/**/*' src/main.ts"
  },
  "dependencies": {
    "composable-backend": "^1.1.0",
    "tslib": "^2.8.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.21.0",
    "typescript": "^5.8.2"
  }
}
`;

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
`;

const MAIN_TS = `import { ComposableLoader } from './config/preload.js';

async function main() {
  try {
    if (typeof (process as any).loadEnvFile === 'function') {
      try { (process as any).loadEnvFile(); } catch { /* no .env is fine */ }
    }
  } catch { /* ignore */ }
  await ComposableLoader.initialize();
}

main().catch((e) => {
  console.error('Fatal startup error:', e);
  process.exit(1);
});
`;

const PRELOAD_TS = `import { fileURLToPath } from 'url';
import {
  Logger, AppConfig, Platform, RestAutomation, EventScriptEngine, NoOpComposable
} from 'composable-backend';
import helloGreet from '../hello-world.task.js';

const log = Logger.getInstance();

function getRootFolder(): string {
  const folder = fileURLToPath(new URL('.', import.meta.url));
  const filePath = folder.includes('\\\\') ? folder.replaceAll('\\\\', '/') : folder;
  const colon = filePath.indexOf(':');
  return colon === 1 ? filePath.substring(colon + 1) : filePath;
}

export class ComposableLoader {
  private static loaded = false;

  static async initialize(serverPort?: number): Promise<void> {
    if (ComposableLoader.loaded) return;
    ComposableLoader.loaded = true;
    try {
      const configDir = getRootFolder();
      // Use autoScan if available (composable-backend >= 1.2.0), otherwise register manually
      const config = AppConfig.getInstance(configDir);
      const platform = Platform.getInstance();

      platform.registerComposable(NoOpComposable);
      if (typeof platform.autoScan === 'function') {
        await platform.autoScan(configDir + '..');
      } else {
        platform.registerComposable(helloGreet);
      }

      const eventManager = new EventScriptEngine();
      await eventManager.start();

      if (serverPort) {
        config.set('server.port', parseInt(String(serverPort)));
      }
      if ('true' == config.getProperty('rest.automation')) {
        const server = RestAutomation.getInstance();
        await server.start();
      }

      platform.runForever();
      await platform.getReady();
    } catch (e) {
      log.error(\`Unable to preload - \${(e as Error).message}\`);
      throw e;
    }
  }
}
`;

const APPLICATION_YML = `application.name: '{{name}}'
info.app:
  version: '0.1.0'
  description: '{{description}}'

server.port: 8086
rest.automation: true

log.format: 'text'
log.level: 'info'

yaml.rest.automation: 'classpath:/rest.yaml'
`;

const REST_YAML = `rest:
  - service: 'http.flow.adapter'
    methods: ['GET']
    url: '/api/hello/{name}'
    flow: 'hello'
    timeout: 10s
    tracing: true

cors:
  - id: cors_1
    options:
      - 'Access-Control-Allow-Origin: *'
      - 'Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS'
      - 'Access-Control-Allow-Headers: Origin, Authorization, Accept, Content-Type'
      - 'Access-Control-Max-Age: 86400'
    headers:
      - 'Access-Control-Allow-Origin: *'
      - 'Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS'
      - 'Access-Control-Allow-Headers: Origin, Authorization, Accept, Content-Type'
      - 'Access-Control-Allow-Credentials: true'
`;

const HELLO_TASK = `import { defineComposable, EventEnvelope } from 'composable-backend';

export default defineComposable({
  process: 'v1.hello.greet',
  handler: async (evt: EventEnvelope) => {
    const body = evt.getBody() as Record<string, unknown>;
    const name = body.name ?? 'world';
    return { message: \`Hello \${name}!\` };
  },
  instances: 10,
});
`;

const HELLO_FLOW = `flow:
  id: 'hello'
  description: 'Simple greeting flow'
  ttl: 10s

first.task: 'greet'

tasks:
  - name: 'greet'
    input:
      - 'input.path_parameter.name -> name'
    process: 'v1.hello.greet'
    output:
      - 'text(application/json) -> output.header.content-type'
      - 'result -> output.body'
    description: 'Return a greeting'
    execution: end
`;

const ENV_FILE = `# Environment variables
LOG_LEVEL=info
ENVIRONMENT=development
`;

const COPY_RESOURCES = `import fs from 'fs';
import path from 'path';

const dst = path.resolve('dist/config/resources');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Copy config YAML files
const configSrc = path.resolve('src/config');
fs.mkdirSync(dst, { recursive: true });
for (const file of ['application.yml', 'rest.yaml']) {
  const s = path.join(configSrc, file);
  if (fs.existsSync(s)) {
    fs.copyFileSync(s, path.join(dst, file));
  }
}

// Scan all of src/ for *.flow.yml files and copy them into dist/
function findFlowFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'config') {
      results.push(...findFlowFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.flow.yml')) {
      results.push(full);
    }
  }
  return results;
}

const srcDir = path.resolve('src');
const flowFiles = findFlowFiles(srcDir);
if (flowFiles.length > 0) {
  const flowsDst = path.join(dst, 'flows');
  fs.mkdirSync(flowsDst, { recursive: true });
  for (const flowPath of flowFiles) {
    const name = path.basename(flowPath);
    fs.copyFileSync(flowPath, path.join(flowsDst, name));
  }
}

// Copy public directory if it exists
const publicSrc = path.resolve('src/config/public');
if (fs.existsSync(publicSrc)) {
  copyDir(publicSrc, path.join(dst, 'public'));
}

console.log(\`Assembled resources into \${dst}\`);
`;

export async function createApp(nameArg?: string): Promise<void> {
  clack.intro('compoback create app');

  let name = nameArg;
  if (!name) {
    const result = await clack.text({
      message: 'Project name:',
      placeholder: 'my-composable-app',
      validate: (v) => {
        if (!v || !v.trim()) return 'Name is required';
        if (!/^[a-z0-9][a-z0-9._-]*$/.test(v)) return 'Use lowercase, numbers, hyphens, dots';
        return undefined;
      },
    });
    if (clack.isCancel(result)) {
      clack.cancel('Cancelled');
      process.exit(0);
    }
    name = result as string;
  }

  const description = `${name} — built with composable-backend`;
  const projectDir = path.resolve(name);

  if (fs.existsSync(projectDir)) {
    clack.cancel(`Directory ${name} already exists`);
    process.exit(1);
  }

  const spinner = clack.spinner();
  spinner.start('Scaffolding project');

  const vars = { name, description };

  // Create files
  writeFile(path.join(projectDir, 'package.json'), render(PACKAGE_JSON, vars));
  writeFile(path.join(projectDir, 'tsconfig.json'), TSCONFIG);
  writeFile(path.join(projectDir, '.env'), ENV_FILE);
  writeFile(path.join(projectDir, 'copy-resources.js'), COPY_RESOURCES);
  writeFile(path.join(projectDir, 'src', 'main.ts'), MAIN_TS);
  writeFile(path.join(projectDir, 'src', 'config', 'preload.ts'), PRELOAD_TS);
  writeFile(path.join(projectDir, 'src', 'config', 'application.yml'), render(APPLICATION_YML, vars));
  writeFile(path.join(projectDir, 'src', 'config', 'rest.yaml'), REST_YAML);
  writeFile(path.join(projectDir, 'src', 'hello-world.task.ts'), HELLO_TASK);
  writeFile(path.join(projectDir, 'src', 'hello.flow.yml'), HELLO_FLOW);

  spinner.stop('Project scaffolded');

  // Install dependencies
  spinner.start('Installing dependencies');
  try {
    execSync('npm install', { cwd: projectDir, stdio: 'pipe' });
    spinner.stop('Dependencies installed');
  } catch {
    spinner.stop('npm install failed — run it manually');
  }

  clack.outro(`Done! Next steps:

  cd ${name}
  npm run dev          # start dev server (instant restart)
  curl http://localhost:8086/api/hello/Ada

  npm run build        # production build
  npm start            # run production
`);
}
