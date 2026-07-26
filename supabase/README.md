# OpenPencil Cloud

This folder is the dedicated OpenPencil backend. It is intentionally separate from Smylr or any other product database.

## Create and link the hosted project

```sh
bunx supabase login
bunx supabase link --project-ref <openpencil-project-ref>
bunx supabase db push
```

Then copy the project's API URL and publishable anon key into a local `.env.local` or the production app deployment:

```sh
VITE_OPENPENCIL_SUPABASE_URL=https://<openpencil-project-ref>.supabase.co
VITE_OPENPENCIL_SUPABASE_ANON_KEY=<publishable-anon-key>
```

Restart Vite after changing the environment. The schema keeps user accounts, workspace membership, one-time invites, durable Yjs updates, and compacted document snapshots behind row-level security.
