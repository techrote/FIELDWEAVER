import { createFoundationSnapshot } from './core/index.js';
import { mountApplicationShell } from './ui/shell.js';
import { APP_VERSION } from './version.js';

function bootstrap() {
  const root = document.querySelector('#app');

  if (!root) {
    throw new Error('FIELDWEAVER application root #app was not found.');
  }

  document.documentElement.dataset.fieldweaverVersion = APP_VERSION;
  mountApplicationShell(root, createFoundationSnapshot());
}

bootstrap();
