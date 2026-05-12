> ⚠️ **Notice**  
> This repo is a small, experimental project built for fun and learning. It's shared publicly **as-is** with no promised support, roadmap, or guarantees.

<div align="center">
  <img src="assets/kaytoo.png" alt="Kaytoo logo" width="180" />

  <h1>Kaytoo</h1>

  <p>Query and monitor ElastiFlow network flows from your team's chat platform.</p>

  <p>
    <a href="#quick-start"><strong>Quick start</strong></a>
    -
    <a href="#deploy"><strong>Deploy</strong></a>
    -
    <a href="#configuration"><strong>Configure</strong></a>
    -
    <a href="#local-e2e-kind"><strong>E2E</strong></a>
  </p>

  <p>
    <a href="https://github.com/elastiflow/kaytoo/actions/workflows/ci.yml">
      <img alt="CI" src="https://github.com/elastiflow/kaytoo/actions/workflows/ci.yml/badge.svg" />
    </a>
    <a href="https://github.com/elastiflow/kaytoo/actions/workflows/release.yml">
      <img alt="Release workflow" src="https://github.com/elastiflow/kaytoo/actions/workflows/release.yml/badge.svg" />
    </a>
    <a href="https://github.com/elastiflow/kaytoo/releases">
      <img alt="Release" src="https://img.shields.io/github/v/release/elastiflow/kaytoo" />
    </a>
    <a href="https://github.com/elastiflow/kaytoo/issues">
      <img alt="Issues" src="https://img.shields.io/github/issues/elastiflow/kaytoo" />
    </a>
    <a href="https://github.com/elastiflow/kaytoo/stargazers">
      <img alt="Stars" src="https://img.shields.io/github/stars/elastiflow/kaytoo?style=flat" />
    </a>
    <img alt="License" src="https://img.shields.io/github/license/elastiflow/kaytoo" />
    <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A524-339933?logo=node.js&logoColor=white" />
  </p>
</div>

### Overview

**Kaytoo** is a chat-first interface for ElastiFlow data stored in OpenSearch or Elasticsearch. It functions as an OpenAI-compatible tool agent, allowing you to query, analyze, and monitor network flows directly from your team's chat platform.

- **Analysis**: Built-in tools for flow search, rankings, fan-in analysis, and namespace/protocol rollups.
- **Aggregations**: Bounded `flowAggregate` and heuristic detectors for anomaly identification.
- **Insights**: Optional scheduled posts to keep your team updated on network trends.
- **Multi-platform Support**: Slack (Socket Mode), Mattermost (WebSocket), and Matrix.
- **Ops-ready**: Structured JSON logging and an official Helm chart for easy Kubernetes deployment.

### Quick start

#### Prerequisites

- Node.js 24+
- Access to OpenSearch/Elasticsearch with ElastiFlow flow documents
- LLM endpoint (OpenAI-compatible)
- For chat adapters: credentials for the platform you're integrating with

#### Run locally (with Slack)

```bash
npm ci
export SLACK_BOT_TOKEN="xoxb-..."
export SLACK_APP_TOKEN="xapp-..."
export SLACK_CHANNEL_ID="C01234567"
export OPENSEARCH_URL="https://example.opensearch.org:9200"
export OPENSEARCH_USERNAME="admin"
export OPENSEARCH_PASSWORD="..."
export OPENSEARCH_TLS_INSECURE="true"
export LLM_BASE_URL="http://example.ai.org:3000"
export LLM_API_KEY="..."
export LLM_MODEL="gpt-5.4-codex"

npm run dev
```

#### Dev/e2e (no chat adapter)

This mode is intended for local development and e2e verification.

```bash
npm ci
export OPENSEARCH_URL="https://example.opensearch.org:9200"
export OPENSEARCH_USERNAME="admin"
export OPENSEARCH_PASSWORD="..."
export OPENSEARCH_TLS_INSECURE="true"
export LLM_BASE_URL="http://example.ai.org:3000"
export LLM_API_KEY="..."

npm run dev -- --output console
```

### Configuration

Kaytoo is configured via environment variables. For a minimal example, see `.env.example`.

#### Environment variables

**Chat adapters** - configure at least one to run in chat mode. Kaytoo posts scheduled insights to every configured platform and answers chat replies on the same platform a message arrives from. See the per-platform setup and full variable tables below:

- [Slack](#slack): `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_CHANNEL_ID`
- [Matrix](#matrix): `MATRIX_HOMESERVER`, `MATRIX_DEFAULT_ROOM_ID`, plus either `MATRIX_ACCESS_TOKEN` or `MATRIX_USER` + `MATRIX_PASSWORD`
- [Mattermost](#mattermost): `MATTERMOST_URL`, `MATTERMOST_TOKEN`, `MATTERMOST_CHANNEL_ID`

**Search backend** (Choose either OpenSearch or Elasticsearch. Do not set both)

**OpenSearch**

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `OPENSEARCH_URL` | yes | - | Example: `https://example.opensearch.org:9200`. |
| `OPENSEARCH_USERNAME` | yes | - | - |
| `OPENSEARCH_PASSWORD` | yes | - | - |
| `OPENSEARCH_TLS_INSECURE` | no | `false` | Set `true` to skip TLS verification. |
| `OPENSEARCH_INDEX_PATTERN` | no | `elastiflow-flow-codex-*` | Must match your ElastiFlow index naming/mapping. |
| `OPENSEARCH_MCP_URL` | no | - | If set, startup probes URL reachability only. |

**Elasticsearch**

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `ELASTICSEARCH_URL` | yes | - | Example: `https://elasticsearch:9200`. |
| `ELASTICSEARCH_USERNAME` | yes | - | - |
| `ELASTICSEARCH_PASSWORD` | yes | - | - |
| `ELASTICSEARCH_TLS_INSECURE` | no | `false` | Set `true` to skip TLS verification. |
| `ELASTICSEARCH_INDEX_PATTERN` | no | `elastiflow-flow-codex-*` | Must match your ElastiFlow index naming/mapping. |
| `ELASTICSEARCH_MCP_URL` | no | - | If set, startup probes URL reachability only. |

**LLM (OpenAI-compatible)**

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `LLM_BASE_URL` | yes | - | Example: `http://openwebui:3000` or `http://ollama-proxy:11434`. If the path is bare (no `/v1` or `/api/v1`), Kaytoo probes `/api/v1/models` then `/v1/models` once at startup and pins the responder. To skip the probe, include the version path (e.g. `http://openwebui:3000/api/v1`). |
| `LLM_API_KEY` | yes | - | Some self-hosted backends accept an empty string. |
| `LLM_MODEL` | no | `gpt-5.4-codex` | Must match a name your backend exposes (`/api/v1/models` or `/v1/models`). E.g. `gpt-4o`, `llama3.1`, `unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_XL`. A wrong name typically produces a LiteLLM `'NoneType' object has no attribute 'startswith'` 400. |

**Conversation agent (chat adapters: Slack / Matrix / Mattermost)**

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `KAYTOO_KB_DOCS_DIR` | no | - | Directory of `.md`/`.txt` docs; enables `kbSearch`. |
| `KAYTOO_MCP_JSONRPC_URL` | no | - | JSON-RPC endpoint; enables `mcpToolCall` (`tools/call`). |
| `KAYTOO_MCP_JSONRPC_BEARER` | no | - | Bearer token for the JSON-RPC endpoint. |

Agent tools include flow search, rankings, fan-in, rare-destination / port-scan / egress-vs-baseline queries, namespace traffic split, protocol x namespace rollup, and bounded `flowAggregate`. Use `KAYTOO_MCP_JSONRPC_URL` for custom JSON-RPC tools beyond that set.

#### Logging

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `LOG_LEVEL` | no | `info` | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`. |

Logging verbosity, redaction, and the `env` field use fixed defaults and are not configurable via environment variables.

In Kubernetes with Loki or VictoriaLogs, query on stable fields such as `component`, `level`, `pollId`, `eventId`, and `msg`. Service/env/version are emitted once on the `kaytoo starting` line; rely on pod labels elsewhere.

### Chat adapters

Kaytoo supports multiple adapters; configure the one(s) you need.

#### Slack

Uses Slack Socket Mode for inbound messages and the Web API for replies and scheduled insight posts.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `SLACK_BOT_TOKEN` | yes | - | Bot token (`xoxb-...`). |
| `SLACK_APP_TOKEN` | yes | - | App-level token for Socket Mode (`xapp-...`). |
| `SLACK_CHANNEL_ID` | yes | - | Channel for scheduled insight posts. |

##### Setup

These steps assume Slack Socket Mode.

1. **Create an app** at [api.slack.com/apps](https://api.slack.com/apps) (create from scratch, pick your workspace).

2. **Turn on Socket Mode** ( **Settings -> Socket Mode** ). Create an **App-Level Token** with the `connections:write` scope. Copy the token; it starts with `xapp-1-` - this is the **`SLACK_APP_TOKEN`**.

3. **OAuth & Permissions -> Scopes -> Bot Token Scopes** - add at least:
   - `chat:write` - post replies and insight summaries.
   - `channels:history` - receive `message` events in public channels the bot is in (add `groups:history` for private channels, and `im:history` / `mpim:history` if you want DMs / group DMs).

4. **Event Subscriptions** - enable events, then under **Subscribe to bot events** add:
   - `message.channels` (and `message.groups`, `message.im`, `message.mpim` if you enabled the matching history scopes in step 3).

5. **Install the app** to your workspace (**Install App**). Copy **Bot User OAuth Token** (`xoxb-...`) - this is the **`SLACK_BOT_TOKEN`**.

6. **Invite the bot** into channels where people should talk to it: `/invite @YourBotName`. Replies are posted in the same channel/thread as the user's message. In **Slack app settings -> Display Name** (and the app's short name), use **`kaytoo`** so teammates can mention **`@kaytoo`** consistently.

7. **`SLACK_CHANNEL_ID`** - the channel ID (starts with `C...`) where **scheduled insight** posts are sent (independent of which channel users chat in). Open the channel in Slack -> channel name -> *View channel details* or copy the channel link; the ID is the `C...` segment in the URL. The bot must be a member of that channel and allowed to post there.

8. Export the three Slack variables plus OpenSearch and LLM settings, and run Kaytoo (see **Run locally -> With Slack** below).

Official references: [Socket Mode](https://api.slack.com/apis/connections/socket), [token types](https://api.slack.com/authentication/token-types), [event types](https://api.slack.com/events/message).

#### Matrix

Uses [`matrix-js-sdk`](https://github.com/matrix-org/matrix-js-sdk) with an in-memory store (no local sync database). The bot auto-joins rooms it is invited to. End-to-end encrypted rooms are not supported for this bot path.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `MATRIX_HOMESERVER` | yes | - | Homeserver base URL. |
| `MATRIX_ACCESS_TOKEN` | one-of | - | Long-lived access token for the bot user. Required if `MATRIX_USER`/`MATRIX_PASSWORD` are not set. |
| `MATRIX_USER` | one-of | - | Username or full MXID for password login. Required together with `MATRIX_PASSWORD` if no access token is provided. |
| `MATRIX_PASSWORD` | one-of | - | Password for `MATRIX_USER`. Kaytoo logs in via `matrix-js-sdk` using `m.login.password` at startup. |
| `MATRIX_DEFAULT_ROOM_ID` | yes | - | Room for scheduled insight posts. Kaytoo also attempts to join it on startup. |

Provide **either** `MATRIX_ACCESS_TOKEN` **or** the `MATRIX_USER` + `MATRIX_PASSWORD` pair, not both. Token auth is preferred when the homeserver supports it.

##### Setup

1. **Create a dedicated Matrix user** for Kaytoo (recommended) on your homeserver.
   - If registration is closed, have a homeserver admin create the account.
   - Log in once with a Matrix client (for example Element) to confirm the account works.

2. **Pick an authentication method:**
   - **Access token** (preferred when available): in Element Web open **Help & About** -> **Advanced** -> **Access Token** (wording varies by client).
   - **Username + password** (fallback for homeservers that do not expose a token UI): use the same credentials your bot logs in with.

3. **Set Kaytoo env vars**:
   - `MATRIX_HOMESERVER` should be the **client API base URL** for your homeserver (often `https://matrix.example.com`, not always the same host as your MXID server part).
   - For token auth: set `MATRIX_ACCESS_TOKEN` from step 2.
   - For password auth: set `MATRIX_USER` (localpart `kaytoo` or full MXID `@kaytoo:matrix.example.org`) and `MATRIX_PASSWORD`.

4. **Room membership**:
   - Invite the bot user into each room where Kaytoo should respond.
   - Kaytoo auto-joins rooms it is invited to.

5. **Default room**:
   - Set `MATRIX_DEFAULT_ROOM_ID` to the room that should receive scheduled insight posts. Kaytoo also attempts to join this room on startup.

6. **Run Kaytoo** with OpenSearch/Elasticsearch + LLM configured (same as Slack).

Notes:
- End-to-end encrypted rooms are not supported for this bot path.
- Prefer non-encrypted rooms for operational chat bots.

#### Mattermost

Inbound messages use the Mattermost WebSocket API (`/api/v4/websocket`); outbound replies use REST. `MATTERMOST_URL`, `MATTERMOST_TOKEN`, and `MATTERMOST_CHANNEL_ID` enable chat mode.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `MATTERMOST_URL` | yes | - | Base URL for your Mattermost instance. |
| `MATTERMOST_TOKEN` | yes | - | Personal access token for the bot user. |
| `MATTERMOST_CHANNEL_ID` | yes | - | Channel ID where Kaytoo listens/posts. |
| `MATTERMOST_BOT_USER_ID` | no | - | Optional explicit bot user ID. |

##### Setup

1. **Create a dedicated Mattermost user** for Kaytoo (recommended).
   - Use a normal user account; Kaytoo authenticates with a personal access token.

2. **Create a Personal Access Token (PAT)** for that user.
   - In Mattermost: **Profile** -> **Security** -> **Personal Access Tokens** (wording varies by version).
   - Copy the token once; you cannot retrieve it later.
   - Treat the PAT like a password: rotate it if it leaks.

3. **Pick the channel** Kaytoo should monitor.
   - Copy the channel ID (Mattermost UI: channel menu -> **View Info** / channel header details; the ID is also visible in some deep links depending on version).
   - Add the Kaytoo user as a **member** of that channel.

4. **Set Kaytoo env vars**:
   - `MATTERMOST_URL` is your server base URL (example: `https://chat.example.com`).
   - `MATTERMOST_TOKEN` is the PAT from step 2.
   - `MATTERMOST_CHANNEL_ID` is the channel ID from step 3.

5. **(Optional) bot user id**:
   - Set `MATTERMOST_BOT_USER_ID` only if you need to pin the bot identity explicitly (most deployments can omit this).

6. **Run Kaytoo** with OpenSearch/Elasticsearch + LLM configured (same as Slack).

Notes:
- The bot user must be allowed to **read channel history** and **post messages** in the configured channel.
- If Kaytoo can connect but never responds, verify the user is in the channel and the channel ID matches the environment you configured.

### Deploy

#### Build and run container

```bash
docker build -t kaytoo:dev .
docker run --rm \
  -e SLACK_BOT_TOKEN \
  -e SLACK_APP_TOKEN \
  -e SLACK_CHANNEL_ID \
  -e OPENSEARCH_URL \
  -e OPENSEARCH_USERNAME \
  -e OPENSEARCH_PASSWORD \
  -e OPENSEARCH_TLS_INSECURE \
  -e OPENSEARCH_INDEX_PATTERN \
  -e OPENSEARCH_MCP_URL \
  -e LLM_BASE_URL \
  -e LLM_API_KEY \
  -e LLM_MODEL \
  kaytoo:dev
```

### Local e2e (kind)

End-to-end on **kind** uses the repo-root **`.env`** (OpenSearch password, LLM, etc.), generated files under **`e2e/.generated/`** (gitignored), and the scripts in **`e2e/`**. See [`e2e/README.md`](e2e/README.md) for bring-up, tear-down, verify, host dev, and file layout.

#### Deploy with Helm

The chart is in `helm/kaytoo`.

```bash
helm upgrade --install kaytoo ./helm/kaytoo \
  --namespace elastiflow --create-namespace \
  --set image.repository="<your-dockerhub-user>/kaytoo" \
  --set image.tag="latest" \
  --set config.slack.channelId="C01234567" \
  --set config.opensearch.url="https://example.opensearch.org:9200" \
  --set config.opensearch.tlsInsecure="true" \
  --set config.llm.baseUrl="http://openwebui.elastiflow.svc:3000" \
  --set secrets.slackBotToken="xoxb-..." \
  --set secrets.slackAppToken="xapp-..." \
  --set secrets.opensearchUsername="admin" \
  --set secrets.opensearchPassword="..." \
  --set secrets.llmApiKey="..."
```

### Development

#### Releases

Releases are driven by [`elastiflow/gha-reusable`](https://github.com/elastiflow/gha-reusable) `prepare-release`. The flow:

1. **Push to `main`** runs `prepare-release`, which may open a PR that:
   - bumps `helm/kaytoo/Chart.yaml` and `package.json`
   - prepends a new entry to `CHANGELOG.md`
2. **Squash-merge that PR.** Keep GitHub's default squash title so the commit subject is exactly `[release vX.Y.Z] (#NNN)`.
3. **The release commit** then triggers:
   - a GitHub release for `vX.Y.Z`
   - a container push to `ghcr.io/<owner>/<repo>`
   - a Helm chart GitHub release plus `cr index` publish to the `gh-pages` branch

#### Useful scripts

- `npm run lint`
- `npm test`
- `npm run build`
- `npm run dev` (runs `src/main.ts` via `tsx`)
- E2e (kind): see [`e2e/README.md`](e2e/README.md)

### License

Kaytoo is licensed under the Apache 2.0 license (see `LICENSE`).
