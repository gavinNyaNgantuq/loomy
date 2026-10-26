import { createApp } from './app.js';
import { env } from './env.js';

const app = createApp();
app.listen(env.port, () => {
  console.log(`loomy-api F0 listen :${env.port} (${env.nodeEnv})`);
});
