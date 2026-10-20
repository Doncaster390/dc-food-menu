# DC Food Menu

A standalone daily menu calendar with shared PostgreSQL storage. The public site can display the same menus on multiple devices; menu changes are restricted to editors.

## Deploy on Vercel

1. Import `Doncaster390/dc-food-menu` as a new Vercel project. The repository includes its own `vercel.json`; do not attach the project to the productivity portal.
2. Create a PostgreSQL database (for example, a Neon database connected through Vercel Storage) and set `DATABASE_URL` in the Vercel project environment.
3. Set `ADMIN_PIN` to a unique editor PIN and `JWT_SECRET` to a long, randomly generated secret. Never add these values to Git or expose them in frontend settings.
4. Deploy the project. The API creates its `food_menu_items` table automatically when first used.
5. Open the deployed site and use **Editor sign in** to add menus. Viewers can open the site without signing in.

Set `DB_SSL=true` only if your database provider requires TLS for a direct PostgreSQL connection and the provider's connection string does not configure it already.

## Run locally

Requires Node.js 20+ and PostgreSQL.

```bash
npm install
Copy-Item .env.example .env
# Set DATABASE_URL, ADMIN_PIN, and JWT_SECRET in .env.
npm start
```

The page is served at `http://localhost:5000`. `GET /api/health` checks the database connection. Run `npm test` for the API input-validation tests.

## Menu API

- `GET /api/menu-items?from=YYYY-MM-DD&to=YYYY-MM-DD` returns menu items for a date range. The end date is exclusive; menu data is public.
- `GET /api/menu-items/:id/photo` serves a menu item's public image separately from calendar data.
- `POST /api/admin/login` exchanges `{ "pin" }` for a 12-hour editor token. Sign-in attempts are rate-limited.
- `POST /api/menu-items` creates one item.
- `POST /api/menu-items/bulk` creates or updates up to 500 items atomically.
- `PUT /api/menu-items/:id` updates an item.
- `DELETE /api/menu-items/:id` removes an item.

All write routes require `Authorization: Bearer <editor-token>`. Menu data, including descriptions, costs, and photos, is public to anyone who can reach the website. Do not enter private or sensitive information.

The monthly calendar refreshes menu data every minute while open. Viewers on other devices see additions and edits from the shared database, rather than browser-local copies. Photos are stored as image data in PostgreSQL; each photo is limited to 2 MB.

## CSV import

Use **Bulk upload** with `menu-template.csv`. Required columns are `date` (`YYYY-MM-DD`), `meal` (`Breakfast`, `Lunch`, or `Dinner`), and `name`. Optional columns are `category`, `description`, `coworkerCost`, `contractorCost`, `healthy`, and `oneDaySpecial`. Sign in as an editor before importing.
