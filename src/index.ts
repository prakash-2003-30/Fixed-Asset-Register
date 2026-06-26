import { createApp } from './app';
import { config } from './config';
import { prisma } from './prisma';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Fixed Asset Register API listening on http://localhost:${config.port}`);
});

async function shutdown() {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
