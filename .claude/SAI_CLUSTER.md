# SAI Cluster — Deployment Guide for Claude

Copy this file into any project repo. When asked to create Kubernetes manifests or deploy to the cluster, follow every rule in this document exactly.

---

## Cluster Overview

| Property | Value |
|----------|-------|
| Type | k3s (lightweight Kubernetes) |
| Nodes | 3 — 1 control plane (`192.168.100.10`), 2 workers (`.11`, `.12`) |
| Hardware | QNAP TS-h1290FX NAS (x86_64 / amd64) |
| Public IP | `45.94.61.34` |
| Domain | `solutionsai.co.uk` |
| Ingress | Traefik (k3s built-in) |
| Storage | Rook-Ceph |
| TLS | cert-manager + Let's Encrypt (Cloudflare DNS-01) |
| Registry | Docker Hub — org: `solutionsai` |

---

## 1. Namespace

Every app gets its **own namespace** named after the app (lowercase, hyphens allowed).

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: my-app
```

All resources (Deployment, Service, Ingress, PVC, ConfigMap, Secret) must carry `namespace: my-app`.

---

## 2. Manifest File Structure

Create these files under `manifests/<app-name>/`:

```
namespace.yaml       # Namespace
configmap.yaml       # Non-sensitive env config
secrets.yaml         # Sensitive values (base64 encoded)
deployment.yaml      # Deployments + Services
ingress.yaml         # Ingress + TLS
postgres.yaml        # If app needs Postgres (PVC + StatefulSet + Service)
redis.yaml           # If app needs Redis
minio.yaml           # If app needs object storage
```

---

## 3. Docker Images

- All cluster nodes are **`linux/amd64`**. Images must be built for this platform.
- If building on Apple Silicon (M-series Mac), use: `docker buildx build --platform linux/amd64 -t solutionsai/<app>:latest --push .`
- Always set `imagePullPolicy: Always` when using the `latest` tag.
- Images from the `solutionsai` Docker Hub org are private — add the pull secret to every namespace (see §8).

```yaml
imagePullSecrets:
  - name: dockerhub-credentials
```

---

## 4. Storage — Rook-Ceph

**Always use `storageClassName: rook-ceph-block`**. Never use `local-path`, `hostPath`, or leave storageClassName blank.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-app-data
  namespace: my-app
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: rook-ceph-block
  resources:
    requests:
      storage: 10Gi
```

Typical sizes: Postgres 50Gi, Redis 10Gi, MinIO 100Gi, app data varies.

---

## 5. Ingress & TLS

**Always use `networking.k8s.io/v1` Ingress** — never use Traefik's `IngressRoute` CRD.

Every public app gets a subdomain `<app>.solutionsai.co.uk` with a Let's Encrypt production cert.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
  namespace: my-app
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - my-app.solutionsai.co.uk
      secretName: my-app-tls
  rules:
    - host: my-app.solutionsai.co.uk
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app
                port:
                  number: 80
```

Rules:
- `cert-manager.io/cluster-issuer: letsencrypt-prod` — always use prod, not staging
- `secretName` — use `<app>-tls` convention
- HTTP→HTTPS redirect is handled globally by Traefik — no annotation needed
- Cloudflare is set to **Full (Strict)** SSL mode — the cluster cert must be valid

---

## 6. DNS (Cloudflare)

Every new subdomain needs an **A record in Cloudflare** pointing to `45.94.61.34` with **proxied: true** (orange cloud).

This must be done before or alongside deploying the ingress so cert-manager can complete the DNS-01 challenge.

Cloudflare zone ID: `2555e6b1997c6b28e97172e3dd7d4789`

---

## 7. ConfigMap

Non-sensitive configuration (URLs, ports, feature flags, database names):

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: my-app-config
  namespace: my-app
data:
  NODE_ENV: "production"
  PORT: "3000"
  CLIENT_URL: "https://my-app.solutionsai.co.uk"
  API_URL: "https://my-app.solutionsai.co.uk"
```

Use `envFrom` in the deployment to load all keys:

```yaml
envFrom:
  - configMapRef:
      name: my-app-config
  - secretRef:
      name: my-app-secrets
```

---

## 8. Secrets

Sensitive values (passwords, API keys, tokens) go in a `secrets.yaml`. Values must be base64 encoded.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-app-secrets
  namespace: my-app
type: Opaque
data:
  DB_PASSWORD: <base64>
  JWT_SECRET: <base64>
```

**Docker Hub pull secret** — create this in every namespace that pulls private images:

```bash
kubectl create secret docker-registry dockerhub-credentials \
  --docker-username=solutionsai \
  --docker-password=<token> \
  --docker-server=https://index.docker.io/v1/ \
  --namespace=my-app
```

---

## 9. Databases (StatefulSets)

Databases run as StatefulSets with a **headless service** (`clusterIP: None`) inside the app's namespace. They are not shared between apps.

Internal DNS: `postgres.my-app.svc.cluster.local` (or just `postgres` within the same namespace).

### Postgres

```yaml
# Standard image
image: postgres:15-alpine

# Required env
POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, PGDATA=/var/lib/postgresql/data/pgdata

# Resources
requests: cpu:250m memory:512Mi
limits:   cpu:1000m memory:2Gi

# Readiness probe
exec: ["pg_isready", "-U", "<user>", "-d", "<db>"]
initialDelaySeconds: 10
```

### Redis

```yaml
image: redis:7-alpine
command: ["redis-server", "--appendonly", "yes", "--maxmemory", "512mb", "--maxmemory-policy", "allkeys-lru"]
requests: cpu:100m memory:256Mi
limits:   cpu:500m memory:1Gi
readiness: exec: ["redis-cli", "ping"]
```

### MinIO

```yaml
image: minio/minio:latest
command: ["minio", "server", "/data", "--console-address", ":9001"]
ports: 9000 (API), 9001 (console)
env: MINIO_ROOT_USER, MINIO_ROOT_PASSWORD
requests: cpu:250m memory:512Mi
limits:   cpu:1000m memory:2Gi
```

---

## 10. Internal Service Communication

Services within the same namespace communicate by service name only:

```
postgres        → postgres:5432
redis           → redis:6379
minio           → minio:9000
```

Cross-namespace: `<service>.<namespace>.svc.cluster.local`

SSL between internal services is **not required** — the cluster network is trusted. Use plain TCP for internal connections.

---

## 11. Resource Requests & Limits

Always set both `requests` and `limits`. Use these as baselines:

| Workload | CPU req | CPU lim | Mem req | Mem lim |
|----------|---------|---------|---------|---------|
| Static/frontend | 50m | 200m | 64Mi | 256Mi |
| API / backend | 100m | 500m | 256Mi | 512Mi |
| Worker / job | 100m | 1000m | 256Mi | 1Gi |
| Postgres | 250m | 1000m | 512Mi | 2Gi |
| Redis | 100m | 500m | 256Mi | 1Gi |
| MinIO | 250m | 1000m | 512Mi | 2Gi |

---

## 12. Probes

Always define `readinessProbe`. Add `livenessProbe` for long-running services.

```yaml
readinessProbe:
  httpGet:
    path: /health      # or /api/health, /, etc.
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
```

---

## 13. Deployment Checklist

When creating manifests for a new app:

- [ ] `namespace.yaml` — dedicated namespace
- [ ] `configmap.yaml` — non-sensitive env vars, with correct public URLs using `https://<app>.solutionsai.co.uk`
- [ ] `secrets.yaml` — sensitive values base64 encoded
- [ ] Deployment uses `imagePullSecrets: [{name: dockerhub-credentials}]`
- [ ] Image tag is `solutionsai/<app>:latest` with `imagePullPolicy: Always`
- [ ] All PVCs use `storageClassName: rook-ceph-block`
- [ ] Databases are StatefulSets with headless services
- [ ] Ingress uses `networking.k8s.io/v1`, `ingressClassName: traefik`, `cert-manager.io/cluster-issuer: letsencrypt-prod`
- [ ] TLS secret named `<app>-tls`
- [ ] Cloudflare A record added for `<app>.solutionsai.co.uk → 45.94.61.34` (proxied)
- [ ] Resource requests and limits set on all containers
- [ ] Readiness probes defined

---

## 14. Landing Page Registration

The landing page at `solutionsai.co.uk` auto-discovers services. To make a new app appear on it, add the following **label and annotations** to the app's Ingress resource:

```yaml
metadata:
  labels:
    sai.landing/show: "true"          # required — makes it visible
  annotations:
    sai.landing/agent-id: "AGENT-003"             # display ID on the card
    sai.landing/name: "My App"                    # display name
    sai.landing/description: "One sentence describing what the app does."
    sai.landing/tags: "Tag1,Tag2,Tag3"            # comma-separated
    sai.landing/stack: "Node.js / React"          # tech stack summary
    sai.landing/order: "3"                        # sort order on the page
```

The landing page polls for changes every 60 seconds — no redeploy needed.

---

## 15. Applying Manifests

```bash
# SSH to control plane
ssh sai@192.168.100.10

export KUBECONFIG=/home/sai/.kube/config

# Apply in order
kubectl apply -f manifests/my-app/namespace.yaml
kubectl apply -f manifests/my-app/configmap.yaml
kubectl apply -f manifests/my-app/secrets.yaml
kubectl apply -f manifests/my-app/postgres.yaml   # if needed
kubectl apply -f manifests/my-app/redis.yaml      # if needed
kubectl apply -f manifests/my-app/minio.yaml      # if needed
kubectl apply -f manifests/my-app/deployment.yaml
kubectl apply -f manifests/my-app/ingress.yaml

# Verify
kubectl get pods -n my-app
kubectl get certificate -n my-app
```

To force a new image pull without changing anything:
```bash
kubectl rollout restart deployment/<name> -n my-app
```
