# Workflow builder

Describe an automation in plain English, and an LLM compiles it into a workflow graph that actually runs.

```
"When someone submits my contact form, summarize it and post to #support."
```

The hard part isn't getting a language model to emit a workflow. It's getting one that is *correct*. A model will confidently invent a node type that doesn't exist, reference data from a step that hasn't run yet, or wire a graph that loops forever — and all of it looks plausible.

You can't prompt that away. So FlowForge is built **validation-first**: every node type is declared once as a Zod schema, and that single declaration feeds the validator, the executors, the database, and the prompt sent to the model. Generated graphs are checked exhaustively before anything is allowed to run.

## How it works

```mermaid
flowchart LR
    A[Plain English] --> B[LLM compiler]
    B --> C[Workflow JSON]
    C --> D{Validator}
    D -->|errors| B
    D -->|placeholders| E[Ask the user]
    D -->|valid| F[(Postgres)]
    F --> G[Execution engine]
```

1. The user describes an automation.
2. The compiler sends it to an LLM, grounded in the node catalog.
3. The validator checks the result — structure, parameters, references, reachability, cycles.
4. Anything the model couldn't determine becomes a **placeholder**, not a guess. The run blocks and asks.
5. A valid graph is persisted, then executed node by node in topological order.

## Repository layout

```
packages/
  core/      Schemas, node catalog, validator — the source of truth
  engine/    Executes a validated graph
  db/        Drizzle schema, migrations, catalog seeding
apps/
  web/       Next.js UI (canvas planned)
```

### `packages/core`

Everything else depends on this, and it depends on nothing.

| Path | Purpose |
| --- | --- |
| `schemas/workflow.ts` | The graph: nodes and edges. Edges carry `from`, `fromPort`, `to` |
| `schemas/parameter-value.ts` | Every parameter is a `literal`, a `template` (`{{node.field}}`), or a `placeholder` |
| `schemas/placeholder.ts` | How the model says "I don't know" instead of inventing a value |
| `schemas/node-definition.ts` | The contract a node type declares: parameters in, output out, ports |
| `schemas/node-result.ts` | What a node reports back: output and fired ports, or an error |
| `catalog/` | The node types themselves |
| `validation/` | The validator and its error codes |
| `fixtures/` | Deliberately broken graphs used in tests |

### `packages/engine`

| Path | Purpose |
| --- | --- |
| `types/` | Execution contracts, defined before any implementation |
| `context/run-context.ts` | Live run state — node outputs and edge states |
| `resolve/` | Resolves `{{references}}` at runtime, then re-validates against the schema |
| `executors/` | One executor per node type, plus `dispatch` |
| `services/` | All I/O behind an interface, so tests can substitute fakes |

### `packages/db`

Postgres via Drizzle. Two tables: `workflows` (graph stored as JSONB) and `node_types`. The `node_types` rows are **generated from the catalog** by `seed.ts` rather than written by hand, so the database can't drift out of sync with the code.

## Node catalog

| Type | Name | Category |
| --- | --- | --- |
| `manual.trigger` | Manual Trigger | trigger |
| `webhook.trigger` | Webhook Trigger | trigger |
| `http.request` | HTTP Request | action |
| `llm.prompt` | LLM Prompt | action |
| `slack.post` | Slack Post | action |
| `logic.if` | IF | logic |

## What the validator checks

Run in order, collecting every problem rather than stopping at the first:

1. **Structure** — the graph is shaped like a workflow at all
2. **Duplicate node ids**
3. **Node types and parameters** — every type exists in the catalog; required parameters are present and correctly typed; unknown parameters are rejected
4. **Trigger rules** — exactly one trigger, no incoming edges to it, every node reachable from it
5. **Edges** — both ends exist, the output port exists on the source node, no duplicates
6. **References** — `{{node.field}}` must point at a node that is genuinely *upstream*, and at a field that actually exists on its declared output
7. **Cycles** — detected via Kahn's algorithm, which also yields the execution order

Unresolved placeholders surface as **warnings**, not errors — the graph is structurally sound, it just needs input from the user before it can run.

## Security

`engine/services/ssrf.ts` guards every outbound HTTP request. Without it, a generated workflow could reach addresses inside your own network — including cloud metadata endpoints. The guard rejects private, loopback, link-local, and reserved ranges for both IPv4 and IPv6, resolves DNS before connecting, and re-checks after every redirect.

`ALLOW_PRIVATE_NETWORK=true` disables it. Local development only.

## Getting started

Requires Node.js and a PostgreSQL database.

```bash
git clone https://github.com/NishaM2/Validator.git
cd Validator
npm install
```

Create a `.env` in the repository root:

```bash
DATABASE_URL=postgres://user:password@host:5432/flowforge
LLM_API_KEY=
SLACK_BOT_TOKEN=
```

Create the tables and load the node catalog:

```bash
npm run push -w packages/db
npm run seed -w packages/db
```

Start the web app:

```bash
npm run dev
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js app |
| `npm test -w packages/core` | Validator tests |
| `npm test -w packages/engine` | Engine tests |
| `npm run typecheck -w packages/core` | Type check core |
| `npm run format` | Prettier across the repo |
| `npm run generate -w packages/db` | Generate a migration from the schema |
| `npm run push -w packages/db` | Apply the schema to the database |
| `npm run seed -w packages/db` | Seed the node catalog into the database |

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `LLM_API_KEY` | yes | Language model access |
| `SLACK_BOT_TOKEN` | yes | Slack posting |
| `ALLOW_PRIVATE_NETWORK` | no | Disables the SSRF guard. Development only |

## Status

The foundation — the schemas, the catalog, the validator, and the execution primitives — is built and tested. **57 tests passing** (13 core, 44 engine).

| Area | State |
| --- | --- |
| Schemas and node catalog | Done |
| Workflow validator | Done |
| Database schema and catalog seeding | Done |
| Engine contracts, run context, parameter resolution | Done |
| Executors and dispatch | Done |
| HTTP service and SSRF guard | Done |
| `executeWorkflow` orchestrator | Not implemented |
| LLM and Slack services | Stubbed |
| LLM compiler | Not started |
| Visual canvas | Not started |

## Design notes

**One source of truth.** Node types are declared once, in `core/catalog`. The validator, the executors, the database rows, and the model's prompt are all derived from that declaration. A hand-written copy would drift the moment a field changed — and then the model would be grounded in something untrue.

**Contracts before implementation.** `engine/types` was written before any executor. Every part built afterwards had to fit a shape that was already agreed.

**I/O behind an interface.** Network, LLM, Slack, logging, and time all sit behind `Services`, so tests substitute fakes — including a virtual clock that fast-forwards instead of sleeping.

**Executors are held to their own contract.** `dispatch` re-validates every executor's output against the shape its definition declared. The validator made a promise to the user; this is what keeps it.
