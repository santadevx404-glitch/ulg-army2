# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Deployment on Vercel

This project stores all data (sections, items, courses, topics, accounts) and
uploaded images in a **Supabase** project — Vercel's serverless functions have
no writable local disk, so an external store is required.

1. Create a free project at [supabase.com](https://supabase.com) (no credit card required).
2. In the Supabase **SQL Editor**, run:
   ```sql
   create table if not exists app_kv (
     key text primary key,
     value jsonb not null
   );
   ```
3. In Supabase **Storage**, create a bucket named `media` and mark it **Public**.
4. In Supabase **Settings → API**, copy the **Project URL** and the **Secret key**
   (not the Publishable key).
5. In your Vercel project → **Settings → Environment Variables**, add:
   - `SUPABASE_URL` = the Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = the Secret key
6. **Redeploy** the project so the new environment variables take effect.
7. Open `/auth` on your live URL and create your first account — it becomes an
   admin automatically and can access `/admin`.

## Local development

You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

Create a `.env` file in the project root with the same two variables from step 5
above, then:

```sh
npm i
npm run dev
```

### Creating a developer/admin account

1. Run the app and open `/auth`.
2. Click "إنشاء حساب" (create account) and enter an email + password (6+ characters).
3. Log in — every account created this way is automatically an admin and can access `/admin`.

Passwords are hashed with scrypt, never stored in plain text.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
