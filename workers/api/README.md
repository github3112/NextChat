# Pyjri Cloud API Worker

This Worker owns Pyjri authentication and encrypted connection metadata. Chat
records are written to each user's own D1 database through the Cloudflare D1
REST API; they are not stored in the Pyjri authentication database.

## Headless Wrangler authentication

This Worker project is already scaffolded; do not run `wrangler init` in this
directory. On a headless machine, authenticate Wrangler with a Cloudflare API
token instead of `wrangler login`:

1. In the Cloudflare dashboard, create an account-owned API token for the
   account that will host this Worker and its auth D1 database. For first-time
   provisioning, grant only the required account-scoped permissions: Workers
   **Admin** to create the Worker and D1 **Admin** to create the auth database.
   If the Worker already exists, use Workers **Editor** for that Worker instead
   of product-wide Workers Admin. If you later configure a custom domain through
   Wrangler, also grant **Workers Routes Write** for the relevant zone. See
   Cloudflare's [token creation](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
   and [Wrangler permissions](https://developers.cloudflare.com/workers/authorization/)
   guides.
2. Make the token available to this shell or CI job as
   `CLOUDFLARE_API_TOKEN`, and set `CLOUDFLARE_ACCOUNT_ID` to the 32-character
   Cloudflare account ID. Use your environment's secret manager; do not put the
   token in this repository, `.env.local`, `.dev.vars`, command arguments, or
   chat. These variables authenticate the Wrangler CLI only; they are not
   end-user login credentials or Worker runtime secrets.
3. Verify the identity and account, then create the auth database:

   ```sh
   yarn wrangler whoami --account "$CLOUDFLARE_ACCOUNT_ID"
   yarn wrangler d1 create pyjri-auth
   ```

4. Copy the `database_id` from Wrangler's output into `d1_databases[0]` in
   `wrangler.jsonc`, then apply the remote migration:

   ```sh
   yarn d1:migrate:remote
   ```

5. Configure the application secrets and Worker hostname below before
   deploying. Remote D1 migration and deploy commands modify Cloudflare
   resources; inspect the selected account and database ID before running them.

The API token is used by Wrangler for provisioning and deployment. It is
separate from the Cloudflare credentials an end user may later provide to link
their own D1 database. It does not sign users into Pyjri. The current app
authentication setup uses Google OAuth; Wrangler's API-token authentication
does not create or expose an end-user Cloudflare login.

## Configure application authentication

The headless setup above creates the remote authentication database and applies
its migration. For local development, apply the migration to Wrangler's local
D1 instead:

```sh
yarn d1:migrate:local
```

For development, set `APP_ORIGIN` and `AUTH_BASE_URL` in a local Wrangler
environment. For production, bind a custom API hostname under the same
registrable domain as the web app (for example, `api.pyjri.com` and
`www.pyjri.com`). Do not rely on a `workers.dev` hostname for production
session cookies.

Create a Google OAuth web client and register this callback:

```text
https://api.pyjri.com/api/auth/callback/google
```

Set the Worker secrets without placing them in source control:

```sh
openssl rand -base64 32 | yarn wrangler secret put BETTER_AUTH_SECRET
openssl rand -base64 32 | yarn wrangler secret put DATA_ENCRYPTION_KEY
yarn wrangler secret put GOOGLE_CLIENT_ID
yarn wrangler secret put GOOGLE_CLIENT_SECRET
```

The app origin must exactly match the deployed frontend origin. The Worker
allows credentialed CORS only for that origin. The browser API URL is configured
at Next.js build time with `NEXT_PUBLIC_PYJRI_API_URL`.

## Connect a user's D1

Users create a D1 database and provide its Account ID, database ID, and a
Cloudflare API token scoped to the account's D1 read/write permissions. The
Worker validates access, creates the `pyjri_chats` table, then encrypts the
token with AES-GCM before saving it in the Pyjri auth D1. The API never returns
the token. Disconnecting retains chat data in the user's D1.

Deleting a Pyjri account removes that user's rows from `pyjri_chats` before
deleting the account. If the connected D1 is unavailable, the app asks whether
to keep those remote rows and delete the Pyjri account anyway. Local browser
chats are not deleted.

The encryption key must remain stable to decrypt existing tokens. Rotating it
requires a planned ciphertext re-encryption migration; replacing the secret
without re-encrypting will make stored tokens unusable.

## Development checks

```sh
yarn test
yarn typecheck
yarn dev
```
