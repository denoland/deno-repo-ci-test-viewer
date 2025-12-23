import { App, staticFiles } from "fresh";
import { type AppState, createRequestStore } from "./app.ts";

export const app = new App<AppState>();

app
  .use(staticFiles())
  .use(async (ctx) => {
    using scopedStore = createRequestStore();
    ctx.state.store = scopedStore;
    return await ctx.next();
  })
  .fsRoutes();
