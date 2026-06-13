---
title: Auth providers
description: One verification layer for every OIDC issuer.
sidebar: { order: 4 }
---

Auth is pluggable middleware with three modes: `none` (playground), `apikey`
(a static shared key), and `oidc`. The OIDC layer verifies JWTs — Supabase
Auth, Keycloak, Zitadel, and better-auth are all just issuers. Supabase GoTrue
self-hosted signs with a shared HS256 secret (`ALPONA_JWT_SECRET`); hosted
issuers publish a JWKS. Either way, `/api/health` stays open and everything
else under `/api` requires credentials.
