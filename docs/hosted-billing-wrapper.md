# Hosted Billing Wrapper

OpenNapse keeps Stripe-specific code out of the public MIT repo. The public app
only contains a generic billing client and inert UI gated by `VITE_BILLING_URL`.
The private wrapper owns Stripe secrets, checkout, the customer portal, and
webhook processing.

## Public app contract

Set `VITE_BILLING_URL` to the private wrapper base URL. If it is missing, all
billing UI stays informational and the app remains local/self-host friendly.

The browser sends the Supabase access token as `Authorization: Bearer <jwt>`.
The wrapper must derive `user_id` and email from the JWT; never trust user or
email values from the request body.

### `GET /subscription-status?workspaceId=<uuid>`

Returns the caller's plan for the workspace after verifying owner/admin access.

```json
{
  "planId": "pro",
  "planName": "Pro",
  "status": "active",
  "periodEnd": "2026-08-01T00:00:00Z",
  "features": { "cloud_sync": true, "team_workspaces": true },
  "plans": [
    { "id": "pro", "name": "Pro", "priceLabel": "$12/mo", "features": ["Cloud sync", "Higher AI limits"] }
  ]
}
```

### `POST /create-checkout`

Body:

```json
{ "workspaceId": "uuid", "planId": "pro" }
```

Returns `{ "url": "https://checkout.stripe.com/..." }`.

### `POST /billing-portal`

Body:

```json
{ "workspaceId": "uuid" }
```

Returns `{ "url": "https://billing.stripe.com/..." }`.

## Private wrapper responsibilities

- Verify Supabase JWT on every non-webhook request.
- Verify caller is owner/admin of the workspace.
- Create Stripe Checkout sessions using server-derived `user_id`, email, and
  workspace ID metadata.
- Create Stripe Billing Portal sessions for existing customers.
- Verify Stripe webhook signatures using the raw request body.
- Upsert `workspace_subscriptions` with service role.
- Never expose `STRIPE_SECRET_KEY` or webhook secrets to the browser.
