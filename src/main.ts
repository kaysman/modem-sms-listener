import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

process.on('uncaughtException', (err) => {
  console.error('Uncaught error (likely bad PDU on wrong port):', err.message);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const host = process.env.HTTP_HOST ?? '127.0.0.1';
  const port = Number(process.env.HTTP_PORT ?? 3000);
  await app.listen(port, host);
  console.log(`[http] SMS console at http://${host}:${port}`);
}

bootstrap();
