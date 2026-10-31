# DailyCheckout API

API REST do DailyCheckout, sistema de controle financeiro e operacional para uma barbearia.

O backend foi desenvolvido com Fastify e TypeScript, utiliza PostgreSQL hospedado no Neon e acessa o banco por meio do Drizzle ORM. A validação dos dados é feita com Zod.

## Status

Esta versão contém o núcleo do MVP:

- catálogo de serviços;
- registro de atendimentos;
- registro e consulta de despesas;
- relatório diário de atendimentos;
- relatórios mensal, trimestral, semestral e anual;
- documentação OpenAPI com Swagger UI;
- configuração para deploy no Render.

Autenticação, clientes, planos, fidelidade e permissões ainda não fazem parte desta versão.

## Tecnologias

- Node.js
- TypeScript
- Fastify
- PostgreSQL
- Neon
- Drizzle ORM e Drizzle Kit
- Zod
- Swagger/OpenAPI

## Pré-requisitos

- Node.js compatível com as dependências do projeto;
- npm;
- uma instância PostgreSQL, preferencialmente um projeto Neon;
- Git.

## Instalação

Clone o repositório e instale as dependências:

```bash
git clone <https://github.com/Vitor-Piress/DailyCheckout-api.git>
cd dailycheckout-api
npm ci
```

Crie o arquivo local de variáveis de ambiente:

```bash
cp .env.example .env.local
```

Preencha `DATABASE_URL` com a URL de conexão do PostgreSQL. Para executar migrations, preencha também `DATABASE_URL_UNPOOLED`.

> Nunca versione `.env`, `.env.local` ou qualquer arquivo que contenha credenciais. O `.gitignore` do projeto já protege esses arquivos.

### Variáveis de ambiente

| Variável                |     Obrigatória | Descrição                                                  |
| ----------------------- | --------------: | ---------------------------------------------------------- |
| `DATABASE_URL`          |             Sim | URL de conexão usada pela API em produção                  |
| `DATABASE_URL_UNPOOLED` | Para migrations | URL de conexão direta usada pelo Drizzle Kit               |
| `PORT`                  |             Não | Porta HTTP; padrão `3333`                                  |
| `HOST`                  |             Não | Host de escuta; padrão `0.0.0.0`                           |
| `CORS_ORIGIN`           |             Não | Origem permitida pelo CORS; padrão `http://localhost:5173` |

No Neon, use a conexão pooled em `DATABASE_URL` para o tráfego normal da aplicação e a conexão direta em `DATABASE_URL_UNPOOLED` para migrations.

## Banco de dados

Gere uma migration depois de alterar o schema:

```bash
npm run db:generate
```

Aplique as migrations no banco configurado:

```bash
npm run db:migrate
```

Insira o catálogo inicial de serviços:

```bash
npm run db:seed
```

O seed é idempotente e não duplica serviços já existentes.

Os valores monetários são armazenados em centavos. Por exemplo:

```text
R$ 45,00 = 4500
```

O fuso utilizado para interpretar datas de relatórios e listagens é `America/Sao_Paulo`.

## Desenvolvimento

Inicie a API em modo de desenvolvimento:

```bash
npm run dev
```

A API estará disponível em:

```text
http://localhost:3333
```

Para validar a compilação:

```bash
npm run build
```

Para iniciar a versão compilada:

```bash
npm start
```

## Documentação da API

Com a aplicação em execução:

- Swagger UI: [`http://localhost:3333/docs`](http://localhost:3333/docs)
- Especificação OpenAPI em JSON: [`http://localhost:3333/docs/json`](http://localhost:3333/docs/json)

O Swagger UI permite visualizar schemas, parâmetros, payloads e respostas diretamente no navegador.

## Endpoints

### Health checks

```http
GET /health
GET /health/db
```

`/health` verifica se o processo está respondendo. `/health/db` executa uma consulta simples no PostgreSQL.

### Serviços

```http
GET /service-types
```

Retorna somente os serviços ativos, ordenados pelo nome.

Exemplo de resposta:

```json
[
  {
    "id": "00000000-0000-0000-0000-000000000000",
    "name": "Corte Masculino",
    "description": null,
    "priceCents": 4500
  }
]
```

### Atendimentos

Registrar um atendimento:

```http
POST /service-records
Content-Type: application/json
```

Payload:

```json
{
  "serviceTypeId": "00000000-0000-0000-0000-000000000000",
  "paymentMethod": "pix",
  "notes": "Cliente sem observações"
}
```

`paymentMethod` aceita:

- `cash`
- `pix`
- `credit_card`
- `debit_card`
- `other`

O preço não é recebido do frontend. A API consulta o preço atual do catálogo e grava uma cópia no atendimento para preservar o histórico.

Listar atendimentos de um dia:

```http
GET /service-records?date=2026-10-31
```

### Despesas

Registrar uma despesa:

```http
POST /expenses
Content-Type: application/json
```

Payload:

```json
{
  "description": "Compra de produtos",
  "amountCents": 1000,
  "category": "Materiais",
  "paymentMethod": "cash",
  "notes": "Reposição do estoque"
}
```

Listar despesas de um dia:

```http
GET /expenses?date=2026-10-31
```

As despesas são lançadas individualmente, mas não entram no relatório diário. Elas são consolidadas apenas nos relatórios periódicos.

### Relatório diário

```http
GET /reports/daily?date=2026-10-31
```

O relatório diário retorna:

- quantidade total de atendimentos;
- receita bruta em centavos;
- resumo por serviço;
- resumo por forma de pagamento.

### Relatório periódico

```http
GET /reports/periodic?period=month&date=2026-10-31
```

Valores aceitos para `period`:

- `month`;
- `quarter`;
- `semester`;
- `year`.

O relatório periódico retorna:

- período calculado;
- quantidade de atendimentos;
- receita bruta;
- quantidade e total de despesas;
- despesas agrupadas por forma de pagamento;
- resultado líquido.

O intervalo considera o início inclusivo e o fim exclusivo do período.

## Regras importantes

- Atendimentos e despesas usam UUIDs.
- Dinheiro é representado por inteiros em centavos, nunca por `float`.
- O preço do atendimento é congelado no momento do registro.
- Registros cancelados são ignorados nas listagens e relatórios.
- O cancelamento é lógico; os dados não são apagados fisicamente.
- Despesas não compõem o relatório diário.
- Datas de negócio são interpretadas no fuso `America/Sao_Paulo`.
- A API atualmente não possui autenticação; ela deve ser adicionada antes de expor operações administrativas em produção.

## Estrutura do projeto

```text
src/
├── app.ts                    # Criação e configuração do Fastify
├── server.ts                 # Inicialização do servidor HTTP
├── env.ts                    # Validação das variáveis de ambiente
├── db/
│   ├── client.ts             # Pool PostgreSQL e instância Drizzle
│   └── schema.ts             # Schema relacional
├── docs/
│   └── schemas.ts            # Schemas reutilizáveis do OpenAPI
└── modules/
    ├── service-types/        # Catálogo de serviços
    ├── service-records/      # Atendimentos
    ├── expenses/             # Despesas
    └── reports/              # Relatórios

drizzle/                      # Migrations SQL
scripts/seed.ts               # Seed inicial
render.yaml                   # Blueprint do Render
```

## Deploy no Render

O arquivo [`render.yaml`](./render.yaml) define um Web Service gratuito com:

- build: `npm ci && npm run build`;
- start: `npm start`;
- health check: `/health`.

No Render, configure:

```text
DATABASE_URL
DATABASE_URL_UNPOOLED
CORS_ORIGIN
```

`CORS_ORIGIN` deve ser a origem exata do frontend. Durante o desenvolvimento local:

```text
http://localhost:5173
```

Depois de publicar o frontend no Cloudflare Pages, substitua pelo domínio público do frontend, por exemplo:

```text
https://dailycheckout.pages.dev
```

As migrations não são executadas automaticamente pelo `render.yaml`. Aplique-as conscientemente antes ou durante a preparação do ambiente de produção:

```bash
npm run db:migrate
```

## Integração com o frontend

No frontend React/Vite, configure:

```env
VITE_API_URL=http://localhost:3333
```

Em produção:

```env
VITE_API_URL=https://sua-api.onrender.com
```

O frontend deve consumir a API por HTTP e não acessar o PostgreSQL diretamente. O fluxo inicial recomendado é:

1. consultar `GET /service-types`;
2. exibir um botão para cada serviço;
3. enviar `POST /service-records` ao registrar o atendimento;
4. consultar `GET /reports/daily` para o fechamento do dia;
5. usar `GET /expenses` e `GET /reports/periodic` para o controle financeiro.

## Licença

Este projeto ainda não possui uma licença pública definida.
