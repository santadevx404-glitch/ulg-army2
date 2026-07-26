# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

No environment variables, no external database, and no third-party account are needed.
Everything (developer accounts, sections, items, and uploaded images) is stored locally
on disk under `data/` and `public/uploads/`, created automatically the first time you
run the app.

### Creating a developer/admin account

1. Run the app (`npm run dev`) and open `/auth`.
2. Click "إنشاء حساب" (create account) and enter an email + password (6+ characters).
3. Log in — every account created this way is automatically an admin and can access `/admin`.

Accounts live in `data/users.json` (passwords are hashed with scrypt, never stored in
plain text). This folder is git-ignored so your local accounts and content never get
committed or pushed anywhere.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
