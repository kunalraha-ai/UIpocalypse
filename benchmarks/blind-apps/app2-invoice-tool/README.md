# Invoice Tool — Freelance Invoice Manager

A single-project Next.js (App Router + TypeScript) invoice manager for freelancers.
Invoice data is stored in a local JSON file (`data/invoices.json`) through API routes —
no external database.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Features

- **Create invoices** with line items (description, quantity, price), a live running
  total, and tax calculation (10% by default, editable per invoice).
- **Dashboard** — outstanding vs. paid totals, draft tracking, overdue flags.
- **Send invoices** — simulated delivery: shows a confirmation with an email preview.
  No real email is sent.
- **Mark invoices** as sent or paid.
- **Stripe Checkout in TEST mode** — `POST /api/invoices/:id/checkout` creates a test
  Checkout Session when a valid `sk_test_…` key is configured. The bundled key is a
  placeholder, so by default the app falls back to a built-in checkout simulator page
  that mimics Stripe Checkout (test mode) and marks the invoice paid. Live keys
  (`sk_live_…`) are refused.

## Configuration

`.env.local` holds `STRIPE_SECRET_KEY` (a placeholder `sk_test_…` string). Replace it
with your own test-mode key from the Stripe dashboard to use the real Stripe Checkout
sandbox.

## Data

All invoice data lives in `data/invoices.json` (auto-created on first use, gitignored).

## API overview

| Method | Route | Purpose |
| ------ | ----- | ------- |
| GET | `/api/invoices` | List invoices |
| POST | `/api/invoices` | Create an invoice (draft) |
| GET | `/api/invoices/:id` | Fetch one invoice |
| PATCH | `/api/invoices/:id` | Edit fields and/or change status |
| DELETE | `/api/invoices/:id` | Delete an invoice |
| POST | `/api/invoices/:id/send` | Simulate sending the invoice email |
| POST | `/api/invoices/:id/checkout` | Create a Stripe test-mode Checkout Session (falls back to the built-in simulator) |
| POST | `/api/checkout/confirm` | Mark an invoice paid (success-page / simulator callback) |
