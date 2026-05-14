#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CLUSTER_NAME=kaytoo-e2e
KAYTOO_E2E_IMAGE=kaytoo-e2e:local
E2E_GENERATED="${SCRIPT_DIR}/.generated"
KIND_KUBECONFIG="${E2E_GENERATED}/kubeconfig-kind-${CLUSTER_NAME}"
KIND_PF_KUBECONFIG="${KIND_KUBECONFIG}.docker"
KCP="${CLUSTER_NAME}-control-plane"
KUBECTL_CP=(kubectl --kubeconfig=/etc/kubernetes/admin.conf)
TOOLS_IMAGE=dtzar/helm-kubectl:3.14

e2e_die() { echo "[e2e] ERROR: $*" >&2; exit 1; }
e2e_log() { echo "[e2e] $*" >&2; }
e2e_ns() { echo "${E2E_NAMESPACE:-elastiflow}"; }
e2e_wait_http() {
  local url=$1 tries=${2:-30} i
  for ((i = 0; i < tries; i++)); do
    curl -sf "$url" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

e2e_ensure_generated_layout() {
  mkdir -p "$E2E_GENERATED"
  local legacy="${SCRIPT_DIR}/.kubeconfig-kind-${CLUSTER_NAME}"
  if [[ -f "$legacy" && ! -e "$KIND_KUBECONFIG" ]]; then
    e2e_log "moved legacy kubeconfig -> $KIND_KUBECONFIG"
    mv "$legacy" "$KIND_KUBECONFIG"
  fi
  if [[ -f "${legacy}.docker" && ! -e "$KIND_PF_KUBECONFIG" ]]; then
    mv "${legacy}.docker" "$KIND_PF_KUBECONFIG"
  fi
}

export_kube() {
  e2e_ensure_generated_layout
  if [[ -z "${KUBECONFIG:-}" || ! -f "$KUBECONFIG" ]]; then
    export KUBECONFIG="$KIND_KUBECONFIG"
  else
    export KUBECONFIG
  fi
}

ki() { KUBECONFIG="$KIND_KUBECONFIG" command kind "$@"; }
kcp() { docker exec "$KCP" "${KUBECTL_CP[@]}" "$@"; }
fmt_hms() { local e=${1:-0}; printf '%d:%02d:%02d' $((e / 3600)) $(((e % 3600) / 60)) $((e % 60)); }

usage() { echo "usage: e2e/cli.sh up|down|verify|status|logs|dev" >&2; exit 1; }

source_e2e_env() {
  local R="${REPO_ROOT}/.env"
  if [[ -n "${E2E_ENV_FILE:-}" ]]; then
    [[ -f "$E2E_ENV_FILE" ]] || e2e_die "missing E2E_ENV_FILE=$E2E_ENV_FILE"
    e2e_log "env: E2E_ENV_FILE=$E2E_ENV_FILE"
    set -a
    # shellcheck source=/dev/null
    source "$E2E_ENV_FILE"
    set +a
  else
    [[ -f "$R" ]] || e2e_die "missing $R (OPENSEARCH_PASSWORD, LLM_*; or set E2E_ENV_FILE)"
    e2e_log "env: $R"
    set -a
    # shellcheck source=/dev/null
    source "$R"
    set +a
  fi
  ensure_llm_env_or_prompt
  [[ -n "${OPENSEARCH_PASSWORD:-}" ]] || e2e_die "OPENSEARCH_PASSWORD missing (${E2E_ENV_FILE:-$R})"
}

ensure_llm_env_or_prompt() {
  [[ -n "${LLM_BASE_URL:-}" && -n "${LLM_API_KEY:-}" ]] && return 0
  local append_to="${REPO_ROOT}/.env"
  if [[ -n "${E2E_ENV_FILE:-}" && -f "$E2E_ENV_FILE" ]]; then
    append_to="$E2E_ENV_FILE"
  fi
  [[ -t 0 ]] || e2e_die "LLM_BASE_URL/LLM_API_KEY missing (non-interactive). Set in $append_to or export before e2e:up"
  e2e_log "LLM_* missing; enter once (appends to $append_to)"
  local url key model
  read -r -p "LLM_BASE_URL: " url || true
  read -r -s -p "LLM_API_KEY: " key || true
  echo
  read -r -p "LLM_MODEL (optional): " model || true
  [[ -n "${url:-}" && -n "${key:-}" ]] || e2e_die "LLM_BASE_URL and LLM_API_KEY required"
  umask 077
  [[ -f "$append_to" ]] || : >"$append_to"
  {
    echo ""
    echo "# Added by e2e/cli.sh"
    echo "LLM_BASE_URL=$url"
    echo "LLM_API_KEY=$key"
    [[ -n "${model:-}" ]] && echo "LLM_MODEL=$model"
  } >>"$append_to"
  chmod 600 "$append_to" 2>/dev/null || true
  set -a
  # shellcheck source=/dev/null
  source "$append_to"
  set +a
}

stop_pf_containers() {
  local i
  i=$(docker ps -q --filter label=kaytoo-e2e.pf=1 2>/dev/null || true)
  [[ -z "${i:-}" ]] || docker stop "$i" &>/dev/null || true
}

start_pf_container() {
  local host_port=$1 svc=$2 kc=$3
  local target_port=${4:-$host_port}
  docker run -d --rm --label kaytoo-e2e.pf=1 --add-host=host.docker.internal:host-gateway \
    -p "${host_port}:${host_port}" -e KUBECONFIG=/kubeconfig -v "${kc}:/kubeconfig:ro" \
    --entrypoint kubectl "$TOOLS_IMAGE" --kubeconfig=/kubeconfig --insecure-skip-tls-verify \
    port-forward --address=0.0.0.0 -n elastiflow "svc/${svc}" "${host_port}:${target_port}"
}

check_prerequisites() {
  command -v docker &>/dev/null || e2e_die "docker not in PATH"
  docker info &>/dev/null || e2e_die "Docker not running"
  command -v kind &>/dev/null || e2e_die "kind not in PATH"
  command -v node &>/dev/null || e2e_die "node not in PATH (Helm LLM overlay)"
}

cleanup() {
  e2e_log "cleanup..."
  stop_pf_containers
  if ! command -v kind &>/dev/null; then
    e2e_log "WARN: kind not in PATH; skipped cluster delete"
    return 0
  fi
  if ki get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
    ki delete cluster --name "$CLUSTER_NAME" || { e2e_log "ERROR: kind delete failed"; return 1; }
  fi
  if docker image inspect "$KAYTOO_E2E_IMAGE" &>/dev/null; then
    docker rmi "$KAYTOO_E2E_IMAGE" &>/dev/null || e2e_log "WARN: docker rmi $KAYTOO_E2E_IMAGE failed"
  fi
  rm -f "${SCRIPT_DIR}/.kubeconfig-kind-${CLUSTER_NAME}" "${SCRIPT_DIR}/.kubeconfig-kind-${CLUSTER_NAME}.docker"
  rm -f "${REPO_ROOT}/helm/kaytoo/values-e2e.llm.local.json"
  rm -rf "$E2E_GENERATED"
  e2e_log "cleanup done"
}

create_cluster() {
  if ki get clusters | grep -q "^${CLUSTER_NAME}$"; then
    e2e_log "WARN: cluster $CLUSTER_NAME exists"
    read -r -p "Delete and recreate? (y/N) " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]] && ki delete cluster --name "$CLUSTER_NAME" || return
  fi
  ki create cluster --name "$CLUSTER_NAME"
  kcp wait --for=condition=Ready nodes --all --timeout=5m
}

deploy_stack() {
  local m="$SCRIPT_DIR/k8s/bootstrap.yaml" chart="${REPO_ROOT}/helm/kaytoo" e2e_vals="$SCRIPT_DIR/k8s/kaytoo-values.yaml"
  [[ -f "$m" ]] || e2e_die "missing $m"
  [[ -f "$chart/Chart.yaml" ]] || e2e_die "missing Helm chart $chart"
  [[ -f "$e2e_vals" ]] || e2e_die "missing $e2e_vals"
  e2e_log "docker build $KAYTOO_E2E_IMAGE"
  docker build -t "$KAYTOO_E2E_IMAGE" -f "${REPO_ROOT}/Dockerfile" "${REPO_ROOT}"
  ki load docker-image "$KAYTOO_E2E_IMAGE" --name "$CLUSTER_NAME"
  source_e2e_env
  local llm_gen="${E2E_GENERATED}/values-e2e.llm.local.json" k_rendered="${E2E_GENERATED}/kaytoo-values.rendered.yaml"
  rm -f "${chart}/values-e2e.llm.local.json" "$llm_gen" "$k_rendered"
  e2e_log "write LLM overlay -> $llm_gen"
  node "${SCRIPT_DIR}/write-e2e-llm-overlay.mjs"
  e2e_log "render kaytoo values (OpenSearch password) -> $k_rendered"
  node -e 'const fs=require("node:fs");const [,src,dst]=process.argv;const pw=process.env.OPENSEARCH_PASSWORD;if(!pw)process.exit(2);fs.writeFileSync(dst,fs.readFileSync(src,"utf8").split("__KAYTOO_E2E_OPENSEARCH_PASSWORD__").join(pw));' "$e2e_vals" "$k_rendered"
  e2e_log "docker pull $TOOLS_IMAGE"
  docker pull -q --platform "$(case "$(uname -m)" in arm64|aarch64) echo linux/arm64;; *) echo linux/amd64;; esac)" "$TOOLS_IMAGE"
  e2e_log "copy chart -> $KCP:/kaytoo-chart"
  docker exec "$KCP" sh -c 'rm -rf /kaytoo-chart && mkdir -p /kaytoo-chart'
  docker cp "${chart}/." "${KCP}:/kaytoo-chart/"
  docker cp "$k_rendered" "${KCP}:/kaytoo-chart/kaytoo-values.yaml"
  docker cp "$llm_gen" "${KCP}:/kaytoo-chart/values-e2e.llm.local.json"
  kcp delete job kaytoo-e2e-bootstrap -n default --ignore-not-found
  e2e_log "apply bootstrap job"
  sed "s/__KAYTOO_E2E_OPENSEARCH_PASSWORD__/${OPENSEARCH_PASSWORD}/g" "$m" | docker exec -i "$KCP" "${KUBECTL_CP[@]}" apply -f -
  kcp wait --for=condition=complete job/kaytoo-e2e-bootstrap -n default --timeout=1800s ||
    { e2e_log "ERROR: bootstrap failed"; kcp logs job/kaytoo-e2e-bootstrap -n default --tail=200 || true; exit 1; }
}

setup_port_forward() {
  e2e_log "port-forwards"
  stop_pf_containers
  ki get kubeconfig --name "$CLUSTER_NAME" | sed 's|https://127.0.0.1:|https://host.docker.internal:|g' >"$KIND_PF_KUBECONFIG"
  start_pf_container 9200 opensearch-cluster-master "$KIND_PF_KUBECONFIG"
  start_pf_container 5601 mermin-opensearch-dashboards "$KIND_PF_KUBECONFIG"
  start_pf_container 18080 kaytoo-chat "$KIND_PF_KUBECONFIG" 8080
  cat <<EOF >&2
========================================
Kaytoo e2e ready ($(fmt_hms "$SECONDS"))
========================================
Kaytoo:     kubectl --kubeconfig=${KIND_KUBECONFIG} -n elastiflow logs deploy/kaytoo -f
OpenSearch: https://127.0.0.1:9200  (admin / OPENSEARCH_PASSWORD from repo .env)
Dashboards: http://localhost:5601
Chat:       http://127.0.0.1:18080
KUBECONFIG: export KUBECONFIG=${KIND_KUBECONFIG}
Host dev:   npm run e2e:dev
Teardown:   npm run e2e:down
EOF
}

cmd_up() {
  e2e_log "e2e up"
  SECONDS=0
  check_prerequisites
  e2e_ensure_generated_layout
  create_cluster
  deploy_stack
  setup_port_forward
}

verify_source_env() {
  if [[ -n "${E2E_ENV_FILE:-}" && -f "$E2E_ENV_FILE" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$E2E_ENV_FILE"
    set +a
  elif [[ -f "${REPO_ROOT}/.env" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "${REPO_ROOT}/.env"
    set +a
  fi
}

cmd_verify() {
  export_kube
  CHAT_PF_LOCAL="${CHAT_PF_LOCAL:-18080}"
  verify_source_env
  OS_URL="${OS_URL:-${OPENSEARCH_URL:-}}"
  OS_USER="${OS_USER:-${OPENSEARCH_USERNAME:-}}"
  OS_PASS="${OS_PASS:-${OPENSEARCH_PASSWORD:-}}"
  [[ -n "${OS_URL:-}" && -n "${OS_USER:-}" && -n "${OS_PASS:-}" ]] ||
    e2e_die "missing OS_URL/OS_USER/OS_PASS (set in repo .env or E2E_ENV_FILE)"
  local ns
  ns="$(e2e_ns)"
  kubectl -n "$ns" rollout status deploy/kaytoo --timeout=120s
  kaytoo_pod() {
    kubectl -n "$ns" get pods -l 'app.kubernetes.io/name=kaytoo,app.kubernetes.io/instance=kaytoo' \
      --field-selector=status.phase=Running --sort-by=.metadata.creationTimestamp \
      -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null | tail -n 1
  }
  kubectl -n "$ns" get svc kaytoo-chat &>/dev/null || e2e_die "svc/kaytoo-chat missing"
  local PF_CHAT=0
  cleanup_pf() { kill "${PF_CHAT:-0}" 2>/dev/null || true; }
  trap cleanup_pf EXIT
  local CHAT_BASE="http://127.0.0.1:${CHAT_PF_LOCAL}"
  if ! e2e_wait_http "${CHAT_BASE}/health" 2; then
    e2e_log "kubectl port-forward svc/kaytoo-chat ${CHAT_PF_LOCAL}:8080"
    kubectl -n "$ns" port-forward "svc/kaytoo-chat" "${CHAT_PF_LOCAL}:8080" &
    PF_CHAT=$!
  fi
  e2e_wait_http "${CHAT_BASE}/health" 30 || e2e_die "chat not reachable :${CHAT_PF_LOCAL}"
  e2e_log "chat.mjs basics"
  CHAT_BASE="$CHAT_BASE" node "$REPO_ROOT/e2e/chat.mjs" basics
  e2e_log "chat.mjs top-talkers"
  CHAT_BASE="$CHAT_BASE" OS_URL="$OS_URL" OS_USER="$OS_USER" OS_PASS="$OS_PASS" node "$REPO_ROOT/e2e/chat.mjs" top-talkers
  local pod
  pod="$(kaytoo_pod)"
  [[ -n "$pod" ]] || e2e_die "no Running kaytoo pod"
  e2e_log "logs pod=$pod"
  logs_grep() {
    local pat=$1 n=${2:-12000}
    (set +o pipefail; kubectl -n "$ns" logs "$pod" -c kaytoo --tail="$n" 2>/dev/null | grep -q "$pat")
  }
  e2e_log "expect topTalkersByBytes in logs"
  logs_grep 'agent tool finished' || { kubectl -n "$ns" logs "$pod" -c kaytoo --tail=120; exit 1; }
  logs_grep '"tool":"topTalkersByBytes"' || { kubectl -n "$ns" logs "$pod" -c kaytoo --tail=120; exit 1; }

  e2e_log "OpenSearch Anomaly Detection API (expect HTTP 200, not 404)"
  local ad_http os_base="${OS_URL%/}"
  ad_http="$(curl -k -sS -o /dev/null -w '%{http_code}' -u "${OS_USER}:${OS_PASS}" \
    -X POST "${os_base}/_plugins/_anomaly_detection/detectors/_search" \
    -H 'Content-Type: application/json' \
    -d '{"query":{"match_all":{}},"size":1}' 2>/dev/null || echo "000")"
  [[ "$ad_http" == "200" ]] || e2e_die "AD detectors/_search returned HTTP ${ad_http} (plugin missing or auth?)"

  e2e_log "OpenSearch AD: expect Kaytoo egress detector in list (seed/adopt)"
  local ad_json
  ad_json="$(curl -k -sS -u "${OS_USER}:${OS_PASS}" \
    -X POST "${os_base}/_plugins/_anomaly_detection/detectors/_search" \
    -H 'Content-Type: application/json' \
    -d '{"query":{"match_all":{}},"size":50}' 2>/dev/null || true)"
  echo "$ad_json" | grep -q 'Kaytoo flow egress' ||
    e2e_die "AD detector list missing Kaytoo egress detector (native pipeline seed/adopt)"

  e2e_log "Kaytoo logs: native AD must not report plugin 404"
  if logs_grep 'OpenSearch Anomaly Detection plugin not available (404)' 25000; then
    kubectl -n "$ns" logs "$pod" -c kaytoo --tail=200 >&2
    e2e_die "Kaytoo logged AD plugin unavailable (404)"
  fi

  e2e_log "wait for scheduled insight poll (e2e uses pollIntervalSeconds=15)"
  sleep 20

  e2e_log "Kaytoo logs: console insight path (insight_post, posted findings, or heuristic skip when native idle)"
  if logs_grep 'insight_post' 25000 || logs_grep '"msg":"posted findings"' 25000 || logs_grep 'skipping heuristic detectors' 25000; then
    e2e_log "insight engine activity ok (console insight_post, posted findings, or native-idle heuristic skip)"
  else
    kubectl -n "$ns" logs "$pod" -c kaytoo --tail=200 >&2
    e2e_die "no insight_post, posted findings, or heuristic-skip in recent logs (see tail above)"
  fi

  if logs_grep 'Anomaly' 25000; then
    e2e_log "optional: Anomaly wording in logs (likely opensearch_anomaly insight path)"
  else
    e2e_log "optional: no Anomaly string in recent logs (normal if no graded AD hits this window)"
  fi

  e2e_log "OK verify"
}

cmd=${1:-}
[[ -n "$cmd" ]] || usage

case "$cmd" in
  up) cmd_up ;;
  down | cleanup) cleanup ;;
  verify) cmd_verify ;;
  status)
    export_kube
    e2e_log "OpenSearch https://127.0.0.1:9200 | Dashboards http://127.0.0.1:5601 | Chat http://127.0.0.1:18080"
    if [[ -f "$KUBECONFIG" ]] && command -v kubectl >/dev/null 2>&1; then
      kubectl -n "$(e2e_ns)" get pods -l 'app.kubernetes.io/name=kaytoo' 2>/dev/null || e2e_log "kubectl: no kaytoo pods"
    else
      e2e_log "kubeconfig missing (run e2e:up)"
    fi
    ;;
  logs)
    export_kube
    kubectl -n "$(e2e_ns)" logs deploy/kaytoo -c kaytoo -f
    ;;
  dev)
    if [[ -n "${E2E_ENV_FILE:-}" && -f "$E2E_ENV_FILE" ]]; then
      set -a
      # shellcheck source=/dev/null
      source "$E2E_ENV_FILE"
      set +a
    elif [[ -f "${REPO_ROOT}/.env" ]]; then
      set -a
      # shellcheck source=/dev/null
      source "${REPO_ROOT}/.env"
      set +a
    else
      e2e_die "missing ${REPO_ROOT}/.env or E2E_ENV_FILE (OPENSEARCH_*, LLM_* for host dev)"
    fi
    cd "$REPO_ROOT"
    exec npm run dev -- --output console
    ;;
  *) usage ;;
esac
