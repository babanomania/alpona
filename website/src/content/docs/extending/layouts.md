---
title: Adding a layout
description: A layout is a single JSON file — no code required.
sidebar: { order: 1 }
---

A layout template is a versioned JSON file in
`packages/core/src/layouts/templates/`: named slots, each with a grid region,
accepted widget types, min/max counts, and an overflow rule. Designers can
contribute one without writing code.

The planner picks a layout and fills its slots; the composer enforces the
contract (counts, accepted types, overlap-freedom) deterministically. The
layout test suite validates every template automatically — see the
[layout gallery](/reference/layouts).
