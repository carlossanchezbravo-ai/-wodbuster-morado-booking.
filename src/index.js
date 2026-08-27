import { loadConfig } from './config.js';
import { shouldFailRun } from './domain.js';
import { runWodBuster } from './wodbuster.js';

async function main() {
  try {
    const config = loadConfig();
    console.log(
      `Modo: ${config.dryRun ? 'prueba (sin clics)' : 'reserva real'}; días: ${Object.keys(config.schedule).join(', ')}.`
    );

    const results = await runWodBuster(config);
    if (shouldFailRun(results, config.dryRun)) {
      process.exitCode = 1;
    } else if (config.dryRun) {
      console.log(
        'Prueba de conexión completada. La disponibilidad real se comprobará en la ejecución del domingo.'
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await main();
