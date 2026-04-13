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
    "dev": "tsx watch --include 'src/**/*' src/main.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "composable-backend": "^1.2.0",
    "tslib": "^2.8.1"
  },
  "devDependencies": {
    "@composable-backend/testing": "^1.0.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.21.0",
    "typescript": "^5.8.2",
    "vitest": "^3.2.4"
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
      const config = AppConfig.getInstance(configDir);
      const platform = Platform.getInstance();

      // Auto-discover *.task.ts and *.flow.yml files from src/
      platform.registerComposable(NoOpComposable);
      await platform.autoScan(configDir + '..');

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

server.port: \${SERVER_PORT:8086}
environment: \${ENVIRONMENT:development}
rest.automation: true

log.format: 'text'
log.level: \${LOG_LEVEL:info}

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

/**
 * Sample task: returns a greeting message.
 *
 * This file is auto-discovered by the framework because it follows
 * the *.task.ts naming convention. You can place it anywhere inside src/.
 */
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

const SAMPLES_README = `# Sample Task and Flow

This folder contains a sample task and flow to help you get started.

## File conventions

The framework auto-discovers files by naming convention:

| Convention | What it does |
|---|---|
| \`*.task.ts\` | Auto-registered as a composable function |
| \`*.flow.yml\` | Auto-loaded as a flow definition |

You can place these files **anywhere** inside \`src/\` — the scanner searches recursively.

## How tasks and flows connect

1. A **REST endpoint** in \`src/config/rest.yaml\` routes an HTTP request to a **flow**
2. The **flow** (\`*.flow.yml\`) defines the sequence of **tasks** to execute
3. Each **task** (\`*.task.ts\`) is a self-contained function that processes an event

\`\`\`
HTTP request → rest.yaml → flow (*.flow.yml) → task (*.task.ts) → response
\`\`\`

## Generating new tasks and flows

Use the CLI to scaffold new files:

\`\`\`bash
npx compoback new task my-task-name          # creates src/my-task-name.task.ts
npx compoback new task my-task-name leads    # creates src/leads/my-task-name.task.ts
npx compoback new flow my-flow-name          # creates src/my-flow-name.flow.yml
npx compoback new flow my-flow-name leads    # creates src/leads/my-flow-name.flow.yml
\`\`\`

## Wiring a new endpoint

After creating a task and flow, add a REST endpoint in \`src/config/rest.yaml\`:

\`\`\`yaml
  - service: 'http.flow.adapter'
    methods: ['POST']
    url: '/api/my-endpoint'
    flow: 'my-flow-name'
    timeout: 10s
\`\`\`

The flow id in rest.yaml must match the \`flow.id\` in your \`*.flow.yml\` file,
and the task \`process\` in the flow must match the \`process\` in your \`*.task.ts\` file.
`;

const HELLO_TEST = `import { describe, expect, it, beforeAll } from 'vitest';
import { TestHarness } from '@composable-backend/testing';
import helloGreet from '../src/samples/hello-world.task.js';

describe('hello greeting', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await TestHarness.setup();
    harness.register(helloGreet);
  });

  it('greets by name', async () => {
    const result = await harness.call<{ message: string }>('v1.hello.greet', { name: 'Ada' });
    expect(result.message).toBe('Hello Ada!');
  });

  it('defaults to world', async () => {
    const result = await harness.call<{ message: string }>('v1.hello.greet', {});
    expect(result.message).toBe('Hello world!');
  });
});
`;

const TEST_APP_YML = `application.name: '{{name}}-test'
log.level: 'warn'
`;

const ENV_FILE = `# Environment variables
# These override values in application.yml via \${VAR_NAME:default} syntax

SERVER_PORT=8086
LOG_LEVEL=info
ENVIRONMENT=development
`;

const ROOT_README = `# {{name}}

{{description}}

## Quick start

\`\`\`bash
npm run dev          # start dev server (instant restart on file changes)
curl http://localhost:8086/api/hello/Ada
\`\`\`

## Commands

| Command | Description |
|---|---|
| \`npm run dev\` | Start dev server with hot reload (tsx watch) |
| \`npm run build\` | Production build (TypeScript + copy resources) |
| \`npm start\` | Run production build |
| \`npx compoback new task <name> [path]\` | Generate a new task file |
| \`npx compoback new flow <name> [path]\` | Generate a new flow file |
| \`npm test\` | Run tests (vitest) |
| \`npm run test:watch\` | Run tests in watch mode |

## Project structure

\`\`\`
src/
  main.ts                    Entry point — loads .env and starts the platform
  config/
    preload.ts               Platform bootstrap — auto-discovers tasks and flows
    application.yml          App config (name, port, log level, modules)
    rest.yaml                REST endpoint definitions (URL, method, flow, auth)
  samples/
    hello-world.task.ts      Sample task — returns a greeting
    hello.flow.yml           Sample flow — wires the task to an HTTP endpoint
    README.md                Explains file conventions and how to add new endpoints
tests/
  hello.test.ts              Sample test using @composable-backend/testing
  resources/
    application.yml          Test-specific config (lower log level)
copy-resources.js            Build script — copies YAML files to dist/ for production
.env                         Environment variables (port, log level)
\`\`\`

## File conventions

| Pattern | Purpose |
|---|---|
| \`*.task.ts\` | Auto-discovered as a composable function (must default-export \`defineComposable()\`) |
| \`*.flow.yml\` | Auto-discovered as a flow definition |

Place them anywhere inside \`src/\` — organize by feature, domain, or flat. The framework scans recursively.

## Configuration

- **Port**: set \`SERVER_PORT\` in \`.env\` or \`server.port\` in \`application.yml\`
- **Log level**: set \`LOG_LEVEL\` in \`.env\` or \`log.level\` in \`application.yml\`
- **REST endpoints**: defined in \`src/config/rest.yaml\`
- **CORS**: configured in the \`cors\` section of \`rest.yaml\`

## Testing

Tests use [vitest](https://vitest.dev/) and [@composable-backend/testing](https://github.com/ernestojballon/composable-backend-testing) for a minimal setup.

\`\`\`bash
npm test              # run once
npm run test:watch    # watch mode
\`\`\`

### Writing a test

\`\`\`typescript
import { describe, expect, it, beforeAll } from 'vitest';
import { TestHarness } from '@composable-backend/testing';
import myTask from '../src/my-task.task.js';

describe('my task', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await TestHarness.setup();
    harness.register(myTask);
  });

  it('returns expected result', async () => {
    const result = await harness.call('v1.my.task', { input: 'data' });
    expect(result).toEqual({ output: 'data' });
  });
});
\`\`\`

### Spying on events

Use \`harness.spy()\` to capture events sent to any route:

\`\`\`typescript
const spy = harness.spy('kafka.notification');

// ... run code that sends to kafka.notification ...

expect(spy.count()).toBe(1);
expect(spy.last().body).toEqual({ content: 'hello' });
expect(spy.hasHeader('topic', 'leads.scored')).toBe(true);
\`\`\`

### Test config

Tests use \`tests/resources/application.yml\` which overrides the main config.
Log level is set to \`warn\` to keep test output clean.

## Learn more

- [composable-backend documentation](https://github.com/ernestojballon/composable-backend)
- [REST Automation guide](https://github.com/ernestojballon/composable-backend/blob/main/guides/04-REST-AUTOMATION.md)
- [Event Scripting guide](https://github.com/ernestojballon/composable-backend/blob/main/guides/05-EVENT-SCRIPTING.md)
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
  clack.intro('compoback create-app');

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

  // Root files
  writeFile(path.join(projectDir, 'package.json'), render(PACKAGE_JSON, vars));
  writeFile(path.join(projectDir, 'tsconfig.json'), TSCONFIG);
  writeFile(path.join(projectDir, '.env'), ENV_FILE);
  writeFile(path.join(projectDir, 'copy-resources.js'), COPY_RESOURCES);
  writeFile(path.join(projectDir, 'README.md'), render(ROOT_README, vars));

  // src/
  writeFile(path.join(projectDir, 'src', 'main.ts'), MAIN_TS);

  // src/config/
  writeFile(path.join(projectDir, 'src', 'config', 'preload.ts'), PRELOAD_TS);
  writeFile(path.join(projectDir, 'src', 'config', 'application.yml'), render(APPLICATION_YML, vars));
  writeFile(path.join(projectDir, 'src', 'config', 'rest.yaml'), REST_YAML);

  // src/samples/ — sample task, flow, and README
  writeFile(path.join(projectDir, 'src', 'samples', 'hello-world.task.ts'), HELLO_TASK);
  writeFile(path.join(projectDir, 'src', 'samples', 'hello.flow.yml'), HELLO_FLOW);
  writeFile(path.join(projectDir, 'src', 'samples', 'README.md'), SAMPLES_README);

  // tests/
  writeFile(path.join(projectDir, 'tests', 'hello.test.ts'), HELLO_TEST);
  writeFile(path.join(projectDir, 'tests', 'resources', 'application.yml'), render(TEST_APP_YML, vars));

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
