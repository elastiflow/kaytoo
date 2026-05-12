# Kaytoo e2e (kind)

Local stack: **Mermin** + OpenSearch ([`k8s/mermin-stack-values.yaml`](k8s/mermin-stack-values.yaml), embedded in [`k8s/bootstrap.yaml`](k8s/bootstrap.yaml)) and **Kaytoo** ([`../helm/kaytoo`](../helm/kaytoo)) with harness overrides in [`k8s/kaytoo-values.yaml`](k8s/kaytoo-values.yaml).

## Commands (repo root)

| Command | Purpose |
| --- | --- |
| `npm run e2e:up` | kind cluster, image build/load, bootstrap Job, port-forwards |
| `npm run e2e:down` | Stop forwards, delete cluster, remove image + `e2e/.generated/` |
| `npm run e2e:verify` | Smoke: rollout, `/health`, `/chat`, OpenSearch-backed checks |
| `npm run e2e:status` | URLs + quick pod list |
| `npm run e2e:logs` | Tail Kaytoo in-cluster |
| `npm run e2e:dev` | Run Kaytoo on the host against forwarded OpenSearch |

**Host Helm is not required** - the bootstrap Job runs Helm in-cluster.

## Stack

| | |
| --- | --- |
| Cluster | `kind` name `kaytoo-e2e` |
| Namespace | `elastiflow` |
| Kaytoo | Helm release; HTTP chat `svc/kaytoo-chat:8080` (forwarded to **18080**) |
| Image | `kaytoo-e2e:local` from repo [`Dockerfile`](../Dockerfile) |
| LLM | Real API; credentials from `.env` via generated Helm fragment (below) |

## Configuration

**Source of truth:** repo-root [`.env`](../.env) (see [`.env.example`](../.env.example)). Optional: **`E2E_ENV_FILE`**.

| Variable | `e2e:up` | Notes |
| --- | --- | --- |
| `OPENSEARCH_PASSWORD` | required | Mermin/OpenSearch admin; also baked into rendered Kaytoo values |
| `LLM_BASE_URL` | required | OpenAI-compatible URL |
| `LLM_API_KEY` | required | |
| `LLM_MODEL` | optional | |

For **`e2e:verify`** / **`e2e:dev`** against host forwards, set e.g. `OPENSEARCH_URL=https://127.0.0.1:9200`, `OPENSEARCH_USERNAME=admin`, `OPENSEARCH_TLS_INSECURE=true`, `OPENSEARCH_INDEX_PATTERN=elastiflow-flow-codex-*`.

Interactive **`e2e:up`**: if `LLM_*` is missing, the script prompts once and appends to `.env` (or `E2E_ENV_FILE` when used).

## `e2e/.generated/` (gitignored)

Created during `e2e:up` (and by `npm run e2e:llm-overlay` for the LLM file only). Do not commit.

| Artifact | Role |
| --- | --- |
| `kubeconfig-kind-kaytoo-e2e` | Host / `kind` CLI - API server `https://127.0.0.1:...` |
| `kubeconfig-kind-kaytoo-e2e.docker` | Docker `kubectl port-forward` sidecars - same cluster, API host `host.docker.internal` |
| `kaytoo-values.rendered.yaml` | [`k8s/kaytoo-values.yaml`](k8s/kaytoo-values.yaml) + real `OPENSEARCH_PASSWORD` -> copied to node as `kaytoo-values.yaml` (**secrets**) |
| `values-e2e.llm.local.json` | LLM Helm `-f` from `.env` via `e2e/write-e2e-llm-overlay.mjs` |

Legacy `e2e/.kubeconfig-kind-*` at the `e2e/` root is moved into `.generated/` on first use.

## Bring up

```bash
npm run e2e:up
```

1. kind cluster `kaytoo-e2e` (prompts if it already exists).
2. `docker build` -> `kaytoo-e2e:local` -> `kind load`.
3. Writes `.generated/` (LLM JSON, rendered Kaytoo values), copies chart + those files to the control-plane node (`/kaytoo-chart/`), applies bootstrap Job.
4. Job: metrics-server, Mermin stack, `helm upgrade -i kaytoo ... -f kaytoo-values.yaml -f values-e2e.llm.local.json`.
5. Docker-based port-forwards: OpenSearch **9200**, Dashboards **5601**, chat **18080** -> `8080`.

**URLs after up:** OpenSearch `https://127.0.0.1:9200`, Dashboards `http://localhost:5601`, chat `http://127.0.0.1:18080`.

**kubectl** (from repo root):

```bash
export KUBECONFIG="$(pwd)/e2e/.generated/kubeconfig-kind-kaytoo-e2e"
kubectl -n elastiflow get pods
kubectl -n elastiflow logs deploy/kaytoo -c kaytoo -f
```

## Verify

With forwards up and OpenSearch reachable on the host:

```bash
export KUBECONFIG="$(pwd)/e2e/.generated/kubeconfig-kind-kaytoo-e2e"
npm run e2e:verify
```

`verify` starts a temporary chat port-forward if needed.

## Host Kaytoo (optional)

After `e2e:up`:

```bash
npm run e2e:dev
```

Uses the same `.env`; point OpenSearch at the forwards (e.g. `OPENSEARCH_URL=https://127.0.0.1:9200`).

## Tear down

```bash
npm run e2e:down
```

Removes forwards, cluster, `kaytoo-e2e:local` image, `e2e/.generated/`, and stale `e2e/.kubeconfig-kind-*`.

## Manifests to keep in sync

| What | Where |
| --- | --- |
| Mermin / OpenSearch | [`k8s/mermin-stack-values.yaml`](k8s/mermin-stack-values.yaml) + embedded key `mermin-stack-values.yaml` in [`k8s/bootstrap.yaml`](k8s/bootstrap.yaml) |
| Kaytoo chart | [`../helm/kaytoo`](../helm/kaytoo) |
| Kaytoo e2e overrides | [`k8s/kaytoo-values.yaml`](k8s/kaytoo-values.yaml) (placeholders only; secrets only in `.generated/` at deploy) |

**Helm preview** (no secrets in base `-f`):

```bash
helm template kaytoo ./helm/kaytoo -n elastiflow -f ./e2e/k8s/kaytoo-values.yaml
```

With LLM overlay (after `set -a && source .env && set +a`, run `npm run e2e:llm-overlay` if the JSON is not already there):

```bash
helm template kaytoo ./helm/kaytoo -n elastiflow \
  -f ./e2e/k8s/kaytoo-values.yaml \
  -f ./e2e/.generated/values-e2e.llm.local.json
```

To regenerate only the LLM fragment: `set -a && source .env && set +a` then `npm run e2e:llm-overlay`.
