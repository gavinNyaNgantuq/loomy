import { migrate } from './migrate.js';

migrate()
  .then(() => {
    console.log('migrate: ok (tables ensured)');
    process.exit(0);
  })
  .catch((err) => {
    console.error('migrate: gagal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
