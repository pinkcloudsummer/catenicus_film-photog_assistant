import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDatabase, ROLLS_DIR, DATA_DIR } from './db.js';
import { registerGearRoutes } from './routes/gear.js';
import { registerRollRoutes } from './routes/rolls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  initDatabase();

  const app = Fastify({
    logger: true,
    bodyLimit: 50 * 1024 * 1024 // 50MB limit for high-res film scans
  });

  await app.register(cors, {
    origin: true
  });

  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024
    }
  });

  // Serve NAS roll images under /nas/rolls/*
  await app.register(fastifyStatic, {
    root: ROLLS_DIR,
    prefix: '/nas/rolls/',
    decorateReply: false
  });

  // Register REST API routes
  await registerGearRoutes(app);
  await registerRollRoutes(app);

  // In production, also serve the compiled React SPA from client/dist
  const clientDistPath = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDistPath)) {
    await app.register(fastifyStatic, {
      root: clientDistPath,
      prefix: '/',
      decorateReply: true
    });

    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/nas/')) {
        reply.code(404).send({ error: 'Not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  const port = Number(process.env.PORT) || 3001;
  const host = process.env.HOST || '0.0.0.0';

  await app.listen({ port, host });
  console.log(`🎞️  Catenicus NAS Backend running at http://${host}:${port}`);
  console.log(`📁 NAS Storage Volume: ${DATA_DIR}`);
}

startServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
