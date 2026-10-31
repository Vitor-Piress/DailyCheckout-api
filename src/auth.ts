import { createRemoteJWKSet, jwtVerify } from "jose";
import { and, eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { appUsers } from "./db/schema.js";
import { env } from "./env.js";

declare module "fastify" {
  interface FastifyRequest {
    currentUser: CurrentUser;
  }
}

export type CurrentUser = {
  id: string;
  authUserId: string;
  name: string;
  role: "admin" | "daily_operator";
};

const jwks = env.NEON_AUTH_JWKS_URL
  ? createRemoteJWKSet(new URL(env.NEON_AUTH_JWKS_URL))
  : null;

export async function authenticateRequest(
  authorization: string | undefined,
): Promise<{ statusCode: 401 | 403 | 503; error: string } | CurrentUser> {
  if (!jwks || !env.NEON_AUTH_BASE_URL) {
    return {
      statusCode: 503,
      error: "Autenticação não está configurada no ambiente.",
    };
  }

  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return { statusCode: 401, error: "Autenticação obrigatória." };
  }

  try {
    const token = authorization.slice(7).trim();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: new URL(env.NEON_AUTH_BASE_URL).origin,
    });

    if (typeof payload.sub !== "string") {
      return { statusCode: 401, error: "Token sem identificador de usuário." };
    }

    const [user] = await db
      .select({
        id: appUsers.id,
        authUserId: appUsers.authUserId,
        name: appUsers.name,
        role: appUsers.role,
      })
      .from(appUsers)
      .where(and(eq(appUsers.authUserId, payload.sub), eq(appUsers.active, true)))
      .limit(1);

    return user ?? { statusCode: 403, error: "Perfil da aplicação não encontrado." };
  } catch {
    return { statusCode: 401, error: "Token inválido ou expirado." };
  }
}
