import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import { calculateRoleRevenueSplit } from "../src/modules/settlements/settlements.service.js";

type AppRole = "admin" | "daily_operator";

type ResolvedUserRow = {
  app_user_id: string;
  auth_user_id: string;
  app_name: string;
  role: AppRole;
  active: boolean;
  email: string | null;
};

type AffectedSettlementPreviewRow = {
  id: string;
  settlement_date: string;
  other_active_services_count: number;
};

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  const value = process.argv[index + 1];
  return value?.startsWith("--") ? undefined : value;
}

function printUsage() {
  console.log(`
Uso:
  Pré-visualizar (dry-run) os registros que serão removidos de um usuário:
    npm run users:clear-data -- --email <email>
    npm run users:clear-data -- --app-user-id <uuid>

  Confirmar e executar a limpeza:
    npm run users:clear-data -- --email <email> --confirm
    npm run users:clear-data -- --app-user-id <uuid> --confirm
`);
}

async function resolveTargetUser(
  email: string | undefined,
  appUserId: string | undefined,
): Promise<ResolvedUserRow | null> {
  if (email) {
    const result = await db.execute<ResolvedUserRow>(sql`
      SELECT
        au.id::text AS app_user_id,
        au.auth_user_id,
        au.name AS app_name,
        au.role,
        au.active,
        u.email
      FROM neon_auth."user" u
      INNER JOIN public.app_users au ON au.auth_user_id = u.id::text
      WHERE lower(u.email) = lower(${email.trim()})
      LIMIT 1
    `);
    return result.rows[0] ?? null;
  }

  if (appUserId) {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(appUserId.trim())) {
      throw new Error(`UUID inválido informado em --app-user-id: "${appUserId}".`);
    }

    const result = await db.execute<ResolvedUserRow>(sql`
      SELECT
        au.id::text AS app_user_id,
        au.auth_user_id,
        au.name AS app_name,
        au.role,
        au.active,
        u.email
      FROM public.app_users au
      LEFT JOIN neon_auth."user" u ON u.id::text = au.auth_user_id
      WHERE au.id = ${appUserId.trim()}::uuid
      LIMIT 1
    `);
    return result.rows[0] ?? null;
  }

  return null;
}

async function hasTipsSchema(): Promise<boolean> {
  const result = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'service_records' AND column_name = 'tip_cents')
        OR (table_name = 'daily_settlements' AND column_name = 'tips_cents')
        OR (table_name = 'daily_settlement_items' AND column_name = 'tips_cents')
      )
  `);
  return (result.rows[0]?.count ?? 0) === 3;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const email = getArgValue("--email");
  const appUserId = getArgValue("--app-user-id");
  const confirmed = args.includes("--confirm");

  if ((email !== undefined) === (appUserId !== undefined)) {
    console.error(
      "Erro: informe exatamente um identificador: --email <email> ou --app-user-id <uuid>.",
    );
    printUsage();
    process.exitCode = 1;
    return;
  }

  const targetUser = await resolveTargetUser(email, appUserId);

  if (!targetUser) {
    if (email) {
      const authCheck = await db.execute<{ id: string; email: string }>(sql`
        SELECT id::text AS id, email
        FROM neon_auth."user"
        WHERE lower(email) = lower(${email.trim()})
        LIMIT 1
      `);
      if (authCheck.rows[0]) {
        console.error(
          `Usuário encontrado em neon_auth.user (${authCheck.rows[0].email}), mas sem vínculo em public.app_users (nenhum lançamento associado).`,
        );
      } else {
        console.error(`Erro: nenhum usuário encontrado para o email "${email}".`);
      }
    } else {
      console.error(
        `Erro: nenhum usuário encontrado em public.app_users com id "${appUserId}".`,
      );
    }
    process.exitCode = 1;
    return;
  }

  const userUuid = targetUser.app_user_id;

  const [
    serviceRecordsCountRes,
    expensesCountRes,
    settlementItemsCountRes,
    affectedSettlementsRes,
    tipsSchemaAvailable,
  ] = await Promise.all([
    db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM public.service_records
      WHERE created_by = ${userUuid}::uuid
    `),
    db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM public.expenses
      WHERE created_by = ${userUuid}::uuid
    `),
    db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM public.daily_settlement_items
      WHERE user_id = ${userUuid}::uuid
    `),
    db.execute<AffectedSettlementPreviewRow>(sql`
      SELECT
        ds.id::text AS id,
        ds.settlement_date::text AS settlement_date,
        (
          SELECT count(*)::int
          FROM public.service_records sr_other
          WHERE (sr_other.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date = ds.settlement_date::date
            AND sr_other.canceled_at IS NULL
            AND sr_other.created_by IS DISTINCT FROM ${userUuid}::uuid
        ) AS other_active_services_count
      FROM public.daily_settlements ds
      WHERE
        EXISTS (
          SELECT 1
          FROM public.service_records sr_user
          WHERE sr_user.created_by = ${userUuid}::uuid
            AND (sr_user.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date = ds.settlement_date::date
        )
        OR EXISTS (
          SELECT 1
          FROM public.daily_settlement_items dsi
          WHERE dsi.settlement_id = ds.id
            AND dsi.user_id = ${userUuid}::uuid
        )
        OR (
          ds.closed_by = ${userUuid}::uuid
          AND NOT EXISTS (
            SELECT 1
            FROM public.service_records sr_any
            WHERE (sr_any.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date = ds.settlement_date::date
              AND sr_any.canceled_at IS NULL
          )
        )
      ORDER BY ds.settlement_date ASC
    `),
    hasTipsSchema(),
  ]);

  const counts = {
    serviceRecords: serviceRecordsCountRes.rows[0]?.count ?? 0,
    expenses: expensesCountRes.rows[0]?.count ?? 0,
    settlementItems: settlementItemsCountRes.rows[0]?.count ?? 0,
  };
  const affectedSettlements = affectedSettlementsRes.rows;
  const settlementsToDelete = affectedSettlements.filter(
    (s) => s.other_active_services_count === 0,
  );
  const settlementsToRecalculate = affectedSettlements.filter(
    (s) => s.other_active_services_count > 0,
  );

  console.log("\nUsuário identificado:");
  console.table([
    {
      appUserId: targetUser.app_user_id,
      email: targetUser.email ?? "(sem email no Neon Auth)",
      name: targetUser.app_name,
      role: targetUser.role,
      active: targetUser.active,
    },
  ]);

  console.log("Impacto da limpeza para este usuário:");
  console.log(`- atendimentos (service_records) a remover: ${counts.serviceRecords}`);
  console.log(`- despesas (expenses) a remover: ${counts.expenses}`);
  console.log(
    `- itens de fechamento (daily_settlement_items) do usuário a remover: ${counts.settlementItems}`,
  );
  console.log(
    `- fechamentos diários (daily_settlements) sem outros atendimentos a remover: ${settlementsToDelete.length}${
      settlementsToDelete.length > 0
        ? ` (${settlementsToDelete.map((s) => s.settlement_date).join(", ")})`
        : ""
    }`,
  );
  console.log(
    `- fechamentos diários compartilhados com outros usuários a recalcular: ${settlementsToRecalculate.length}${
      settlementsToRecalculate.length > 0
        ? ` (${settlementsToRecalculate.map((s) => s.settlement_date).join(", ")})`
        : ""
    }`,
  );
  console.log(
    "- cadastro do usuário, tipos de serviço e lançamentos de outros usuários: preservados",
  );

  const totalOperations =
    counts.serviceRecords +
    counts.expenses +
    counts.settlementItems +
    affectedSettlements.length;

  if (totalOperations === 0) {
    console.log("\nNenhum lançamento encontrado para este usuário. Nada a limpar.");
    return;
  }

  if (!confirmed) {
    console.log(
      "\nModo simulação (dry-run): nenhuma alteração foi feita. Adicione --confirm ao comando para executar.",
    );
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM public.daily_settlement_items
      WHERE user_id = ${userUuid}::uuid
    `);

    await tx.execute(sql`
      DELETE FROM public.service_records
      WHERE created_by = ${userUuid}::uuid
    `);

    await tx.execute(sql`
      DELETE FROM public.expenses
      WHERE created_by = ${userUuid}::uuid
    `);

    for (const settlement of affectedSettlements) {
      type DayAggregateRow = {
        user_id: string | null;
        role: AppRole | null;
        service_count: number;
        gross_services_cents: number;
        tips_cents: number;
      };

      const remainingRes = tipsSchemaAvailable
        ? await tx.execute<DayAggregateRow>(sql`
            SELECT
              au.id::text AS user_id,
              au.role AS role,
              count(sr.id)::int AS service_count,
              coalesce(sum(sr.price_cents), 0)::int AS gross_services_cents,
              coalesce(sum(sr.tip_cents), 0)::int AS tips_cents
            FROM public.service_records sr
            LEFT JOIN public.app_users au ON sr.created_by = au.id
            WHERE (sr.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date = ${settlement.settlement_date}::date
              AND sr.canceled_at IS NULL
            GROUP BY au.id, au.role
          `)
        : await tx.execute<DayAggregateRow>(sql`
            SELECT
              au.id::text AS user_id,
              au.role AS role,
              count(sr.id)::int AS service_count,
              coalesce(sum(sr.price_cents), 0)::int AS gross_services_cents,
              0::int AS tips_cents
            FROM public.service_records sr
            LEFT JOIN public.app_users au ON sr.created_by = au.id
            WHERE (sr.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date = ${settlement.settlement_date}::date
              AND sr.canceled_at IS NULL
            GROUP BY au.id, au.role
          `);

      if (remainingRes.rows.length === 0) {
        await tx.execute(sql`
          DELETE FROM public.daily_settlements
          WHERE id = ${settlement.id}::uuid
        `);
        continue;
      }

      let adminOwnServicesCents = 0;
      let adminTipsCents = 0;
      let grossServicesCents = 0;
      let tipsCents = 0;
      let unidentifiedServicesCents = 0;
      let unidentifiedTipsCents = 0;
      let unidentifiedServiceCount = 0;
      const operatorItems: Array<{
        userId: string;
        grossServicesCents: number;
        tipsCents: number;
        operatorShareCents: number;
        adminShareCents: number;
        serviceCount: number;
      }> = [];

      for (const row of remainingRes.rows) {
        grossServicesCents += row.gross_services_cents;
        tipsCents += row.tips_cents;

        if (row.role === "admin") {
          adminOwnServicesCents += row.gross_services_cents;
          adminTipsCents += row.tips_cents;
          continue;
        }

        if (row.role === "daily_operator" && row.user_id) {
          const split = calculateRoleRevenueSplit(
            row.gross_services_cents,
            "daily_operator",
            row.tips_cents,
          );
          operatorItems.push({
            userId: row.user_id,
            grossServicesCents: row.gross_services_cents,
            tipsCents: row.tips_cents,
            operatorShareCents: split.operatorShareCents,
            adminShareCents: split.adminShareCents,
            serviceCount: row.service_count,
          });
          continue;
        }

        unidentifiedServicesCents += row.gross_services_cents;
        unidentifiedTipsCents += row.tips_cents;
        unidentifiedServiceCount += row.service_count;
      }

      const dailyOperatorsShareCents = operatorItems.reduce(
        (sum, op) => sum + op.operatorShareCents,
        0,
      );
      const dailyOperatorsTipsCents = operatorItems.reduce(
        (sum, op) => sum + op.tipsCents,
        0,
      );
      const adminDailyOperatorsShareCents = operatorItems.reduce(
        (sum, op) => sum + op.adminShareCents,
        0,
      );
      const adminTotalDueCents =
        adminOwnServicesCents + adminTipsCents + adminDailyOperatorsShareCents;

      if (tipsSchemaAvailable) {
        await tx.execute(sql`
          UPDATE public.daily_settlements
          SET
            admin_own_services_cents = ${adminOwnServicesCents},
            admin_tips_cents = ${adminTipsCents},
            daily_operators_share_cents = ${dailyOperatorsShareCents},
            daily_operators_tips_cents = ${dailyOperatorsTipsCents},
            admin_daily_operators_share_cents = ${adminDailyOperatorsShareCents},
            admin_total_due_cents = ${adminTotalDueCents},
            daily_operators_total_due_cents = ${dailyOperatorsShareCents},
            unidentified_services_cents = ${unidentifiedServicesCents},
            unidentified_tips_cents = ${unidentifiedTipsCents},
            unidentified_service_count = ${unidentifiedServiceCount},
            gross_services_cents = ${grossServicesCents},
            tips_cents = ${tipsCents},
            updated_at = now()
          WHERE id = ${settlement.id}::uuid
        `);
      } else {
        await tx.execute(sql`
          UPDATE public.daily_settlements
          SET
            admin_own_services_cents = ${adminOwnServicesCents},
            daily_operators_share_cents = ${dailyOperatorsShareCents},
            admin_daily_operators_share_cents = ${adminDailyOperatorsShareCents},
            admin_total_due_cents = ${adminTotalDueCents},
            daily_operators_total_due_cents = ${dailyOperatorsShareCents},
            unidentified_services_cents = ${unidentifiedServicesCents},
            unidentified_service_count = ${unidentifiedServiceCount},
            gross_services_cents = ${grossServicesCents},
            updated_at = now()
          WHERE id = ${settlement.id}::uuid
        `);
      }

      await tx.execute(sql`
        DELETE FROM public.daily_settlement_items
        WHERE settlement_id = ${settlement.id}::uuid
      `);

      for (const item of operatorItems) {
        if (tipsSchemaAvailable) {
          await tx.execute(sql`
            INSERT INTO public.daily_settlement_items (
              settlement_id,
              user_id,
              gross_services_cents,
              tips_cents,
              operator_share_cents,
              admin_share_cents,
              service_count
            ) VALUES (
              ${settlement.id}::uuid,
              ${item.userId}::uuid,
              ${item.grossServicesCents},
              ${item.tipsCents},
              ${item.operatorShareCents},
              ${item.adminShareCents},
              ${item.serviceCount}
            )
          `);
        } else {
          await tx.execute(sql`
            INSERT INTO public.daily_settlement_items (
              settlement_id,
              user_id,
              gross_services_cents,
              operator_share_cents,
              admin_share_cents,
              service_count
            ) VALUES (
              ${settlement.id}::uuid,
              ${item.userId}::uuid,
              ${item.grossServicesCents},
              ${item.operatorShareCents},
              ${item.adminShareCents},
              ${item.serviceCount}
            )
          `);
        }
      }
    }
  });

  console.log("\nLimpeza dos dados do usuário concluída com sucesso.");
}

main()
  .catch((error) => {
    console.error("A limpeza falhou; a transação foi revertida.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
