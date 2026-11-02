import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import { appUsers } from "../src/db/schema.js";

type AppRole = "admin" | "daily_operator";

type NeonAuthUserRow = {
  id: string;
  email: string;
  name: string;
  app_user_id: string | null;
  app_name: string | null;
  app_role: AppRole | null;
  active: boolean | null;
};

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) {
    return undefined;
  }
  return process.argv[index + 1];
}

function printUsage() {
  console.log(`
Uso:
  Listar usuários do Neon Auth e seu vínculo na aplicação:
    npm run users:link -- --list

  Vincular ou atualizar o perfil de um usuário:
    npm run users:link -- --email <email> --role <admin|daily_operator> [--name "Nome"] [--inactive]
    npm run users:link -- --auth-id <uuid> --role <admin|daily_operator> [--name "Nome"] [--inactive]
`);
}

async function listUsers() {
  const result = await db.execute<NeonAuthUserRow>(sql`
    SELECT
      u.id::text AS id,
      u.email,
      u.name,
      au.id::text AS app_user_id,
      au.name AS app_name,
      au.role AS app_role,
      au.active
    FROM neon_auth."user" u
    LEFT JOIN public.app_users au ON au.auth_user_id = u.id::text
    ORDER BY u."createdAt" DESC
  `);

  if (result.rows.length === 0) {
    console.log("Nenhum usuário encontrado em neon_auth.user.");
    return;
  }

  console.log("\nUsuários no Neon Auth:");
  console.table(
    result.rows.map((u) => ({
      authUserId: u.id,
      email: u.email,
      neonName: u.name,
      linked: Boolean(u.app_user_id),
      appName: u.app_name ?? "-",
      role: u.app_role ?? "(sem vínculo)",
      active: u.active ?? "-",
    })),
  );
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--list") || args.includes("-l")) {
    await listUsers();
    printUsage();
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const email = getArgValue("--email");
  const authId = getArgValue("--auth-id");
  const role = getArgValue("--role") as AppRole | undefined;
  const customName = getArgValue("--name");
  const active = !args.includes("--inactive");

  if (!email && !authId) {
    console.error("Erro: informe --email ou --auth-id para identificar o usuário.");
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (role !== "admin" && role !== "daily_operator") {
    console.error(
      'Erro: informe um perfil válido com --role ("admin" ou "daily_operator").',
    );
    printUsage();
    process.exitCode = 1;
    return;
  }

  const userQuery = email
    ? sql`SELECT id::text AS id, email, name FROM neon_auth."user" WHERE lower(email) = lower(${email}) LIMIT 1`
    : sql`SELECT id::text AS id, email, name FROM neon_auth."user" WHERE id::text = ${authId} LIMIT 1`;

  const authUserResult = await db.execute<{
    id: string;
    email: string;
    name: string;
  }>(userQuery);

  const authUser = authUserResult.rows[0];

  if (!authUser) {
    console.error(
      `Erro: usuário não encontrado em neon_auth.user (${email ? `email: ${email}` : `id: ${authId}`}).`,
    );
    process.exitCode = 1;
    return;
  }

  const finalName = (customName ?? authUser.name ?? authUser.email).trim();

  const [upserted] = await db
    .insert(appUsers)
    .values({
      authUserId: authUser.id,
      name: finalName,
      role,
      active,
    })
    .onConflictDoUpdate({
      target: appUsers.authUserId,
      set: {
        name: finalName,
        role,
        active,
        updatedAt: new Date(),
      },
    })
    .returning();

  console.log("\nUsuário vinculado/atualizado com sucesso em app_users:");
  console.table([
    {
      id: upserted.id,
      authUserId: upserted.authUserId,
      email: authUser.email,
      name: upserted.name,
      role: upserted.role,
      active: upserted.active,
    },
  ]);
}

main()
  .catch((error) => {
    console.error("Falha ao processar vínculo de usuário:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

