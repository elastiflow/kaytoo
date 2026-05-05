# Kaytoo Helm chart repository

This branch is used to publish the Helm chart index for GitHub Pages.

Kaytoo can be installed from the official helm chart:

```bash
helm repo add kaytoo https://elastiflow.github.io/kaytoo
helm repo update

helm upgrade --install kaytoo kaytoo/kaytoo \
  --namespace elastiflow --create-namespace
```
