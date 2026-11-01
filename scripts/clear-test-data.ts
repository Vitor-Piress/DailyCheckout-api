import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";

const confirmed = process.argv.includes("--confirm");

async function main() {
  const [serviceRecords, settlements, settlementItems, expenses] = await Promise.all([
    db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM service_records`,
    ),
    db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM daily_settlements`,
    ),
    db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM daily_settlement_items`,
    ),
    db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM expenses`,
    ),
  ]);

  const counts = {
    serviceRecords: Number(serviceRecords.rows[0]?.count ?? 0),
    settlements: Number(settlements.rows[0]?.count ?? 0),
    settlementItems: Number(settlementItems.rows[0]?.count ?? 0),
    expenses: Number(expenses.rows[0]?.count ?? 0),
  };

  console.log("Registros que serão removidos:");
  console.log(`- atendimentos: ${counts.serviceRecords}`);
  console.log(`- fechamentos diários: ${counts.settlements}`);
  console.log(`- itens dos fechamentos: ${counts.settlementItems}`);
  console.log(`- despesas: ${counts.expenses}`);
  console.log("- usuários e tipos de serviço: preservados");

  if (!confirmed) {
    console.log(
      "\nNenhuma alteração foi feita. Execute novamente com --confirm para confirmar.",
    );
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM daily_settlement_items`);
    await tx.execute(sql`DELETE FROM daily_settlements`);
    await tx.execute(sql`DELETE FROM service_records`);
    await tx.execute(sql`DELETE FROM expenses`);
  });

  console.log("\nLimpeza concluída com sucesso.");
}

main()
  .catch((error) => {
    console.error("A limpeza falhou; a transação foi revertida.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
