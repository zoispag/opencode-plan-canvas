# XSS Escaping Plan

## TODOs

- [ ] 1. <script>alert(1)</script> & "quotes"

## Decisions Needed / Defaults Applied

- **D-XSS (OPEN)**: <img onerror=alert(1) src=x> should render as inert escaped text
