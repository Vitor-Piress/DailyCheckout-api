import { db, pool } from "../src/db/client.js";
import { serviceTypes } from "../src/db/schema.js";

const initialServices = [
  { name: "Corte Masculino", priceCents: 4500 },
  { name: "Barba", priceCents: 4000 },
  { name: "Cabelo e Barba", priceCents: 8000 },
  { name: "Corte Infantil", priceCents: 3500 },
  { name: "Sobrancelha Navalhada", priceCents: 500 },
  { name: "Maquina Barba", priceCents: 500 },
];

try {
  await db.insert(serviceTypes).values(initialServices).onConflictDoNothing({
    target: serviceTypes.name,
  });

  console.log(`Seed concluído: ${initialServices.length} serviços processados.`);
} finally {
  await pool.end();
}
